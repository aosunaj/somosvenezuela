# Spec 05 · Menores no acompañados (PRIORITARIO)

## Objetivo
Tratamiento reforzado y antitrata para menores, enlazado al registro de personas.

## Requisitos funcionales
- Tabla `minors` enlazada 1–1 con `persons` (edad < 18 o marca de menor).
- Verificación reforzada: **solo entidades verificadas** confirman la entrega (`entrega_confirmada`).
- Máxima prioridad en matching y alertas. Datos extra `sensibles`.

## Reglas y guardrails (TDD estricto)
- **Gate**: `entrega_confirmada=true` solo si `entidad_verificadora` es una `source` verificada. Test obligatorio.
- Difusión mínima de datos de menores; acceso restringido (RLS).
- Prioridad máxima en `notifications` y matching.

## Criterios de aceptación
- El gate impide confirmar entrega sin entidad verificada (test rojo→verde).
- Menores aparecen priorizados en matching/alertas.

## Dependencias
Spec 01, Spec 03 (prioridad), Spec 09 (notificaciones).
