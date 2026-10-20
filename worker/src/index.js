// API de MMEP Obra Planta Piloto: guarda el estado de las tareas y las fotos en D1.
// Todas las rutas piden la clave de obra (header X-Clave, o ?k= para las imágenes).

const TAREAS = new Set(Array.from({ length: 19 }, (_, i) => "t" + (i + 1)));
const TIPOS = new Set(["antes", "despues"]);
const MAX_FOTO = 1_900_000; // D1 admite blobs de hasta ~2 MB

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Clave,X-Por",
  "Access-Control-Max-Age": "86400",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const err = (msg, status) => json({ error: msg }, status);

function iguales(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const limpiarNombre = s => (s || "").toString().replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    // El enlace viejo /obra lleva al nuevo /plan-de-obra
    if (/^\/obra(\/|$)/.test(url.pathname) && !url.pathname.startsWith("/obra/api/"))
      return Response.redirect(url.origin + "/plan-de-obra/", 301);
    const path = url.pathname.replace(/^\/(plan-de-obra|obra)(?=\/)/, "").replace(/\/+$/, "");
    if (path === "/plan-de-obra") return Response.redirect(url.origin + "/plan-de-obra/", 301);
    // Dos cuentas: CLAVE_JEFE (jefe: ve los avisos de materiales, marca entregas y borra) y CLAVE (obreros)
    const clave = req.headers.get("X-Clave") || url.searchParams.get("k") || "";
    const rol = env.CLAVE_JEFE && iguales(clave, env.CLAVE_JEFE) ? "jefe"
      : env.CLAVE && iguales(clave, env.CLAVE) ? "obrero" : null;
    if (!rol) return err("Clave incorrecta", 401);
    const soloJefe = () => err("Solo el jefe puede hacer esto", 403);

    try {
      if (req.method === "GET" && path === "/api/estado") {
        const t = await env.DB.prepare("SELECT id, hecha, hecha_en, por FROM tareas").all();
        const f = await env.DB.prepare("SELECT id, tarea, tipo, at, por FROM fotos ORDER BY at").all();
        const p = await env.DB.prepare("SELECT id, tarea, texto, at, por, entregado, entregado_en FROM pedidos ORDER BY at DESC LIMIT 300").all();
        const tareas = {};
        for (const r of t.results) tareas[r.id] = { hecha: !!r.hecha, hechaEn: r.hecha_en, por: r.por };
        const pedidos = p.results.map(r => ({ id: r.id, tarea: r.tarea, texto: r.texto, at: r.at, por: r.por, entregado: !!r.entregado, entregadoEn: r.entregado_en }));
        return json({ tareas, fotos: f.results, pedidos });
      }

      if (req.method === "POST" && path === "/api/pedido") {
        const body = await req.json().catch(() => ({}));
        const texto = (body.texto || "").toString().replace(/\u0000/g, "").trim().slice(0, 2000);
        if (!texto) return err("El pedido está vacío", 400);
        const tarea = TAREAS.has(body.tarea) ? body.tarea : null;
        const pedido = { id: crypto.randomUUID().replace(/-/g, ""), tarea, texto, at: new Date().toISOString(), por: limpiarNombre(req.headers.get("X-Por")), entregado: false, entregadoEn: null };
        await env.DB.prepare("INSERT INTO pedidos (id, tarea, texto, at, por, entregado) VALUES (?1, ?2, ?3, ?4, ?5, 0)")
          .bind(pedido.id, pedido.tarea, pedido.texto, pedido.at, pedido.por).run();
        return json(pedido);
      }

      let mp = path.match(/^\/api\/pedido\/([0-9a-f]{32})$/);
      if (mp && req.method === "POST") {
        if (rol !== "jefe") return soloJefe();
        const body = await req.json().catch(() => ({}));
        const entregado = !!body.entregado;
        await env.DB.prepare("UPDATE pedidos SET entregado = ?2, entregado_en = ?3 WHERE id = ?1")
          .bind(mp[1], entregado ? 1 : 0, entregado ? new Date().toISOString() : null).run();
        return json({ ok: true });
      }
      if (mp && req.method === "DELETE") {
        if (rol !== "jefe") return soloJefe();
        await env.DB.prepare("DELETE FROM pedidos WHERE id = ?1").bind(mp[1]).run();
        return json({ ok: true });
      }

      let m = path.match(/^\/api\/tarea\/(t\d{1,2})$/);
      if (req.method === "POST" && m) {
        if (!TAREAS.has(m[1])) return err("Tarea inexistente", 404);
        const body = await req.json().catch(() => ({}));
        const hecha = !!body.hecha;
        await env.DB.prepare(
          "INSERT INTO tareas (id, hecha, hecha_en, por) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET hecha=?2, hecha_en=?3, por=?4"
        ).bind(m[1], hecha ? 1 : 0, hecha ? new Date().toISOString() : null, limpiarNombre(req.headers.get("X-Por"))).run();
        return json({ ok: true });
      }

      if (req.method === "POST" && path === "/api/foto") {
        const tarea = url.searchParams.get("tarea"), tipo = url.searchParams.get("tipo");
        if (!TAREAS.has(tarea) || !TIPOS.has(tipo)) return err("Datos de foto inválidos", 400);
        const mime = (req.headers.get("Content-Type") || "").split(";")[0];
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return err("Formato no admitido", 415);
        const datos = await req.arrayBuffer();
        if (!datos.byteLength) return err("Foto vacía", 400);
        if (datos.byteLength > MAX_FOTO) return err("Foto demasiado grande", 413);
        const id = crypto.randomUUID().replace(/-/g, "");
        const at = new Date().toISOString();
        const por = limpiarNombre(req.headers.get("X-Por"));
        await env.DB.prepare("INSERT INTO fotos (id, tarea, tipo, at, por, mime, datos) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
          .bind(id, tarea, tipo, at, por, mime, datos).run();
        return json({ id, tarea, tipo, at, por });
      }

      m = path.match(/^\/api\/foto\/([0-9a-f]{32})$/);
      if (m && req.method === "GET") {
        const r = await env.DB.prepare("SELECT mime, datos FROM fotos WHERE id = ?1").bind(m[1]).first();
        if (!r) return err("No existe", 404);
        return new Response(new Uint8Array(r.datos), {
          headers: { ...cors, "Content-Type": r.mime, "Cache-Control": "private, max-age=31536000, immutable" },
        });
      }
      if (m && req.method === "DELETE") {
        if (rol !== "jefe") return soloJefe();
        await env.DB.prepare("DELETE FROM fotos WHERE id = ?1").bind(m[1]).run();
        return json({ ok: true });
      }

      if (req.method === "GET" && path === "/api/login") return json({ ok: true, rol });
      return err("No encontrado", 404);
    } catch (e) {
      return err("Error del servidor", 500);
    }
  },
};
