import { afterEach, describe, expect, it, vi } from "vitest";
import { respondBodySchema } from "../src/routes/consent.js";
// Cliente REAL del bot por ruta relativa (bot-telegram solo depende de core+zod).
// Acopla el contrato cliente↔ruta: el payload que produce el bot para responder un
// consentimiento DEBE validar contra el schema real de POST /consent/:id/respond.
// Un schema reconstruido a mano NO habría atrapado el mismatch original
// ({ decision, channel } del cliente vs { party, action, searcherChannelId, ... }
// que esperaba la ruta con .strict() → 400).
import { HttpBackendClient } from "../../bot-telegram/src/http-backend-client.js";

// Test de CONTRATO cliente↔ruta para POST /consent/:id/respond (B5).
// Datos SINTÉTICOS sin PII.

const CONSENT_ID = "c5000001-0000-4000-8000-000000000001";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("contrato: respondConsent (bot) ↔ respondBodySchema (ruta)", () => {
  it("el body 'aceptado' que envía el cliente valida contra el schema real de la ruta", async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return { ok: true, async json() { return {}; } } as unknown as Response;
      }),
    );

    const client = new HttpBackendClient("http://backend.test");
    await client.respondConsent(CONSENT_ID, "aceptado", {
      plataforma: "telegram",
      chatId: "tg-555",
    });

    const parsed = respondBodySchema.safeParse(capturedBody);
    expect(parsed.success).toBe(true);
  });

  it("el body 'rechazado' que envía el cliente valida contra el schema real de la ruta", async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return { ok: true, async json() { return {}; } } as unknown as Response;
      }),
    );

    const client = new HttpBackendClient("http://backend.test");
    await client.respondConsent(CONSENT_ID, "rechazado", {
      plataforma: "telegram",
      chatId: "tg-555",
    });

    const parsed = respondBodySchema.safeParse(capturedBody);
    expect(parsed.success).toBe(true);
  });
});
