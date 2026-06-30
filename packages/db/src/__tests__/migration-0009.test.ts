import { describe, expect, it } from "vitest";
import {
  mapModelAToConsentFields,
  shouldMigrateRow,
  REUNION_ESTADO,
  CONSENT_STATE,
  type ModelARow,
} from "../migration-0009-mapping.js";

// Tests for 0009_migrate_reunion_to_consent.sql mapping logic.
//
// PROHIBITED: no Supabase/DB calls — pure unit tests only.
// All data is SYNTHETIC; no real PII.
//
// Coverage:
//   1. State mapping A → B (all four reunion_estado values)
//   2. Boolean derivation for searcher_accepted / registrant_accepted
//   3. shouldMigrateRow filter (inactiva excluded)
//   4. Idempotency contract (re-mapping same input = same output)

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ModelARow> = {}): ModelARow {
  return {
    reunion_estado: REUNION_ESTADO.PENDIENTE,
    consentimiento_buscador: "aceptado",
    consentimiento_registrante: "solicitado",
    ...overrides,
  };
}

// ── State mapping ──────────────────────────────────────────────────────────

describe("mapModelAToConsentFields — state mapping", () => {
  it("maps pendiente → 'pending'", () => {
    const result = mapModelAToConsentFields(
      makeRow({ reunion_estado: REUNION_ESTADO.PENDIENTE }),
    );
    expect(result?.state).toBe(CONSENT_STATE.PENDING);
  });

  it("maps intercambiado → 'both_accepted'", () => {
    const result = mapModelAToConsentFields(
      makeRow({
        reunion_estado: REUNION_ESTADO.INTERCAMBIADO,
        consentimiento_buscador: "aceptado",
        consentimiento_registrante: "aceptado",
      }),
    );
    expect(result?.state).toBe(CONSENT_STATE.BOTH_ACCEPTED);
  });

  it("maps rechazada → 'declined'", () => {
    const result = mapModelAToConsentFields(
      makeRow({
        reunion_estado: REUNION_ESTADO.RECHAZADA,
        consentimiento_buscador: "aceptado",
        consentimiento_registrante: "rechazado",
      }),
    );
    expect(result?.state).toBe(CONSENT_STATE.DECLINED);
  });

  it("returns null for inactiva (should not be migrated)", () => {
    const result = mapModelAToConsentFields(
      makeRow({ reunion_estado: REUNION_ESTADO.INACTIVA }),
    );
    expect(result).toBeNull();
  });
});

// ── Boolean derivation ─────────────────────────────────────────────────────

describe("mapModelAToConsentFields — boolean derivation", () => {
  it("searcher_accepted is true when consentimiento_buscador = 'aceptado'", () => {
    const result = mapModelAToConsentFields(
      makeRow({ consentimiento_buscador: "aceptado" }),
    );
    expect(result?.searcher_accepted).toBe(true);
  });

  it("searcher_accepted is false when consentimiento_buscador = 'solicitado'", () => {
    // Edge case: shouldn't normally happen (buscador siempre acepta al iniciar),
    // but we map faithfully from the real column value.
    const result = mapModelAToConsentFields(
      makeRow({ consentimiento_buscador: "solicitado" }),
    );
    expect(result?.searcher_accepted).toBe(false);
  });

  it("registrant_accepted is false when consentimiento_registrante = 'solicitado'", () => {
    // Typical pendiente case: registrante still deciding.
    const result = mapModelAToConsentFields(
      makeRow({
        reunion_estado: REUNION_ESTADO.PENDIENTE,
        consentimiento_registrante: "solicitado",
      }),
    );
    expect(result?.registrant_accepted).toBe(false);
  });

  it("registrant_accepted is true when consentimiento_registrante = 'aceptado'", () => {
    const result = mapModelAToConsentFields(
      makeRow({
        reunion_estado: REUNION_ESTADO.INTERCAMBIADO,
        consentimiento_buscador: "aceptado",
        consentimiento_registrante: "aceptado",
      }),
    );
    expect(result?.registrant_accepted).toBe(true);
  });

  it("intercambiado always yields both booleans true (double consent invariant)", () => {
    const result = mapModelAToConsentFields(
      makeRow({
        reunion_estado: REUNION_ESTADO.INTERCAMBIADO,
        consentimiento_buscador: "aceptado",
        consentimiento_registrante: "aceptado",
      }),
    );
    expect(result?.searcher_accepted).toBe(true);
    expect(result?.registrant_accepted).toBe(true);
  });

  it("rechazada with buscador rejected: searcher_accepted is false", () => {
    // Edge case: buscador reconsidered (or data anomaly). Map faithfully.
    const result = mapModelAToConsentFields(
      makeRow({
        reunion_estado: REUNION_ESTADO.RECHAZADA,
        consentimiento_buscador: "rechazado",
        consentimiento_registrante: "rechazado",
      }),
    );
    expect(result?.searcher_accepted).toBe(false);
    expect(result?.registrant_accepted).toBe(false);
  });
});

