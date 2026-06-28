# Modelo de datos — SomosVenezuela

PostgreSQL (Supabase). Cada campo lleva una **clasificación de privacidad**: `pública` (puede mostrarse en búsquedas), `interna` (solo backend/voluntarios verificados), `sensible` (PII protegida, nunca pública). Activar **RLS** en tablas con datos sensibles.

## Enums
- `estado`: `desaparecida` · `encontrada_viva` · `encontrada_herida` · `fallecida` · `reunida`
- `fuente`: `propia` · `cruz_roja` · `ocha` · `hospital` · `refugio` · `plataforma_aliada`
- `verificacion`: `verificada` · `sin_verificar`

## Tablas

### persons
Personas registradas (buscadas o reportadas).
| Campo | Tipo | Privacidad | Notas |
|---|---|---|---|
| id | uuid PK | — | |
| nombre, apellidos | text | pública | |
| edad | int | pública | dispara reglas de menor si < 18 |
| zona | text/ref zones | pública | |
| descripcion | text | pública | señas, ropa, contexto |
| foto_url | text (Cloudinary) | pública | |
| estado | enum estado | pública | por defecto `desaparecida` |
| fuente | enum fuente | pública | |
| verificacion | enum verificacion | pública | por defecto `sin_verificar` |
| contact_id | uuid → contacts | interna | NUNCA público |
| created_at/updated_at | timestamptz | — | |

### pets
Mascotas. Igual que `persons` sin edad/menor: `nombre, tipo, raza, zona, foto_url, estado, fuente, verificacion, contact_id`.

### searches
Búsquedas activas (quién busca a quién), para generar alertas.
`id, buscador_contact_id (sensible), target_descripcion, target_nombre?, zona?, tipo (persona|mascota), created_at`.

### matches
Coincidencias detectadas entre búsquedas y registros.
`id, search_id, person_id|pet_id, score (0-1), metodo (exacto|trigram|ia), estado_revision (propuesto|confirmado|descartado), revisado_por?, created_at`.
> `confirmado` en casos sensibles requiere revisión humana.

### minors
Datos reforzados de menores no acompañados (1–1 con `persons`).
`id, person_id → persons, tutor_conocido?, entidad_verificadora?, entrega_confirmada (bool, default false), confirmada_por (entidad verificada), notas (sensible)`.
> **Gate**: `entrega_confirmada` solo true si `entidad_verificadora` es verificada.

### alive_messages
Mensajes "estoy vivo" guardados para entregar a la familia.
`id, person_id?, autor_nombre, tipo (texto|voz), contenido_url|texto, zona?, created_at, entregado (bool)`.

### zones
Zonas con su estado y necesidades. `id, nombre, geojson|lat/lng, estado, actualizado_por (voluntario), updated_at`.

### needs
Necesidades por zona y urgencia. `id, zone_id → zones, tipo (agua|medicinas|rescatistas|...), urgencia (baja|media|alta|critica), descripcion, updated_at`.

### sat_tiles
Cuadrículas de imágenes satelitales a revisar. `id, zona/bbox, fuente_img (copernicus|sentinel|maxar), fecha_img, url, estado (pendiente|en_revision|cerrada)`.

### sat_detections
Detecciones (IA y humanas) por cuadrícula. `id, tile_id → sat_tiles, origen (ia|humano), tipo (cambio|objeto|senal), confianza (0-1), lat/lng, validado_por?, created_at`.

### sat_alerts
Alertas de alta confianza con coordenadas para rescate. `id, tile_id, lat/lng, confianza, consenso (ia+humano), exportada (bool), created_at`.

### sources
Fuentes de datos y sus permisos de uso. `id, nombre, tipo (api|pdf|imagen), terminos_url, permiso_uso (bool), atribucion_requerida (bool)`.

### contacts  (SENSIBLE — RLS estricta)
Datos de contacto de quien registra. `id, telefono (sensible), email? (sensible), solo_uso_interno (bool, default true)`.
> Nunca se expone en búsquedas ni web pública. Solo para notificar internamente.

### channels
Vínculo usuario ↔ canal para notificarle. `id, contact_id → contacts, plataforma (telegram|whatsapp), chat_id (sensible), opt_in (bool)`.

### notifications
Notificaciones enviadas y su estado. `id, contact_id, channel_id, tipo (match|alerta|info), prioridad (normal|alta), payload, estado (pendiente|enviada|fallida), created_at`.

## Reglas de integridad y privacidad (resumen)
- `persons.contact_id` y todo lo de `contacts`/`channels` = **sensible**: RLS y nunca en respuestas públicas.
- Borrado (derecho al olvido): elimina `persons/pets` + `contacts`/`channels` asociados y anonimiza `matches`.
- `verificacion` por defecto `sin_verificar`; pasar a `verificada` requiere fuente fiable.
- `estado=fallecida` requiere `fuente` verificada (gate en dominio).
- Auditoría: `created_at/updated_at` en todas; cambios de estado sensibles registran quién y cuándo.
