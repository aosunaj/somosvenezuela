# Spec 01 · Registro y búsqueda (personas y mascotas) — NÚCLEO

## Objetivo
Alta y búsqueda de personas/mascotas desde cualquier canal, con un único apartado para datos propios y de fuentes oficiales.

## Requisitos funcionales
- Alta con: nombre, apellidos, edad (personas) / tipo, raza (mascotas), zona, descripción, foto, contacto (privado).
- Búsqueda por nombre / zona / descripción, tolerante a errores (pg_trgm), ordenada por probabilidad.
- En cada resultado: `fuente` y `verificacion` visibles. Contacto **nunca** visible.
- Borrado del propio registro.

## Datos
Tablas: `persons`, `pets`, `searches`, `contacts`, `channels`, `sources` (ver `docs/data-model.md`).

## API (backend Fastify)
- `POST /persons` · `POST /pets` · `POST /searches`
- `GET /search?tipo=&q=&zona=` → resultados con score (sin contacto)
- `DELETE /persons/:id` (borrado por el dueño, vía token del canal)

## Reglas y guardrails
- Nace `verificacion=sin_verificar`, `estado=desaparecida`.
- Ningún endpoint devuelve `contact_id`/teléfono (test de contrato).
- Validación zod de toda entrada.

## Criterios de aceptación
- Registrar y buscar en < 1 min. Contacto oculto. Fuente/verificación visibles. Borrado funciona.
- `pnpm verify` en verde, incl. test "la búsqueda nunca expone contacto".

## Fuera de alcance
- Matching por IA (Spec 03), bots (Spec 02), web (Spec 04).

## Dependencias
Fase 0 (scaffold, core, db).
