# Spec 08 · Módulo satelital (IA + validación humana)

## Objetivo
De imágenes satelitales a **alertas de rescate de alta confianza** con coordenadas, con humano en el bucle. Empezar por un **prototipo mínimo**.

## Requisitos funcionales
- Ingesta de tiles (Copernicus/Sentinel/Maxar) → `sat_tiles`.
- Barrido IA (detección de cambios/objetos/señales) → `sat_detections` con confianza.
- Panel web donde voluntarios validan **solo** lo que la IA marcó.
- Consenso IA + humano → `sat_alerts` con lat/lng, exportables a equipos de rescate.

## Reglas y guardrails
- La IA **marca**, el humano **valida**; una alerta solo existe con consenso.
- Trabajar **en solitario** (no multi-agente) por su complejidad.
- Coordenadas correctas y trazables; export auditado.

## Criterios de aceptación
- Prototipo: ingesta + barrido IA produce detecciones.
- Una `sat_alert` solo se crea con consenso; export con coordenadas correctas.

## Dependencias
Fase 0; idealmente tras el núcleo. Acceso Copernicus EMS.
