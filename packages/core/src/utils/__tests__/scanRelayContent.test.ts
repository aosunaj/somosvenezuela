import { describe, expect, it } from "vitest";
import { scanRelayContent } from "../scanRelayContent.js";

// Tests [RED → GREEN] for scanRelayContent (judgment-r3 item 12).
//
// guardrail #1: NEVER forward a phone number through a relay.
// This function is shared between the relay intercept (PR4) and guardrails:scan (PR6).
// Phone detection must be BLOCKING: return { ok: false } on any phone-like pattern.

describe("scanRelayContent — clean text", () => {
  it("returns ok:true for plain text without phone patterns", () => {
    expect(scanRelayContent("Hola, ¿cómo estás?")).toEqual({ ok: true });
  });

  it("returns ok:true for empty string", () => {
    expect(scanRelayContent("")).toEqual({ ok: true });
  });

  it("returns ok:true for a long message without phone numbers", () => {
    expect(
      scanRelayContent(
        "Mi hermano se llama Juan Pérez, tiene 35 años y vive en la Zona Norte. " +
        "Lleva 3 días sin contacto. Tiene una cicatriz en el brazo derecho.",
      ),
    ).toEqual({ ok: true });
  });

  it("returns ok:true for text with only digits that are not phone-length", () => {
    expect(scanRelayContent("Tiene 3 hijos y 12 años")).toEqual({ ok: true });
  });

  it("returns ok:true for an id or code that is not a phone", () => {
    expect(scanRelayContent("Su codigo es 12345678")).toEqual({ ok: true });
  });
});

describe("scanRelayContent — Venezuelan phone formats", () => {
  it("detects +58 international prefix", () => {
    const result = scanRelayContent("Llámame al +58 412 1234567");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/teléfono/i);
  });

  it("detects 0058 international prefix", () => {
    const result = scanRelayContent("El número es 0058 424 9876543");
    expect(result.ok).toBe(false);
  });

  it("detects local 04xx prefix (11 digits)", () => {
    const result = scanRelayContent("Mi celular: 0412-3456789");
    expect(result.ok).toBe(false);
  });

  it("detects 04xx without leading zero (10 digits starting with 4)", () => {
    const result = scanRelayContent("Escríbeme al 4121234567");
    expect(result.ok).toBe(false);
  });

  it("detects phone with spaces between digit groups", () => {
    const result = scanRelayContent("Puedes llamar al 0416 555 1234");
    expect(result.ok).toBe(false);
  });

  it("detects phone with dots as separators", () => {
    const result = scanRelayContent("Tel: 0424.123.4567");
    expect(result.ok).toBe(false);
  });

  it("detects phone embedded mid-sentence", () => {
    const result = scanRelayContent(
      "Por favor contáctame, mi número es 04141234567 y estoy disponible",
    );
    expect(result.ok).toBe(false);
  });
});

describe("scanRelayContent — international phone formats", () => {
  it("detects generic +1 US/Canada format", () => {
    const result = scanRelayContent("Llámame al +1 555 123 4567");
    expect(result.ok).toBe(false);
  });

  it("detects +34 Spain format", () => {
    const result = scanRelayContent("Mi teléfono en España: +34 612 345 678");
    expect(result.ok).toBe(false);
  });

  it("detects +1 without country code label", () => {
    const result = scanRelayContent("Número: +15551234567");
    expect(result.ok).toBe(false);
  });

  it("detects 10-digit number without country code", () => {
    // 10 consecutive digits — a common phone length worldwide
    const result = scanRelayContent("Contáctame al 5551234567");
    expect(result.ok).toBe(false);
  });
});

describe("scanRelayContent — edge cases", () => {
  it("detects phone number in all-caps context", () => {
    const result = scanRelayContent("CONTACTO: 0414 123 4567");
    expect(result.ok).toBe(false);
  });

  it("does not flag a year (4 digits) as a phone", () => {
    expect(scanRelayContent("En 2026 ocurrió el terremoto")).toEqual({ ok: true });
  });

  it("does not flag a short reference code (5-7 digits)", () => {
    expect(scanRelayContent("Código de caso: 123456")).toEqual({ ok: true });
  });

  it("returns reason string when phone is detected", () => {
    const result = scanRelayContent("+58 412 9999999");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
