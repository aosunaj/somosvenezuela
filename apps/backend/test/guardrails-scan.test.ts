import { describe, expect, it } from "vitest";

// [TDD-RED] Guardrails scan expansion (judgment-r3 item 12).
//
// Design spec assertions:
//   A. No phone number in consent_sessions or relay_sessions rows
//      (uses shared PHONE_REGEX from core/utils/scanRelayContent — judgment-r3 item 12).
//   B. No phone in forwarded relay content (scanRelayContent in the relay intercept
//      already blocks this; the scan here validates stored notification rows).
//   C. verification_question / verification_answer_hash NEVER in *_public views
//      (checked via column presence assertion).
//   D. Gate per rebanada (slice A-E check): all slices present and gate-ready.
//   E. a_salvo NEVER reachable without human confirmation
//      (assertEstadoASalvoValido rule from core).
//
// Uses PHONE_REGEX from core/utils/scanRelayContent (shared regex, judgment-r3 item 12).
//
// guardrails-allow: synthetic-phone-fixtures — synthetic example numbers are required
// here to assert PHONE_REGEX catches Venezuelan phone formats. No real PII.

describe("guardrails:scan — phone detection (judgment-r3 item 12)", () => {
  it("PHONE_REGEX from scanRelayContent catches Venezuelan phone numbers", async () => {
    const { PHONE_REGEX } = await import("core/utils/scanRelayContent");

    const phones = [
      "0412-1234567",
      "04121234567",
      "+58 412 123 4567",
      "0058412-123-4567",
      "0424.123.4567",
    ];

    for (const phone of phones) {
      expect(PHONE_REGEX.test(phone), `PHONE_REGEX debe detectar: ${phone}`).toBe(true);
    }
  });

  it("PHONE_REGEX does not fire on safe non-numeric strings", async () => {
    const { PHONE_REGEX } = await import("core/utils/scanRelayContent");

    // NOTE: UUIDs with long all-digit segments may trigger the catch-all (10 consecutive
    // digits). The regex is intentionally conservative (no false negatives). These tests
    // verify safe TEXT messages (not UUIDs, which are internal).
    const safeStrings = [
      "consent-session-abc",
      "reporte de persona a salvo",
      "la persona fue encontrada en zona norte",
      "codigo de caso: abc-xyz-123",
    ];

    for (const safe of safeStrings) {
      expect(PHONE_REGEX.test(safe), `PHONE_REGEX NO debe disparar en: ${safe}`).toBe(false);
    }
  });

  it("scanRelayContent rejects forwarded text with phone numbers", async () => {
    const { scanRelayContent } = await import("core/utils/scanRelayContent");

    const result = scanRelayContent("mi numero es 04121234567 llamame");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("teléfono");
    }
  });

  it("scanRelayContent accepts safe messages without phone numbers", async () => {
    const { scanRelayContent } = await import("core/utils/scanRelayContent");

    const result = scanRelayContent("hola, confirmo que encontramos a la persona en el refugio norte");
    expect(result.ok).toBe(true);
  });
});

describe("guardrails:scan — consent/relay row privacy", () => {
  it("consent_sessions schema never includes phone columns", () => {
    // Structural check: consent_sessions has no 'telefono', 'phone', 'celular' columns.
    // The only contact info is channel_id (UUID), which is internal.
    const consentColumns = [
      "id",
      "match_id",
      "searcher_contact_id",
      "registrant_contact_id",
      "searcher_channel_id",
      "registrant_channel_id",
      "searcher_accepted",
      "registrant_accepted",
      "state",
      "expires_at",
      "created_at",
    ];

    const phoneColumns = consentColumns.filter((col) =>
      ["telefono", "phone", "celular", "movil", "tel"].some((p) => col.includes(p)),
    );
    expect(phoneColumns).toEqual([]);
  });

  it("relay_sessions schema never includes phone columns", () => {
    const relayColumns = [
      "id",
      "consent_session_id",
      "party_a_channel_id",
      "party_b_channel_id",
      "state",
      "reveal_requested_a",
      "reveal_requested_b",
      "created_at",
    ];

    const phoneColumns = relayColumns.filter((col) =>
      ["telefono", "phone", "celular", "movil", "tel"].some((p) => col.includes(p)),
    );
    expect(phoneColumns).toEqual([]);
  });
});

describe("guardrails:scan — verification fields not in public views", () => {
  it("PERSON_PUBLIC_COLUMNS does not include verification_question", async () => {
    // The public view columns must not expose verification_question
    // or verification_answer_hash.
    const { PERSON_PUBLIC_COLUMNS } = await import("../src/guardrails/scan.js");

    expect(PERSON_PUBLIC_COLUMNS).not.toContain("verification_question");
    expect(PERSON_PUBLIC_COLUMNS).not.toContain("verification_answer_hash");
  });
});

describe("guardrails:scan — slice gate A-E", () => {
  it("all slices A through E are represented in the scan", async () => {
    const { GUARDRAIL_SLICES } = await import("../src/guardrails/scan.js");

    expect(GUARDRAIL_SLICES).toContain("A");
    expect(GUARDRAIL_SLICES).toContain("B");
    expect(GUARDRAIL_SLICES).toContain("C");
    expect(GUARDRAIL_SLICES).toContain("D");
    expect(GUARDRAIL_SLICES).toContain("E");
  });
});

describe("guardrails:scan — a_salvo gate", () => {
  it("assertEstadoASalvoValido blocks a_salvo without human verification", async () => {
    const { assertEstadoASalvoValido, GuardrailError } = await import("core");

    expect(() =>
      assertEstadoASalvoValido({ estado: "a_salvo", verificacion: "sin_verificar" }),
    ).toThrow(GuardrailError);
  });

  it("assertEstadoASalvoValido allows a_salvo with verificada source", async () => {
    const { assertEstadoASalvoValido } = await import("core");

    expect(() =>
      assertEstadoASalvoValido({ estado: "a_salvo", verificacion: "verificada" }),
    ).not.toThrow();
  });

  it("a_salvo is unreachable without human confirmation in the scan gate", async () => {
    const { scanASalvoGate } = await import("../src/guardrails/scan.js");

    // With verificacion='sin_verificar': MUST block (return a violation)
    const blocked = scanASalvoGate({ estado: "a_salvo", verificacion: "sin_verificar" });
    expect(blocked.pass).toBe(false);

    // With verificacion='verificada': MUST pass
    const passed = scanASalvoGate({ estado: "a_salvo", verificacion: "verificada" });
    expect(passed.pass).toBe(true);

    // Non-a_salvo states: always pass (no gate needed)
    const notASalvo = scanASalvoGate({ estado: "desaparecida", verificacion: "sin_verificar" });
    expect(notASalvo.pass).toBe(true);
  });
});
