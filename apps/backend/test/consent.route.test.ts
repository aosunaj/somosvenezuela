import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppDeps } from "../src/deps.js";

// Tests de integration de la ruta POST /consent/:id/respond.
// Usa repos falsos y buildApp — no toca Supabase.
// Verifica: validacion de entrada, delegacion al servicio, respuesta HTTP.

const CONSENT_ID = "c5000001-0000-4000-8000-000000000001";
const SEARCHER_CHAN = "c0000001-0000-4000-8000-000000000001";
const REGISTRANT_CHAN = "c0000002-0000-4000-8000-000000000002";

function makeDeps(): AppDeps {
  return {
    // core repos (stubs no usados en esta ruta)
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
      getActiveRelay: vi.fn().mockResolvedValue(null),
      closeRelay: vi.fn(),
    } as unknown as AppDeps["relayRepo"],
    auditRepo: {
      writeRouteDecision: vi.fn().mockResolvedValue(undefined),
      writeConsentStateChange: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppDeps["auditRepo"],
    consentRepo: {
      acceptConsent: vi.fn().mockResolvedValue("accepted_one"),
      openConsentSession: vi.fn(),
      closeRelaysAndDeleteContact: vi.fn(),
      anonymizeAuditContact: vi.fn(),
    } as unknown as AppDeps["consentRepo"],
    autoMatchThreshold: 0.85,
    serviceToken: "test-token",
  };
}

describe("POST /consent/:id/respond", () => {
  it("400 si falta party", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        action: "accept",
        searcherChannelId: SEARCHER_CHAN,
        registrantChannelId: REGISTRANT_CHAN,
        // party omitida
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 si action no es accept ni decline", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        party: "searcher",
        action: "maybe", // invalido
        searcherChannelId: SEARCHER_CHAN,
        registrantChannelId: REGISTRANT_CHAN,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 en accept valido", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        party: "searcher",
        action: "accept",
        searcherChannelId: SEARCHER_CHAN,
        registrantChannelId: REGISTRANT_CHAN,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("200 en decline valido", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        party: "registrant",
        action: "decline",
        searcherChannelId: SEARCHER_CHAN,
        registrantChannelId: REGISTRANT_CHAN,
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
