import { afterEach, describe, expect, it, vi } from "vitest";
import { rescatadoBodySchema } from "../src/routes/rescatado.js";
// Cliente REAL del bot por ruta relativa (bot-telegram solo depende de core+zod).
// Acopla el contrato cliente↔ruta: el payload del bot DEBE validar contra el
// schema real de POST /rescatado. Un schema reconstruido a mano no habria
// atrapado el mismatch original ({ personId, channel } vs { personId, searchId,
// searcherChannelId, ... }).
import { HttpBackendClient } from "../../bot-telegram/src/http-backend-client.js";

// Test de CONTRATO cliente↔ruta para POST /rescatado.
// Datos SINTETICOS sin PII.

const PERSON_ID = "cccccccc-0000-4000-8000-000000000003";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("contrato: reportRescatado (bot) ↔ rescatadoBodySchema (ruta)", () => {
  it("el body que envia el cliente valida contra el schema real de la ruta", async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return {
          ok: true,
          async json() {
            return { outcome: "queued" };
          },
        } as unknown as Response;
      }),
    );

    const client = new HttpBackendClient("http://backend.test");
    await client.reportRescatado(PERSON_ID, { plataforma: "telegram", chatId: "tg-777" });

    const parsed = rescatadoBodySchema.safeParse(capturedBody);
    expect(parsed.success).toBe(true);
  });
});
