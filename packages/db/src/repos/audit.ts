import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de auto_connection_audit.
//
// INMUTABILIDAD (R2-3): las filas de auditoría son append-only. Solo se permite
// nullar los campos contact_id en el contexto de erasure (guardrail #5), lo que
// está controlado por el trigger auto_connection_audit_guard en la BD.
// Este repo solo escribe (INSERT) — los UPDATEs de anonimización pasan por
// ConsentRepo.anonymizeAuditContact (que usa el trigger-safe path).
//
// PRIVACIDAD: el payload de route_decision expone los contact_id solo internamente.
// La auditoría NUNCA es legible desde rutas públicas.

/** Tipos de evento de auditoría (espeja el CHECK de la migración). */
export const AUDIT_EVENT_TYPE = {
  ROUTE_DECISION: "route_decision",
  CONSENT_STATE_CHANGE: "consent_state_change",
  CONTACT_REVEAL: "contact_reveal",
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPE)[keyof typeof AUDIT_EVENT_TYPE];

/** Input para escribir una decisión de routing. */
export interface RouteDecisionInput {
  matchId: string;
  searcherContactId: string | null;
  registrantContactId: string | null;
  score: number;
  threshold: number;
  result: string; // "auto" | "human_minor" | "human_fallecida" | "human_no_verif" | etc.
}

/** Input para registrar un cambio de estado del consentimiento. */
export interface ConsentStateChangeInput {
  consentId: string;
  previousState: string;
  newState: string;
  party: string;
}

export interface AuditRepo {
  /**
   * Escribe una fila de auditoría tipo 'route_decision'.
   * Llamado por routeMatch service tras cada decisión de routing.
   * (design: "Writes a route_decision audit row")
   */
  writeRouteDecision(input: RouteDecisionInput): Promise<void>;

  /**
   * Escribe una fila de auditoría tipo 'consent_state_change'.
   * Llamado por consent service al cambiar el estado de una consent_session.
   */
  writeConsentStateChange(input: ConsentStateChangeInput): Promise<void>;
}

/** Construye el repositorio de auditoría sobre un cliente Supabase de servicio. */
export function createAuditRepo(client: DbClient): AuditRepo {
  return {
    async writeRouteDecision(input: RouteDecisionInput): Promise<void> {
      const { error } = await client.from("auto_connection_audit").insert({
        event_type: AUDIT_EVENT_TYPE.ROUTE_DECISION,
        match_id: input.matchId,
        searcher_contact_id: input.searcherContactId,
        registrant_contact_id: input.registrantContactId,
        score: input.score,
        threshold: input.threshold,
        result: input.result,
      });

      if (error) {
        throw new DbError(`writeRouteDecision falló: ${error.message}`, error.code);
      }
    },

    async writeConsentStateChange(input: ConsentStateChangeInput): Promise<void> {
      // Stores consent state transitions in auto_connection_audit for audit trail.
      // Uses the result column to store newState and a JSON result field.
      const { error } = await client.from("auto_connection_audit").insert({
        event_type: AUDIT_EVENT_TYPE.CONSENT_STATE_CHANGE,
        result: `${input.previousState}->${input.newState} by ${input.party}`,
        // consent_id is not a column in auto_connection_audit (design: match_id is the link)
        // We embed it in the result string for traceability.
      });

      if (error) {
        throw new DbError(`writeConsentStateChange falló: ${error.message}`, error.code);
      }
    },
  };
}
