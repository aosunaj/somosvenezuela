# Spec 03 · Motor de IA (matching, OCR, priorización)

## Objetivo
Encontrar coincidencias pese a errores de escritura o descripciones vagas; leer listas en papel; priorizar casos urgentes.

## Requisitos funcionales
- **Matching híbrido**: normalización (nombres, apodos, variantes) + `pg_trgm`; solo casos dudosos pasan por Claude. Genera `matches` con `score` y `metodo`.
- **OCR** de fotos de listas manuscritas (Claude Vision) → extracción de nombres → registros `sin_verificar`.
- **Priorización**: menores, mayores, heridos primero.

## Interfaz
- `packages/ai`: `matchSearch(search)`, `ocrList(image)`, `prioritize(cases)` tras interfaz; proveedor Claude mockeable.

## Reglas y guardrails
- La IA **sugiere**, no confirma: `matches.estado_revision='propuesto'`; casos sensibles requieren revisión humana.
- **Degradación**: sin IA, registro/búsqueda manual siguen.
- Enviar a la IA el **mínimo** de datos; nada de contacto.

## Criterios de aceptación
- `pnpm ai:eval` sobre el set dorado supera el umbral de precisión/recall.
- Test: nunca auto-confirma sensibles; test de degradación sin IA.

## Dependencias
Spec 01. Harness/eval (`docs/harness.md`).
