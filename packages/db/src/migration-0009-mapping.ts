// Migration 0009: pure mapping logic for Modelo A → Modelo B state translation.
//
// This module is intentionally side-effect-free so that the mapping rules can
// be unit-tested without a database connection. The SQL in
// migrations/0009_migrate_reunion_to_consent.sql implements the same logic in
// PostgreSQL; keeping both in sync is the responsibility of whoever edits them.
//
// PROHIBITED: no Supabase client, no IO, no side effects in this file.
// PROHIBITED: no real PII — only structural types and pure functions.

/**
 * Possible values for matches.reunion_estado (Modelo A).
 * Source: migrations/0006_reunion_consent.sql CHECK constraint.
 */
export const REUNION_ESTADO = {
  INACTIVA: "inactiva",
  PENDIENTE: "pendiente",
  INTERCAMBIADO: "intercambiado",
  RECHAZADA: "rechazada",
} as const;

export type ReunionEstado = (typeof REUNION_ESTADO)[keyof typeof REUNION_ESTADO];

/**
 * Possible values for consent_sessions.state (Modelo B).
 * Source: migrations/0008_consent_relay_audit.sql CHECK constraint.
 */
export const CONSENT_STATE = {
  PENDING: "pending",
  BOTH_ACCEPTED: "both_accepted",
  DECLINED: "declined",
  EXPIRED: "expired",
  FAILED_VERIFICATION: "failed_verification",
} as const;

export type ConsentState = (typeof CONSENT_STATE)[keyof typeof CONSENT_STATE];

/**
 * Input row from Modelo A: the columns we read from matches to map to B.
 */
export interface ModelARow {
  /** matches.reunion_estado */
  reunion_estado: ReunionEstado;
  /** matches.consentimiento_buscador */
  consentimiento_buscador: "sin_solicitar" | "solicitado" | "aceptado" | "rechazado";
  /** matches.consentimiento_registrante */
  consentimiento_registrante: "sin_solicitar" | "solicitado" | "aceptado" | "rechazado";
}

/**
 * The subset of consent_sessions fields that the mapping produces.
 * FKs (match_id, contact_ids, channel_ids, created_at, expires_at) are
 * resolved by the SQL JOIN; this type covers only the derivable fields.
 */
export interface MappedConsentFields {
  state: ConsentState;
  searcher_accepted: boolean;
  registrant_accepted: boolean;
}

/**
 * Tells whether a row from Modelo A should be migrated to consent_sessions.
 * Only non-inactiva reuniones are migrated.
 * Pet matches (m.pet_id IS NOT NULL) are also excluded, but that filter is
 * applied in the SQL JOIN — not here, because pet_id is not part of ModelARow.
 */
export function shouldMigrateRow(row: ModelARow): boolean {
  return row.reunion_estado !== REUNION_ESTADO.INACTIVA;
}

/**
 * Maps a Modelo A match row to consent_sessions fields.
 *
 * State mapping:
 *   pendiente     → 'pending'       (buscador aceptó; registrante pendiente)
 *   intercambiado → 'both_accepted' (ambos aceptaron; contacto ya entregado)
 *   rechazada     → 'declined'      (alguna parte rechazó)
 *   inactiva      → null (should never be called; shouldMigrateRow guards this)
 *
 * Boolean derivation: reflects the real column values from Modelo A for
 * fidelity, rather than hard-coding them from the state alone. This covers
 * edge cases (e.g. rechazada donde el buscador también llegó a rechazado).
 *
 * Returns null when the row is not migratable (inactiva).
 */
export function mapModelAToConsentFields(row: ModelARow): MappedConsentFields | null {
  if (!shouldMigrateRow(row)) {
    return null;
  }

  const stateMap: Record<Exclude<ReunionEstado, "inactiva">, ConsentState> = {
    pendiente: CONSENT_STATE.PENDING,
    intercambiado: CONSENT_STATE.BOTH_ACCEPTED,
    rechazada: CONSENT_STATE.DECLINED,
  };

  const state = stateMap[row.reunion_estado as Exclude<ReunionEstado, "inactiva">];

  return {
    state,
    searcher_accepted: row.consentimiento_buscador === "aceptado",
    registrant_accepted: row.consentimiento_registrante === "aceptado",
  };
}
