# Spec 07 · Agregador de fuentes oficiales

## Objetivo
Importar datos de fuentes que lo autoricen (API directa u OCR de PDF/imagen), marcados como verificados y citando origen.

## Requisitos funcionales
- Conectores por fuente (`sources`): API si la hay; OCR si publican PDF/imagen.
- Cada registro importado: `fuente` correspondiente, `verificacion=verificada`, atribución de origen.
- Deduplicación contra registros existentes (reusa matching, Spec 03).

## Reglas y guardrails
- **Respetar términos** de cada fuente (`permiso_uso`); no importar sin permiso.
- Atribución cuando la fuente la requiera (`atribucion_requerida`).
- No importar datos de contacto a campos públicos.

## Criterios de aceptación
- Import de una fuente de prueba respeta términos, marca origen y verificación, y no duplica.

## Dependencias
Spec 01, Spec 03.
