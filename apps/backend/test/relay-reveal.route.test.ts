import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppDeps } from "../src/deps.js";

// Tests de POST /relay/:id/reveal (revelado bilateral de contacto, PR7).
//
// GUARDRAIL CRITICO: el telefono NUNCA viaja hasta que AMBAS partes pidieron
// el reveal explicitamente. Estos tests verifican que:
//   - El auth (x-bot-secret) bloquea sin el secreto correcto.
//   - El body pattern by-channel (plataforma + chatId) se valida.
//   - Un canal ajeno al relay recibe 403.
//   - Si solo una parte pide: notificacion a la que pide (espera) + aviso a la otra
//     (alguien quiere revelar), sin telefono en ningun payload.
//   - Si AMBAS pidieron: notificacion con telefono a cada parte (solo entonces).
//   - Idempotencia: pedir dos veces no duplica la notificacion de exchange.
//
// Datos 100% sinteticos (guardrail: sin PII real en tests).

const RELAY_ID = "e0000007-0000-4000-8000-000000000007";
const CHANNEL_A = "ca000001-0000-4000-8000-000000000001";
const CHANNEL_B = "cb000001-0000-4000-8000-000000000001";
const CONTACT_A_ID = "da000001-0000-4000-8000-000000000001";
const CONTACT_B_ID = "db000001-0000-4000-8000-000000000001";
const PHONE_A = "+582121111111";
const PHONE_B = "+582122222222";
const CHAT_A = "tg-party-a";
const BOT_SECRET = "test-secret-pr7";
const BOT_HEADERS = { "x-bot-secret": BOT_SECRET };

/** Fila de relay_sessions con flags de reveal. */
interface RelayParties {
  relayId: string;
  partyAChannelId: string;
  partyBChannelId: string;
  revealRequestedA: boolean;
  revealRequestedB: boolean;
  partyAContactId: string;
  partyBContactId: string;
}

function makeRelayParties(
  opts: { revealA?: boolean; revealB?: boolean } = {},
): RelayParties {
  return {
    relayId: RELAY_ID,
    partyAChannelId: CHANNEL_A,
    partyBChannelId: CHANNEL_B,
    revealRequestedA: opts.revealA ?? false,
    revealRequestedB: opts.revealB ?? false,
    partyAContactId: CONTACT_A_ID,
    partyBContactId: CONTACT_B_ID,
  };
}

interface FakeContact {
  id: string;
  telefono: string | null;
  email: string | null;
  solo_uso_interno: boolean;
  created_at: string;
}

