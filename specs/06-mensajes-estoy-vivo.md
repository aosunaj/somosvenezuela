# Spec 06 · Mensajes "estoy vivo"

## Objetivo
Guardar un mensaje (texto o voz) y entregarlo a la familia cuando lo busque, sin necesidad de conexión simultánea.

## Requisitos funcionales
- Alta de mensaje desde bot/web: texto o audio (URL en Cloudinary), autor, zona.
- Entrega asíncrona: al hacer match con una búsqueda, se marca `entregado` y se notifica.

## Datos
`alive_messages` (ver `docs/data-model.md`).

## Reglas y guardrails
- No exponer contacto. Validar tipo/tamaño de audio.
- El mensaje persiste hasta entrega o borrado por el autor.

## Criterios de aceptación
- Un mensaje dejado hoy se entrega cuando la familia busca después (test del flujo asíncrono).

## Dependencias
Spec 01, Spec 09.
