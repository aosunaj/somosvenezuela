---
tags: [hub, sdd]
---

# Mapa del flujo SDD

Cada fase enlaza a su documento del proyecto y al agente/comando que la ejecuta de verdad (repo `gentle-ai-config`, mismo vault).

| Fase | Documento del proyecto | Agente que la ejecuta | Comando |
|---|---|---|---|
| 1. Spec | [[01-spec]] | [[../../../gentle-ai-config/agents/sdd-spec\|sdd-spec (agente)]] | — |
| 2. Design | [[02-design]] | [[../../../gentle-ai-config/agents/sdd-design\|sdd-design (agente)]] | — |
| 3. Plan | [[03-plan]] | [[../../../gentle-ai-config/agents/sdd-tasks\|sdd-tasks (agente)]] | — |
| 4. Tasks | [[04-tasks]] | [[../../../gentle-ai-config/agents/sdd-tasks\|sdd-tasks (agente)]] | — |
| 5. Verify | [[05-verify]] | [[../../../gentle-ai-config/agents/sdd-verify\|sdd-verify (agente)]] | [[../../../gentle-ai-config/commands/sdd-verify\|/sdd-verify]] |

## Entradas al pipeline
- [[../../../gentle-ai-config/commands/sdd-new|/sdd-new]] — flujo completo (propose → spec → design → tasks)
- [[../../../gentle-ai-config/commands/sdd-ff|/sdd-ff]] — fast-forward para tareas pequeñas
- [[../../../gentle-ai-config/commands/sdd-apply|/sdd-apply]] — implementación
- [[../../../gentle-ai-config/commands/sdd-archive|/sdd-archive]] — cierre del cambio

## Verificación reforzada (capa opcional)
- [[../../../gentle-ai-config/agents/jd-judge-a|jd-judge-a]] y [[../../../gentle-ai-config/agents/jd-judge-b|jd-judge-b]] — revisión adversarial ciega, tras design/apply de alto riesgo
- [[../../../gentle-ai-config/agents/review-risk|review-risk]] — solo en rutas sensibles o >400 líneas

## Skills locales de este repo (Openclaw)
- [[../../.openclaw/skills/sdd-apply/SKILL|sdd-apply (skill Openclaw)]]
- [[../../.openclaw/skills/sdd-verify/SKILL|sdd-verify (skill Openclaw)]]
- [[../../.openclaw/skills/judgment-day/SKILL|judgment-day (skill Openclaw)]]

Volver al [[../CEREBRO|Cerebro del proyecto]].
