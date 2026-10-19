# MMEP Constructora · Obra Planta Piloto

Seguimiento de la obra "Remodelación integral y refuncionalización – Bloque 2 Planta Piloto" (19/10/2026 al 17/11/2026).

- 19 tareas con sus fechas y las 5 etapas del cronograma.
- El obrero sube fotos de **antes** y **después** de cada lugar intervenido.
- Cada tarea tiene una barra de avance que se llena con las fotos y llega al 100 % al marcarla completada (en verde).
- El avance general suma todas las tareas y lo compara con lo previsto para el día.
- Apartado **Pedido de materiales**: el obrero escribe lo que necesita y queda guardado; se marca como entregado.

Para entrar hace falta el código de la obra.

## Cómo está armado

- `index.html`: la página (GitHub Pages).
- `worker/`: servidor en Cloudflare Workers que guarda tareas y fotos en una base D1 (`mmep-obras`). El código de acceso está guardado como secreto `CLAVE` en Cloudflare.

Cambiar el código: desde `worker/`, `npx wrangler@4 secret put CLAVE`.
