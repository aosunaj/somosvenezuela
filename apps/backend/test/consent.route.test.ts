import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppDeps } from "../src/deps.js";

// Tests de integration de la ruta POST /consent/:id/respond.
// Usa repos falsos y buildApp — no toca Supabase.
// Verifica: validacion de entrada, delegacion al servicio, respuesta HTTP.

const CONSENT_ID = "c5000001-0000-4000-8000-000000000001";
const SEARCHER_CHAN = "c0000001-0000-4000-8000-000000000001";
const REGISTRANT_CHAN = "c0000002-0000-4000-8000-000000000002";
// Canal del buscador (plataforma + chatId) que resuelve a SEARCHER_CHAN.
const SEARCHER_CHANNEL = { plataforma: "telegram", chatId: "tg-searcher" } as const;

function makeDeps(): AppDeps {
  return {
    // core repos (stubs no usados en esta ruta)
    personRepo: {} as AppDeps["personRepo"],
    searchRepo: { isMinorByContactId: vi.fn().mockResolvedValue(false) } as unknown as AppDeps["searchRepo"],
    petRepo: {} as AppDeps["petRepo"],
    petSearchRepo: {} as AppDeps["petSearchRepo"],
    zoneRepo: {} as AppDeps["zoneRepo"],
    needRepo: {} as AppDeps["needRepo"],
    channelLinkRepo: {
      // Por defecto, el canal que llama resuelve al canal del buscador de la sesión.
      findChannelIdByChannel: vi.fn().mockResolvedValue(SEARCHER_CHAN),
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
      getExpiredPendingConsents: vi.fn().mockResolvedValue([]),
      markConsentExpired: vi.fn().mockResolvedValue(undefined),
      // La sesión tiene a SEARCHER_CHAN y REGISTRANT_CHAN como partes.
      getConsentParties: vi.fn().mockResolvedValue({
        searcherChannelId: SEARCHER_CHAN,
        registrantChannelId: REGISTRANT_CHAN,
      }),
    } as unknown as AppDeps["consentRepo"],
    autoMatchThreshold: 0.85,
    serviceToken: "test-token",
  };
}

const EXPIRED_SESSION = {
  id: "c5000099-0000-4000-8000-000000000099",
  searcherChannelId: SEARCHER_CHAN,
  registrantChannelId: REGISTRANT_CHAN,
};