function makeDeps(opts: {
  callerChannelId?: string | null;
  relayParties?: RelayParties | null;
  contactAPhone?: string | null;
  contactBPhone?: string | null;
} = {}): AppDeps {
  const callerChannelId =
    opts.callerChannelId !== undefined ? opts.callerChannelId : CHANNEL_A;
  const relayParties =
    opts.relayParties !== undefined ? opts.relayParties : makeRelayParties();

  return {
    personRepo: {} as AppDeps["personRepo"],
    searchRepo: {
      isMinorByContactId: vi.fn().mockResolvedValue(false),
    } as unknown as AppDeps["searchRepo"],
    petRepo: {} as AppDeps["petRepo"],
    petSearchRepo: {} as AppDeps["petSearchRepo"],
    zoneRepo: {} as AppDeps["zoneRepo"],
    needRepo: {} as AppDeps["needRepo"],
    channelLinkRepo: {
      findChannelIdByChannel: vi.fn().mockResolvedValue(callerChannelId),
      findContactByChannel: vi.fn().mockResolvedValue(null),
      ensureChannel: vi.fn(),
    } as unknown as AppDeps["channelLinkRepo"],
    channelRepo: {} as AppDeps["channelRepo"],
    notificationRepo: {
      create: vi.fn().mockResolvedValue({ id: "n-reveal-1" }),
      listPending: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(),
    } as unknown as AppDeps["notificationRepo"],
    matchRepo: {} as AppDeps["matchRepo"],
    secureDeleteRepo: {} as AppDeps["secureDeleteRepo"],
    personStateAuditRepo: {} as AppDeps["personStateAuditRepo"],
    relayRepo: {
      getActiveRelay: vi.fn().mockResolvedValue(
        relayParties
          ? { relayId: RELAY_ID, otherChannelId: CHANNEL_B }
          : null,
      ),
      closeRelay: vi.fn().mockResolvedValue(undefined),
      getRelayParties: vi.fn().mockResolvedValue(relayParties),
      markRevealRequested: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppDeps["relayRepo"],
    auditRepo: {
      writeRouteDecision: vi.fn().mockResolvedValue(undefined),
      writeConsentStateChange: vi.fn().mockResolvedValue(undefined),
      writeContactReveal: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppDeps["auditRepo"],
    consentRepo: {
      acceptConsent: vi.fn(),
      openConsentSession: vi.fn(),
      closeRelaysAndDeleteContact: vi.fn(),
      anonymizeAuditContact: vi.fn(),
    } as unknown as AppDeps["consentRepo"],
    contactRepo: {
      getById: vi.fn().mockImplementation(async (id: string): Promise<FakeContact | null> => {
        if (id === CONTACT_A_ID) {
          return {
            id: CONTACT_A_ID,
            telefono: opts.contactAPhone ?? PHONE_A,
            email: null,
            solo_uso_interno: false,
            created_at: "",
          };
        }
        if (id === CONTACT_B_ID) {
          return {
            id: CONTACT_B_ID,
            telefono: opts.contactBPhone ?? PHONE_B,
            email: null,
            solo_uso_interno: false,
            created_at: "",
          };
        }
        return null;
      }),
    } as unknown as AppDeps["contactRepo"],
    autoMatchThreshold: 0.85,
    serviceToken: "test-token",
    botSecret: BOT_SECRET,
  };
}

describe("POST /relay/:id/reveal", () => {
  // ── AUTH ────────────────────────────────────────────────────────────────────

  it("401 si falta el header x-bot-secret", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_A } },
      // sin header x-bot-secret
    });
    expect(res.statusCode).toBe(401);
  });

  it("401 si el header x-bot-secret es incorrecto", async () => {
    const deps = makeDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: { "x-bot-secret": "secreto-malo" },
      payload: { channel: { plataforma: "telegram", chatId: CHAT_A } },
    });
    expect(res.statusCode).toBe(401);
    expect(
      (deps.relayRepo as { markRevealRequested: ReturnType<typeof vi.fn> })
        .markRevealRequested,
    ).not.toHaveBeenCalled();
  });

  // ── VALIDACION DE BODY ───────────────────────────────────────────────────────

  it("400 si falta channel en el body", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: BOT_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 si channel tiene formato viejo (channelId directo en vez de plataforma+chatId)", async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: BOT_HEADERS,
      payload: { channelId: CHANNEL_A },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── CANAL DESCONOCIDO / AJENO ────────────────────────────────────────────────

  it("404 si el canal no resuelve a ningun channel_id", async () => {
    const deps = makeDeps({ callerChannelId: null });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: BOT_HEADERS,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_A } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 si no existe relay activo para este relay_id", async () => {
    const deps = makeDeps({ relayParties: null });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: BOT_HEADERS,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_A } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("403 si el canal llamante no es party_a ni party_b del relay", async () => {
    const OUTSIDER_CHANNEL = "cx000001-0000-4000-8000-000000000099";
    const deps = makeDeps({ callerChannelId: OUTSIDER_CHANNEL });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: BOT_HEADERS,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_A } },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── FLUJO PARCIAL: una parte pidio, la otra todavia no ──────────────────────

  it("200 cuando party_a pide reveal por primera vez — status waiting_other, sin telefono en notificaciones", async () => {
    const deps = makeDeps(); // revealA=false, revealB=false
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: BOT_HEADERS,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_A } },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("waiting_other");

    // Debe marcar reveal de la parte A
    expect(
      (deps.relayRepo as { markRevealRequested: ReturnType<typeof vi.fn> })
        .markRevealRequested,
    ).toHaveBeenCalledWith(RELAY_ID, "a");

    // Dos notificaciones: al solicitante (espera) y al otro lado (informar que se solicit)
    expect(
      (deps.notificationRepo as { create: ReturnType<typeof vi.fn> }).create,
    ).toHaveBeenCalledTimes(2);

    // GUARDRAIL CRITICO: ninguna notificacion parcial debe contener telefonos
    const createCalls = (
      deps.notificationRepo as { create: ReturnType<typeof vi.fn> }
    ).create.mock.calls as Array<[{ payload: { mensaje: string } }]>;
    for (const [call] of createCalls) {
      expect(call.payload.mensaje).not.toContain(PHONE_A);
      expect(call.payload.mensaje).not.toContain(PHONE_B);
    }
  });

  // ── FLUJO BILATERAL: ambas partes han pedido → revelar contacto ──────────────

  it("200 cuando party_b pide reveal y party_a ya habia pedido — status revealed, cada parte recibe el telefono de la otra", async () => {
    const deps = makeDeps({
      relayParties: makeRelayParties({ revealA: true }),
    });
    // Party B ahora llama: resolver CHANNEL_B para el canal de party_b
    (
      deps.channelLinkRepo as { findChannelIdByChannel: ReturnType<typeof vi.fn> }
    ).findChannelIdByChannel.mockResolvedValue(CHANNEL_B);

    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: BOT_HEADERS,
      payload: { channel: { plataforma: "telegram", chatId: "tg-party-b" } },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("revealed");

    // Debe marcar reveal de la parte B
    expect(
      (deps.relayRepo as { markRevealRequested: ReturnType<typeof vi.fn> })
        .markRevealRequested,
    ).toHaveBeenCalledWith(RELAY_ID, "b");

    // Dos notificaciones, una por parte
    const createCalls = (
      deps.notificationRepo as { create: ReturnType<typeof vi.fn> }
    ).create.mock.calls as Array<[{ channel_id: string; payload: { mensaje: string } }]>;
    expect(createCalls).toHaveLength(2);

    // Party A recibe el telefono de party B
    const notifA = createCalls.find(([c]) => c.channel_id === CHANNEL_A);
    expect(notifA).toBeDefined();
    expect(notifA![0].payload.mensaje).toContain(PHONE_B);
    expect(notifA![0].payload.mensaje).not.toContain(PHONE_A); // no autorrevelar

    // Party B recibe el telefono de party A
    const notifB = createCalls.find(([c]) => c.channel_id === CHANNEL_B);
    expect(notifB).toBeDefined();
    expect(notifB![0].payload.mensaje).toContain(PHONE_A);
    expect(notifB![0].payload.mensaje).not.toContain(PHONE_B); // no autorrevelar
  });

  // ── IDEMPOTENCIA ─────────────────────────────────────────────────────────────

  it("200 idempotente si party_a pide reveal por segunda vez — no llama markRevealRequested, solo confirma espera", async () => {
    // party_a ya pidio (revealA=true), party_b aun no
    const deps = makeDeps({
      relayParties: makeRelayParties({ revealA: true }),
      callerChannelId: CHANNEL_A,
    });

    const app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: `/relay/${RELAY_ID}/reveal`,
      headers: BOT_HEADERS,
      payload: { channel: { plataforma: "telegram", chatId: CHAT_A } },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; status: string };
    expect(body.status).toBe("waiting_other");

    // NO debe llamar markRevealRequested — ya era true
    expect(
      (deps.relayRepo as { markRevealRequested: ReturnType<typeof vi.fn> })
        .markRevealRequested,
    ).not.toHaveBeenCalled();

    // Solo 1 notificacion: confirmacion de espera al solicitante
    expect(
      (deps.notificationRepo as { create: ReturnType<typeof vi.fn> }).create,
    ).toHaveBeenCalledTimes(1);
  });
});
