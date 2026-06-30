import type { PersonRepo, SearchRepo, AuditRepo } from "db";

// Servicio de routing de matches: decide si un match va a revision humana o auto-flujo.
//
// Orden de evaluacion R2-4(c) — el primer bloque que dispara gana, el resto no se evalua:
//   1. pet_id !== null → human (auto-match mascotas fuera de scope)
//   2. buscador_contact_id IS NULL → human (conservative, identidad del buscador desconocida)
//   3. isMinorByContactId(buscador) → human (conservative minor gate)
//   4. es_menor_search=true OR isMinorById(registrante) → human (menor confirmado)
//   5. estado_registrant='fallecida' → human (proceso de honra/sensible)
//   6. sin pregunta de verificacion o verif=null → human (auto-consent imposible)
//   7. score < threshold → human (baja confianza)
//   8. todo OK → auto (puede iniciar flujo de consentimiento bilateral)
//
// NUNCA modifica el match ni crea consent_sessions: solo lee y decide.
// La escritura del relay la hace auto-notify.ts.
//
// La auditoria de route_decision se escribe SIEMPRE (auto o human).

/** Datos del match que necesita el router. Proyeccion desde la tabla matches. */
export interface MatchForRouting {
  readonly id: string;
  readonly search_id: string;
  readonly person_id: string | null;
  readonly pet_id: string | null;
  readonly score: number;
  /** Estado actual del registrante en la tabla persons/pets. */
  readonly estado_registrant: string;
  /** Campo es_menor de la busqueda (auto-declaracion conservadora del buscador). */
  readonly es_menor_search: boolean;
  /** contact_id del buscador (puede ser null si la busqueda fue anonima). */
  readonly buscador_contact_id: string | null;
  /** contact_id del registrante (para la auditoria). */
  readonly registrant_contact_id: string | null;
}

/** Resultado del routing para un match. */
export interface RouteDecision {
  readonly decision: "auto" | "human";
  readonly reason: string;
}

/** Dependencias inyectadas al servicio (subset de AppDeps). */
export interface RouteMatchDeps {
  readonly personRepo: Pick<PersonRepo, "isMinorById" | "getVerificationStatus">;
  readonly searchRepo: Pick<SearchRepo, "isMinorByContactId">;
  readonly auditRepo: Pick<AuditRepo, "writeRouteDecision">;
  readonly autoMatchThreshold: number;
}

/**
 * Evalua un match contra las reglas R2-4(c) y devuelve la decision de routing.
 * Escribe una fila de auditoria route_decision independientemente del resultado.
 */
export async function routeMatch(
  deps: RouteMatchDeps,
  match: MatchForRouting,
): Promise<RouteDecision> {
  let decision: RouteDecision;

  // 1. pet_id: auto-match de mascotas fuera de scope
  if (match.pet_id !== null) {
    decision = { decision: "human", reason: "pet match: auto-consent not in scope" };
  } else if (match.buscador_contact_id === null) {
    // 2. buscador desconocido → conservative
    decision = {
      decision: "human",
      reason: "conservative: unknown searcher contact (buscador_contact_id IS NULL)",
    };
  } else {
    // 3. Comprueba minor gate via isMinorByContactId (conservative: null ages, 0 persons → true)
    const searcherIsMinor = await deps.searchRepo.isMinorByContactId(match.buscador_contact_id);

    if (searcherIsMinor) {
      decision = {
        decision: "human",
        reason: "conservative minor gate: searcher contact resolves as minor (isMinorByContactId)",
      };
    } else if (match.es_menor_search) {
      // 4a. es_menor_search=true (auto-declaracion del buscador)
      decision = {
        decision: "human",
        reason: "minor gate: es_menor_search flag is true",
      };
    } else if (match.person_id !== null) {
      // 4b. isMinorById del registrante (solo si hay person_id)
      const registrantIsMinor = await deps.personRepo.isMinorById(match.person_id);

      if (registrantIsMinor) {
        decision = {
          decision: "human",
          reason: "minor gate: registrant person is minor (isMinorById)",
        };
      } else if (match.estado_registrant === "fallecida") {
        // 5. registrante fallecida → flujo humano sensible
        decision = {
          decision: "human",
          reason: "registrant estado='fallecida': requires human review",
        };
      } else {
        // 6. verificacion question
        const verif = await deps.personRepo.getVerificationStatus(match.person_id);

        if (!verif || !verif.hasQuestion) {
          decision = {
            decision: "human",
            reason: "no verificacion question set: auto-consent path unavailable",
          };
        } else if (match.score < deps.autoMatchThreshold) {
          // 7. score bajo el umbral
          decision = {
            decision: "human",
            reason: `score ${match.score} below threshold ${deps.autoMatchThreshold}`,
          };
        } else {
          // 8. todo OK → auto
          decision = { decision: "auto", reason: "all gates cleared: eligible for auto-consent" };
        }
      }
    } else if (match.estado_registrant === "fallecida") {
      // 5. fallecida sin person_id (pet path ya descartado en step 1)
      decision = {
        decision: "human",
        reason: "registrant estado='fallecida': requires human review",
      };
    } else {
      // Conservativo: no hay person_id ni pet_id → human
      decision = {
        decision: "human",
        reason: "conservative: no person_id or pet_id to resolve registrant",
      };
    }
  }

  // Auditoria: siempre, independientemente de la decision
  try {
    await deps.auditRepo.writeRouteDecision({
      matchId: match.id,
      searcherContactId: match.buscador_contact_id ?? null,
      registrantContactId: match.registrant_contact_id ?? null,
      score: match.score,
      threshold: deps.autoMatchThreshold,
      result: decision.decision,
    });
  } catch {
    // best-effort: la auditoria no debe bloquear el routing (judgment-r3 item 10)
    // TODO: emit monitoring metric here
  }

  return decision;
}
