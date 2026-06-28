import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../src/verify-signature.js";

// Verificacion de la firma del webhook de WhatsApp (guardrail #6, requisito del spec
// 02: "verificacion de firma de webhook WhatsApp probada"). Usamos un App Secret
// SINTETICO (no es una credencial real) y un cuerpo de ejemplo cualquiera.

// App Secret sintetico solo para los tests: no es un secreto real.
const APP_SECRET = "synthetic-app-secret-for-tests";

/** Firma un cuerpo igual que lo haria Meta: 'sha256=' + HMAC-SHA256(secret, body). */
function signBody(rawBody: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${digest}`;
}

describe("verifySignature", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("acepta una firma valida calculada con el App Secret correcto", () => {
    const header = signBody(body, APP_SECRET);
    expect(verifySignature(body, header, APP_SECRET)).toBe(true);
  });

  it("acepta cuando el cuerpo llega como Buffer (bytes crudos)", () => {
    const header = signBody(body, APP_SECRET);
    expect(verifySignature(Buffer.from(body, "utf8"), header, APP_SECRET)).toBe(true);
  });

  it("rechaza una firma calculada con otro secreto", () => {
    const header = signBody(body, "otro-secreto-distinto");
    expect(verifySignature(body, header, APP_SECRET)).toBe(false);
  });

  it("rechaza si el cuerpo fue manipulado tras firmar", () => {
    const header = signBody(body, APP_SECRET);
    const tampered = body + " ";
    expect(verifySignature(tampered, header, APP_SECRET)).toBe(false);
  });

  it("rechaza una firma ausente (header undefined)", () => {
    expect(verifySignature(body, undefined, APP_SECRET)).toBe(false);
  });

  it("rechaza un header sin el prefijo sha256=", () => {
    const digest = createHmac("sha256", APP_SECRET).update(body).digest("hex");
    // Mismo digest pero sin el prefijo esperado: debe rechazarse.
    expect(verifySignature(body, digest, APP_SECRET)).toBe(false);
  });

  it("rechaza un header con formato hexadecimal invalido", () => {
    expect(verifySignature(body, "sha256=no-es-hex", APP_SECRET)).toBe(false);
  });

  it("rechaza un header vacio", () => {
    expect(verifySignature(body, "", APP_SECRET)).toBe(false);
  });
});
