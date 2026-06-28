# Specs por módulo — SomosVenezuela

Una spec breve por módulo. Para construir, copia la sección del módulo a `specs/<modulo>.md` y lánzala con `/sdd-new`. Cada spec: **objetivo · entradas/salidas · reglas · criterios de aceptación**.

---

## 1. Registro y búsqueda (personas y mascotas) — núcleo
**Objetivo.** Alta y búsqueda de personas/mascotas desde cualquier canal, con un único apartado para datos propios y de fuentes oficiales.
**Entradas.** Datos del registro (nombre, edad/tipo, zona, descripción, foto), contacto (privado).
**Salidas.** Registro creado; resultados de búsqueda ordenados por probabilidad con `fuente` y `verificacion` visibles.
**Reglas.** Nace `sin_verificar`. Contacto nunca público. Búsqueda por nombre/zona/descripción tolerante a errores.
**Aceptación.** Registrar y buscar en < 1 min; contacto oculto; fuente/verificación visibles; borrado disponible.

## 2. Bots de Telegram y WhatsApp
**Objetivo.** Mismo servicio por chat, con flujo guiado por menús (registrar, buscar, dejar mensaje, reportar, subir foto de lista).
**Entradas.** Mensajes del usuario. **Salidas.** Respuestas guiadas; registros/búsquedas en el backend.
**Reglas.** Telegram primero (sin aprobación). Lógica de conversación compartida en `packages/core`; los bots son adaptadores. Comando de borrado.
**Aceptación.** Un usuario sin conocimientos técnicos completa registro y búsqueda; ambos bots usan el mismo backend/BD y misma máquina de conversación.

## 3. Motor de IA (matching, OCR, priorización)
**Objetivo.** Encontrar coincidencias aunque haya errores de escritura o descripciones vagas; leer listas en papel; priorizar urgentes.
**Entradas.** Búsquedas, registros, fotos de listas. **Salidas.** `matches` con score; registros extraídos por OCR (`sin_verificar`); orden de prioridad.
**Reglas.** Híbrido: pg_trgm primero, Claude en casos dudosos. La IA **sugiere**, no confirma. Menores/mayores/heridos priorizados.
**Aceptación.** Eval con set sintético dorado supera el umbral de precisión/recall; nunca auto-confirma casos sensibles; degrada sin IA.

## 4. Mapa de zonas y necesidades
**Objetivo.** Estado de cada zona y sus necesidades (agua, medicinas, rescatistas...) con urgencia, actualizable por voluntarios.
**Entradas.** Zonas, necesidades, actualizaciones de voluntarios. **Salidas.** Mapa Leaflet + listado por urgencia.
**Reglas.** Solo voluntarios pueden editar. Sin datos personales en el mapa.
**Aceptación.** Mapa carga zonas/necesidades; un voluntario actualiza una necesidad y se refleja.

## 5. Menores no acompañados (prioritario)
**Objetivo.** Tratamiento reforzado y antitrata para menores, enlazado al registro.
**Entradas.** Persona con edad < 18 o marcada como menor; entidad verificadora. **Salidas.** Registro `minors`; confirmaciones de entrega controladas.
**Reglas.** **Solo entidades verificadas** confirman entrega (`entrega_confirmada`). Máxima prioridad en matching y alertas. Datos extra `sensibles`.
**Aceptación.** Gate impide confirmar entrega sin entidad verificada (test); menores priorizados.

## 6. Mensajes "estoy vivo"
**Objetivo.** Guardar un mensaje (texto o voz) y entregarlo a la familia cuando lo busque, sin necesidad de conexión simultánea.
**Entradas.** Mensaje del autor. **Salidas.** `alive_messages`; entrega al hacer match con una búsqueda.
**Reglas.** Asíncrono. Sin exponer contacto.
**Aceptación.** Un mensaje dejado hoy se entrega cuando la familia busca después.

## 7. Agregador de fuentes oficiales
**Objetivo.** Importar datos de fuentes que lo autoricen (API o OCR de PDF/imagen), marcados como verificados y con su origen.
**Entradas.** Fuentes configuradas (`sources`). **Salidas.** Registros importados con `fuente` y `verificacion=verificada`, citando origen.
**Reglas.** Respeta términos de cada fuente; atribución cuando se requiera; no importar sin permiso.
**Aceptación.** Import de una fuente de prueba respeta términos y marca origen/verificación.

## 8. Módulo satelital (IA + validación humana)
**Objetivo.** De imágenes satelitales a **alertas de rescate de alta confianza** con coordenadas, con humano en el bucle.
**Entradas.** Tiles de Copernicus/Sentinel/Maxar. **Salidas.** `sat_detections` (IA) → validación humana → `sat_alerts` exportables a rescate.
**Reglas.** Empezar con **prototipo mínimo**. La IA marca, el voluntario valida solo lo marcado; consenso genera alerta. En solitario (no multi-agente).
**Aceptación.** Una alerta solo se crea con consenso IA + humano; export con coordenadas correctas.

## 9. Notificaciones (transversal)
**Objetivo.** Avisar por el canal del usuario cuando hay coincidencia o alerta, priorizando urgentes.
**Entradas.** `matches`, `sat_alerts`. **Salidas.** `notifications` entregadas por Telegram/WhatsApp.
**Reglas.** Menores y casos urgentes primero. Respeta `opt_in`. Reintentos en fallo.
**Aceptación.** Un match genera notificación al canal correcto; prioridad respetada; estado registrado.
