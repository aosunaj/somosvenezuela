import { afterEach, describe, expect, it, vi } from "vitest";
import { relayCloseBodySchema } from "../src/routes/relay.js";
// Importamos el CLIENTE REAL del bot por ruta relativa (bot-telegram solo depende
// de core+zod, resolubles desde aquí en el monorepo). Esto acopla el contrato
// cliente↔ruta: el payload que produce el bot DEBE validar contra el schema real
// de la ruta. Un test con un schema reconstruido a mano NO habría atrapado el
// mismatch original ({ channel } vs { channelId }).
import { HttpBackendClient } from "../../bot-telegram/src/http-backend-client.js";

// Test de CONTRATO cliente↔ruta para POST /relay/:id/close.
// Datos SINTÉTICOS sin PII.

const RELAY_ID = "e0000001-0000-4000-8000-000000000001";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("contrato: closeRelay (bot) ↔ relayCloseBodySchema (ruta)", () => {
  it("el body que envía el cliente valida contra el schema real de la ruta", async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return { ok: true, async json() { return {}; } } as unknown as Response;
      }),
    );

    const client = new HttpBackendClient("http://backend.test");
    await client.closeRelay(RELAY_ID, { plataforma: "telegram", chatId: "tg-999" });

    // El schema real de la ruta DEBE aceptar el payload del cliente.
    const parsed = relayCloseBodySchema.safeParse(capturedBody);
    expect(parsed.success).toBe(true);
  });
});
