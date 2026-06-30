import { PHONE_REGEX } from "core/utils/scanRelayContent";
import { assertEstadoASalvoValido } from "core";

// Guardrails scan module (judgment-r3 item 12).
//
// Exposes utilities for asserting privacy and safety invariants across all slices.
// Used by:
//   - Runtime checks in backend services (gates per slice).
//   - Test-level assertions (guardrails-scan.test.ts).
//   - sdd-verify phase.
//
// PHONE_REGEX is imported from core/utils/scanRelayContent (shared regex,
// judgment-r3 item 12) — the same regex used by the relay intercept in the
// Telegram adapter (PR4). One regex, two uses: adapter blocks at forward-time,
// scan checks stored rows.

// ── Public columns (verify these NEVER include verification fields) ──────────

/**
 * The set of columns exposed in public person/pet views.
 * verification_question and verification_answer_hash MUST NOT be here.
 * This constant is used by tests and sdd-verify to assert the invariant.
 */
export const PERSON_PUBLIC_COLUMNS: readonly string[] = [
  "id",
  "nombre",
  "apellidos",
  "edad",
  "zona",
  "descripcion",
  "foto_url",
  "estado",
  "fuente",
  "verificacion",
  "created_at",
  "updated_at",
] as const;

// ── Slice registry (A–E) ─────────────────────────────────────────────────────

/**
 * All slice identifiers for the auto-reunion flow.
 * The scan gate must pass all of these before going live.
 *
 * A: Match scoring + routing decision (routeMatch)
 * B: Auto-notify (consent_session open + dual notification)
 * C: Relay intercept + phone scan (adapter layer)
 * D: Rescatado flow (Slice D — found person reported by searcher)
 * E: Risk alerts (fan-out heuristics, operator notification)
 */
export const GUARDRAIL_SLICES: readonly string[] = ["A", "B", "C", "D", "E"] as const;

// ── Scan functions ───────────────────────────────────────────────────────────

/** Result of a guardrail scan check. */
export interface ScanCheckResult {
  readonly pass: boolean;
  readonly violation?: string;
}

/**
 * Scans a text value for phone numbers using the shared PHONE_REGEX.
 * Returns a violation if a phone is found.
 *
 * Use this to assert that relay-forwarded content stored in the notifications
 * table does not contain phone numbers (guardrail #1).
 */
export function scanForPhone(text: string): ScanCheckResult {
  if (PHONE_REGEX.test(text)) {
    return {
      pass: false,
      violation: `phone number detected in content: "${text.slice(0, 40)}..."`,
    };
  }
  return { pass: true };
}

/**
 * Scans a consent_sessions or relay_sessions row for unexpected phone fields.
 * Returns a violation if any key matches a phone-like column name.
 *
 * This is a schema-level check: the row object should never have keys like
 * 'telefono', 'phone', 'celular', or similar PII fields.
 */
export function scanRowForPhoneColumns(row: Record<string, unknown>): ScanCheckResult {
  const phoneKeys = Object.keys(row).filter((k) =>
    ["telefono", "phone", "celular", "movil", "tel"].some((p) => k.toLowerCase().includes(p)),
  );
  if (phoneKeys.length > 0) {
    return {
      pass: false,
      violation: `row contains phone-like columns: ${phoneKeys.join(", ")}`,
    };
  }
  return { pass: true };
}

/**
 * Gate for the a_salvo state (guardrail #4): a_salvo is only reachable with
 * human confirmation (verificacion='verificada').
 *
 * Wraps assertEstadoASalvoValido from core, translating GuardrailError to a
 * ScanCheckResult (so the caller can choose to throw or log).
 *
 * Non-a_salvo states always pass (no gate needed for other estados).
 */
export function scanASalvoGate(input: {
  estado: string;
  verificacion: string;
}): ScanCheckResult {
  if (input.estado !== "a_salvo") {
    return { pass: true };
  }

  try {
    // assertEstadoASalvoValido throws GuardrailError if verificacion is not 'verificada'.
    assertEstadoASalvoValido({
      estado: "a_salvo",
      verificacion: input.verificacion as "verificada" | "sin_verificar",
    });
    return { pass: true };
  } catch {
    return {
      pass: false,
      violation: `a_salvo state requires verificacion='verificada', got '${input.verificacion}'`,
    };
  }
}

/**
 * Checks that a public-facing column list does not include sensitive fields.
 * Asserts: verification_question and verification_answer_hash are absent.
 */
export function scanPublicColumns(columns: readonly string[]): ScanCheckResult {
  const sensitive = ["verification_question", "verification_answer_hash"];
  const found = columns.filter((c) => sensitive.includes(c));
  if (found.length > 0) {
    return {
      pass: false,
      violation: `public view exposes sensitive columns: ${found.join(", ")}`,
    };
  }
  return { pass: true };
}

// Re-export PHONE_REGEX so callers can use the shared regex directly.
export { PHONE_REGEX };
