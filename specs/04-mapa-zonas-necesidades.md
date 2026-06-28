# Spec 04 · Mapa de zonas y necesidades + Web

## Objetivo
Acceso web a la búsqueda y un mapa con el estado de cada zona y sus necesidades, actualizable por voluntarios.

## Requisitos funcionales
- Web (React+Vite+Tailwind): búsqueda pública con fuente/verificación, **sin** exponer contacto.
- Mapa Leaflet + OpenStreetMap (sin API key) con `zones` y `needs` por urgencia.
- Voluntarios pueden actualizar zonas/necesidades.

## Datos
`zones`, `needs` (ver `docs/data-model.md`).

## Reglas y guardrails
- La web nunca muestra datos de contacto (test).
- Edición de zonas/necesidades solo para voluntarios autenticados.
- Sin datos personales en el mapa.

## Criterios de aceptación
- Búsqueda web funciona y oculta contacto.
- Un voluntario actualiza una necesidad y se refleja en el mapa.

## Dependencias
Spec 01 (API de búsqueda).