// ── shouldMigrateRow filter ────────────────────────────────────────────────

describe("shouldMigrateRow", () => {
  it("returns false for inactiva (should not migrate)", () => {
    expect(shouldMigrateRow(makeRow({ reunion_estado: REUNION_ESTADO.INACTIVA }))).toBe(false);
  });

  it("returns true for pendiente", () => {
    expect(shouldMigrateRow(makeRow({ reunion_estado: REUNION_ESTADO.PENDIENTE }))).toBe(true);
  });

  it("returns true for intercambiado", () => {
    expect(
      shouldMigrateRow(makeRow({ reunion_estado: REUNION_ESTADO.INTERCAMBIADO })),
    ).toBe(true);
  });

  it("returns true for rechazada", () => {
    expect(shouldMigrateRow(makeRow({ reunion_estado: REUNION_ESTADO.RECHAZADA }))).toBe(true);
  });
});

// ── Idempotency (re-mapping) ───────────────────────────────────────────────

describe("mapModelAToConsentFields — idempotency", () => {
  it("mapping the same input twice produces identical output", () => {
    const row = makeRow({
      reunion_estado: REUNION_ESTADO.PENDIENTE,
      consentimiento_buscador: "aceptado",
      consentimiento_registrante: "solicitado",
    });

    const first = mapModelAToConsentFields(row);
    const second = mapModelAToConsentFields(row);

    expect(first).toEqual(second);
  });

  it("mapping does not mutate the input row", () => {
    const row = makeRow({ reunion_estado: REUNION_ESTADO.PENDIENTE });
    const original = { ...row };

    mapModelAToConsentFields(row);

    expect(row).toEqual(original);
  });
});

// ── SQL migration coverage notes ───────────────────────────────────────────
//
// The following behaviors are enforced in SQL (0009_migrate_reunion_to_consent.sql)
// and CANNOT be tested without a live DB, but are documented here for traceability:
//
// 1. IDEMPOTENCY (ON CONFLICT DO NOTHING on migrated_from_match_unique):
//    Running the SQL twice produces the same rows, no duplicates.
//
// 2. OMISSION CASES (INNER JOINs skip silently):
//    - search_id IS NULL or search was deleted → row skipped.
//    - searches.buscador_contact_id IS NULL → row skipped.
//    - matches.person_id IS NULL → row skipped.
//    - persons.contact_id IS NULL → row skipped.
//    - No channels for searcher contact → row skipped.
//    - No channels for registrant contact → row skipped.
//    - matches.pet_id IS NOT NULL → row skipped (pet matches use different flow).
//
// 3. CHANNEL SELECTION: first channel by created_at asc per contact_id.
//
// 4. NO RELAY SESSION CREATED: intercambiado rows land in both_accepted without
//    a relay_session. This is correct — the contact was already delivered by
//    Modelo A's point-to-point notification. No new channel is opened.
//
// 5. expires_at = '9999-12-31' for all migrated rows (no natural expiry).
