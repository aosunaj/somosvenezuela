# Guardrails — SomosVenezuela

Reglas de seguridad, privacidad y ética **de obligado cumplimiento**. Tienen prioridad sobre cualquier feature o plazo. Si un cambio las incumple, no entra. Claude Code debe verificarlas en cada módulo (`docs/sdd/05-verify.md`).

## 1. Privacidad y datos personales
- **Datos de contacto (teléfono, email) son sensibles**: nunca públicos, nunca en búsquedas, web, logs ni respuestas de bot. Solo para notificar internamente.
- **Minimización**: pedir y guardar solo lo necesario para identificar y reunir.
- **RLS** activada en `contacts`, `channels` y campos sensibles. Acceso a sensibles solo desde backend autorizado.
- **Sin PII real** en código, tests, seeds, fixtures, logs ni prompts a la IA. Datos de prueba sintéticos.
- **Derecho al borrado**: cualquiera elimina su registro con un mensaje al bot; el borrado arrastra contacto/canales y anonimiza coincidencias.

## 2. Protección de menores (antitrata) — máxima prioridad
- Edad < 18 (o marca de menor) activa tratamiento reforzado (`minors`).
- **Solo entidades verificadas** confirman la entrega de un menor (`entrega_confirmada` con `entidad_verificadora` verificada). Gate en dominio + test.
- Datos de menores con verificación y prioridad máximas; difusión mínima.

## 3. Fallecimientos
- `estado=fallecida` **solo** con confirmación de **fuente fiable** (gate en dominio). Nunca por rumor.
- Comunicación de fallecimiento con cuidado; no publicar de forma masiva sin verificación.

## 4. Verificación y fuentes
- Todo registro nace `verificacion=sin_verificar`. Pasar a `verificada` exige fuente fiable.
- Cada registro lleva su `fuente`. Al integrar fuentes externas: **respetar sus términos**, pedir permiso de uso y **citar el origen** (atribución si la requieren).

## 5. La IA asiste, no decide
- Matching, OCR y detecciones satelitales devuelven **sugerencias con score**, nunca verdades.
- Casos sensibles (match confirmado, fallecimiento, entrega de menor, alerta de rescate) requieren **revisión humana** antes de efecto.
- **Degradación segura**: si la IA falla, registro y búsqueda manual siguen operativos.
- No enviar datos sensibles innecesarios en los prompts a la IA; enviar lo mínimo.

## 6. Seguridad técnica
- Secretos (tokens de bots, claves Supabase/Claude/Cloudinary) en variables de entorno; `.env` en `.gitignore`; nunca en commits.
- **Validar toda entrada externa** con zod (bots, webhooks, API).
- **Verificar firmas** de webhooks (WhatsApp Cloud API) y orígenes.
- **Rate limiting** y anti-abuso en endpoints y bots (evitar spam y scraping de datos).
- Subida de fotos: validar tipo/tamaño; servir desde Cloudinary; no ejecutar contenido.
- Principio de mínimo privilegio en claves de servicio.

## 7. Abuso y desinformación
- Mecanismo de **reporte** de registros falsos o malintencionados.
- Marcar y revisar registros sospechosos; no propagar información no verificada como cierta.
- Moderación básica de contenido en mensajes públicos.

## 8. Operación
- **Código abierto** para auditoría.
- Cambios en estados sensibles quedan **auditados** (quién, cuándo).
- Cumplimiento de la normativa de protección de datos aplicable y de los acuerdos con organizaciones aliadas.

> Nota: este documento describe salvaguardas de producto. No sustituye asesoría legal; al colaborar con Cruz Roja/OCHA u otras entidades, validar requisitos de protección de datos y de protección de menores con ellas.