describe("POST /consent/:id/respond — contrato by-channel (B5)", () => {
  it("400 si falta channel", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        decision: "aceptado",
        // channel omitido
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 si decision no es aceptado ni rechazado", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        channel: SEARCHER_CHANNEL,
        decision: "quizas", // invalido
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 si se envía el contrato viejo (party/action/searcherChannelId) — rechazado por .strict()", async () => {
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
    expect(res.statusCode).toBe(400);
  });

  it("200 en aceptado válido (decision 'aceptado' → action 'accept')", async () => {
    const deps = makeDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        channel: SEARCHER_CHANNEL,
        decision: "aceptado",
      },
    });
    expect(res.statusCode).toBe(200);
    // Derivado server-side: el canal es el searcher → acepta como 'searcher'.
    expect(
      (deps.consentRepo as { acceptConsent: ReturnType<typeof vi.fn> }).acceptConsent,
    ).toHaveBeenCalledWith(CONSENT_ID, "searcher");
  });

  it("200 en rechazado válido (decision 'rechazado' → action 'decline')", async () => {
    const deps = makeDeps();
    // El canal que responde resuelve al REGISTRANTE.
    (deps.channelLinkRepo as { findChannelIdByChannel: ReturnType<typeof vi.fn> })
      .findChannelIdByChannel.mockResolvedValue(REGISTRANT_CHAN);
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        channel: { plataforma: "telegram", chatId: "tg-registrant" },
        decision: "rechazado",
      },
    });
    expect(res.statusCode).toBe(200);
    // decline NO llama a acceptConsent.
    expect(
      (deps.consentRepo as { acceptConsent: ReturnType<typeof vi.fn> }).acceptConsent,
    ).not.toHaveBeenCalled();
  });

  it("403 si el canal no es parte de la sesión (no puede responder por otro)", async () => {
    const deps = makeDeps();
    // El canal resuelve a un UUID que NO es ni searcher ni registrant de la sesión.
    (deps.channelLinkRepo as { findChannelIdByChannel: ReturnType<typeof vi.fn> })
      .findChannelIdByChannel.mockResolvedValue("c0000003-0000-4000-8000-000000000003");
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        channel: { plataforma: "telegram", chatId: "tg-intruso" },
        decision: "aceptado",
      },
    });
    expect(res.statusCode).toBe(403);
    // No debe ejecutar ningún efecto del flujo de consentimiento.
    expect(
      (deps.consentRepo as { acceptConsent: ReturnType<typeof vi.fn> }).acceptConsent,
    ).not.toHaveBeenCalled();
  });

  it("404 si el canal no resuelve a channel_id", async () => {
    const deps = makeDeps();
    (deps.channelLinkRepo as { findChannelIdByChannel: ReturnType<typeof vi.fn> })
      .findChannelIdByChannel.mockResolvedValue(null);
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        channel: { plataforma: "telegram", chatId: "tg-desconocido" },
        decision: "aceptado",
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 si la sesión de consentimiento no existe", async () => {
    const deps = makeDeps();
    (deps.consentRepo as { getConsentParties: ReturnType<typeof vi.fn> })
      .getConsentParties.mockResolvedValue(null);
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/consent/${CONSENT_ID}/respond`,
      payload: {
        channel: SEARCHER_CHANNEL,
        decision: "aceptado",
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /consent/sweep — invoca el servicio real (B4) y M3", () => {
  it("401 si el serviceToken es invalido", async () => {
    const deps = makeDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: "/consent/sweep",
      payload: { serviceToken: "token-incorrecto" },
    });
    expect(res.statusCode).toBe(401);
    // No debe siquiera consultar la BD si el token es invalido.
    expect(
      (deps.consentRepo as { getExpiredPendingConsents: ReturnType<typeof vi.fn> })
        .getExpiredPendingConsents,
    ).not.toHaveBeenCalled();
  });

  it("invoca sweepExpiredConsents (getExpiredPendingConsents) y devuelve el conteo real", async () => {
    const deps = makeDeps();
    // Una sesion expirada → swept debe ser 1 (no el stub hardcodeado 0).
    (deps.consentRepo as { getExpiredPendingConsents: ReturnType<typeof vi.fn> })
      .getExpiredPendingConsents.mockResolvedValue([EXPIRED_SESSION]);
    const app = await buildApp(deps);

    const res = await app.inject({
      method: "POST",
      url: "/consent/sweep",
      payload: { serviceToken: "test-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { swept: number };
    expect(body.swept).toBe(1);

    // El handler DEBE haber llamado al servicio real (no el stub no-op):
    expect(
      (deps.consentRepo as { getExpiredPendingConsents: ReturnType<typeof vi.fn> })
        .getExpiredPendingConsents,
    ).toHaveBeenCalledOnce();
    expect(
      (deps.consentRepo as { markConsentExpired: ReturnType<typeof vi.fn> })
        .markConsentExpired,
    ).toHaveBeenCalledWith(EXPIRED_SESSION.id);
  });

  it("sin sesiones expiradas → swept=0 (idempotente)", async () => {
    const deps = makeDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: "/consent/sweep",
      payload: { serviceToken: "test-token" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { swept: number };
    expect(body.swept).toBe(0);
    // Aun asi, debe haber CONSULTADO (no es un stub que devuelve 0 sin mirar).
    expect(
      (deps.consentRepo as { getExpiredPendingConsents: ReturnType<typeof vi.fn> })
        .getExpiredPendingConsents,
    ).toHaveBeenCalledOnce();
  });
});
