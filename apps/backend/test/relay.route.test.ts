import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppDeps } from "../src/deps.js";

// Tests de las rutas de relay (cierre, reveal).
// Solo el cierre es parte de PR3. El reveal (bilateral) es PR4.
// Datos SINTETICOS sin PII.

const RELAY_ID = "e0000001-0000-4000-8000-000000000001";
const CHANNEL_ID = "c0000001-0000-4000-8000-000000000001";

function makeDeps(): AppDeps {
  return {
    personRepo: {} as AppDeps["personRepo"],
    searchRepo: { isMinorByContactId: vi.fn().mockResolvedValue(false) } as unknown as AppDeps["searchRepo"],
    petRepo: {} as AppDeps["petRepo"],
    petSearchRepo: {} as AppDeps["petSearchRepo"],
    zoneRepo: {} as AppDeps["zoneRepo"],
    needRepo: {} as AppDeps["needRepo"],
    channelLinkRepo: {} as AppDeps["channelLinkRepo"],
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
  it("400 si falta channelId (quien cierra el relay)", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/close`,
      payload: {}, // sin channelId
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 al cerrar relay con channelId valido", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/close`,
      payload: { channelId: CHANNEL_ID },
    });
    expect(res.statusCode).toBe(200);
  });

  it("cierra el relay y notifica al otro lado", async () => {
    const deps = makeDeps();
    const app = await buildApp(deps);
    await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/close`,
      payload: { channelId: CHANNEL_ID },
    });
    expect((deps.relayRepo as { closeRelay: ReturnType<typeof vi.fn> }).closeRelay).toHaveBeenCalledWith(RELAY_ID);
    expect((deps.notificationRepo as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledOnce();
  });
});
