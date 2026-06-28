# SDD · 03 · Plan — Fases (priorizado por urgencia)

La urgencia manda: el objetivo es **algo útil funcionando en días**, no en meses. Cada fase es desplegable y suma sin parar el servicio.

| Fase | Módulo | Por qué este orden | Entregable | Periodo |
|---|---|---|---|---|
| 0 | Preparación | Bases para construir | Repo + CLAUDE.md + specs + Supabase + bot Telegram creado | Día 0-1 |
| 1 | BD + registro/búsqueda de personas | El núcleo que salva vidas | Registrar/buscar personas (API) | Días 1-5 |
| 2 | Bot de Telegram | Canal más rápido (sin aprobación) | Registrar y buscar por Telegram | Días 1-5 |
| 3 | Motor IA: matching + OCR | Multiplica la utilidad del registro | Coincidencias automáticas + listas en papel | Días 6-9 |
| 4 | Bot de WhatsApp | Máxima penetración en Venezuela | Mismo servicio por WhatsApp | Días 10-12 |
| 5 | Web + mapa de zonas/necesidades | Acceso visual y coordinación | Web pública + mapa | Días 13-17 |
| 6 | Menores + mascotas | Casos prioritarios y de alto impacto | Módulos prioritarios | Días 18-22 |
| 7 | Mensajes "estoy vivo" + agregador de fuentes | Cobertura y credibilidad | Buzón de vida + import oficial | Días 23-25 |
| 8 | Módulo satelital (IA + voluntarios) | El más complejo; al final | Alertas de rescate desde imágenes | Semanas 4-5 |
| 9 | Notificaciones transversales | Cierra el ciclo | Avisos por el canal del usuario | Transversal |

> **Fases 1 + 2 juntas** ya dan una herramienta real y desplegable en pocos días.

## Preparación (Fase 0) — checklist
- [ ] Crear repositorio + `CLAUDE.md` + `AGENTS.md` + `docs/` + `specs/`.
- [ ] `/sdd-init` en el repo y generar un spec por módulo en Plan Mode.
- [ ] Crear proyecto **Supabase** y obtener credenciales (a `.env`, nunca al repo).
- [ ] Crear bot de **Telegram** con BotFather y obtener token.
- [ ] Solicitar **WhatsApp Cloud API** en Meta for Developers (tarda; empezar ya).
- [ ] Solicitar acceso humanitario a **Claude API** y a **Copernicus EMS** (para satélite).

## Multi-agente (tras el núcleo)
Construir en paralelo con **git worktrees**: web, mapa, mascotas, agregador (cada uno en su rama, revisar y fusionar). El **satelital** conviene en solitario y con un prototipo mínimo primero (es el más complejo y delicado).

## Routing de modelos SDD (sugerido)
- spec/design → modelo de razonamiento.
- apply → modelo balanced.
- verify → razonamiento + revisión humana (especialmente en módulos sensibles: menores, fallecidos, satélite).
