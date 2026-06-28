# web — Búsqueda pública (SomosVenezuela)

Web pública para que cualquiera busque personas desaparecidas desde el navegador,
sin Telegram. Consume `GET /search` del backend y muestra los resultados con su
score de coincidencia. **Nunca** muestra datos de contacto (guardrail #1).

Stack: React 19 + Vite + Tailwind 4 + TypeScript estricto.

## Variables de entorno

- `VITE_BACKEND_URL` — URL base del backend (sin barra final). Ejemplo:
  `https://api.somosvenezuela.org`. Si no se define, en desarrollo se usa
  `http://localhost:3000` por defecto.

Las variables `VITE_*` se exponen al navegador: **no** pongas secretos aquí.

## Comandos

- `pnpm --filter web dev` — servidor de desarrollo (Vite).
- `pnpm --filter web build` — typecheck (`tsc`) + build de producción (`vite build`).
- `pnpm --filter web preview` — sirve el build de producción localmente.
- `pnpm --filter web typecheck` — solo comprobación de tipos.
- `pnpm --filter web test` — tests (Vitest + Testing Library, entorno jsdom).

## Arquitectura

- `src/api/search.ts` — acceso a `GET /search`; define el tipo `SearchResult`
  (`PublicPerson` de `core` + `score`).
- `src/containers/SearchContainer.tsx` — único componente con estado y fetch.
- `src/presentation/*` — componentes de presentación puros (formulario, lista,
  tarjeta, mensajes de estado) y los mapas de etiquetas/colores.
