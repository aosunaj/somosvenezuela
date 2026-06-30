import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppDeps } from "../src/deps.js";

// Tests de las rutas de relay (cierre, reveal).
// Solo el cierre es parte de PR3. El reveal (bilateral) es PR4.
// Datos SINTETICOS sin PII.

const RELAY_ID = "e0000001-0000-4000-8000-000000000001";
const CHANNEL_ID = "c0000001-0000-4000-8000-000000000001";
const CHAT_ID = "tg-12345";

function makeDeps(): AppDeps {
  return {
    personRepo: {} as AppDeps["personRepo"],
    searchRepo: { isMinorByContactId: vi.fn().mockResolvedValue(false) } as unknown as AppDeps["searchRepo"],
    petRepo: {} as AppDeps["petRepo"],
    petSearchRepo: {} as AppDeps["petSearchRepo"],
    zoneRepo: {} as AppDeps["zoneRepo"],
    needRepo: {} as AppDeps["needRepo"],
    channelLinkRepo: {
      // Resuelve (plataforma, chatId) → channel_id interno. La ruta close lo usa.
      findChannelIdByChannel: vi.fn().mockResolvedValue(CHANNEL_ID),
      findContactByChannel: vi.fn().mockResolvedValue(null),
      ensureChannel: vi.fn(),
    } as unknown as AppDeps["channelLinkRepo"],
    channelRepo: {} as AppDeps["channelRepo"],
    notificationRepo: {
      create: vi.fn().mockResolvedValue({ id: "n-1" }),
      listPending: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(),
    } as unknown as AppDeps["notificationRepo"],
    matchRepo: {} as AppDeps["matchRepo"],
    secureDeleteRepo: {} as AppDeps["secureDeleteRepo"],
    personStateAuditRepo: {} as AppDeps["personStateAuditRepo"],
    relayRepo: {
      getActiveRelay: vi.fn().mockResolvedValue({ relayId: RELAY_ID, otherChannelId: "c0000002-0000-4000-8000-000000000002" }),
      closeRelay: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppDeps["relayRepo"],
    auditRepo: {
      writeRouteDecision: vi.fn().mockResolvedValue(undefined),
      writeConsentStateChange: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppDeps["auditRepo"],
    consentRepo: {
      acceptConsent: vi.fn(),
      openConsentSession: vi.fn(),
      closeRelaysAndDeleteContact: vi.fn(),
      anonymizeAuditContact: vi.fn(),
    } as unknown as AppDeps["consentRepo"],
    autoMatchThreshold: 0.85,
    serviceToken: "test-token",
  };
}

describe("POST /relay/:id/close", () => {
  it("400 si falta channel (quien cierra el relay)", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/close`,
      payload: {}, // sin channel
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 si el viejo contrato channelId (UUID directo) se envia — ya no se acepta", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/close`,
      payload: { channelId: CHANNEL_ID }, // contrato viejo, rechazado por .strict()
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 al cerrar relay con channel (plataforma + chatId) valido", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/close`,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_ID } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("404 si el canal (plataforma, chatId) no resuelve a channel_id", async () => {
    const deps = makeDeps();
    (deps.channelLinkRepo as { findChannelIdByChannel: ReturnType<typeof vi.fn> })
      .findChannelIdByChannel.mockResolvedValue(null);
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/close`,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_ID } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("cierra el relay y notifica al otro lado", async () => {
    const deps = makeDeps();
    const app = await buildApp(deps);
    await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/close`,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_ID } },
    });
    expect((deps.relayRepo as { closeRelay: ReturnType<typeof vi.fn> }).closeRelay).toHaveBeenCalledWith(RELAY_ID);
    expect((deps.notificationRepo as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledOnce();
  });
});
