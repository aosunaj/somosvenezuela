import { describe, expect, it, vi } from "vitest";
import { requestReveal, type RevealDeps } from "../src/services/relay-reveal.js";

// Tests del servicio de revelado bilateral de contacto (PR7).
//
// GUARDRAIL CRITICO: el telefono NUNCA aparece hasta que AMBAS partes lo pidieron.
// El servicio es puro y no tiene dependencias de Fastify: se prueba en aislamiento.
//
// Datos 100% sinteticos (guardrail: sin PII real en tests).

const RELAY_ID = "e0000007-0000-4000-8000-000000000007";
const CHANNEL_A = "ca000001-0000-4000-8000-000000000001";
const CHANNEL_B = "cb000001-0000-4000-8000-000000000001";
const CONTACT_A = "da000001-0000-4000-8000-000000000001";
const CONTACT_B = "db000001-0000-4000-8000-000000000001";
const PHONE_A = "+582121111111";
const PHONE_B = "+582122222222";

function makeDeps(opts: {
  revealA?: boolean;
  revealB?: boolean;
  phoneA?: string | null;
  phoneB?: string | null;
} = {}): RevealDeps {
  return {
    relayRepo: {
      markRevealRequested: vi.fn().mockResolvedValue(undefined),
      getRelayParties: vi.fn().mockResolvedValue({
        relayId: RELAY_ID,
        partyAChannelId: CHANNEL_A,
        partyBChannelId: CHANNEL_B,
        revealRequestedA: opts.revealA ?? false,
        revealRequestedB: opts.revealB ?? false,
        partyAContactId: CONTACT_A,
        partyBContactId: CONTACT_B,
      }),
      getActiveRelay: vi.fn(),
      closeRelay: vi.fn(),
    },
    contactRepo: {
      getById: vi.fn().mockImplementation(async (id: string) => {
        const phoneA = opts.phoneA !== undefined ? opts.phoneA : PHONE_A;
        const phoneB = opts.phoneB !== undefined ? opts.phoneB : PHONE_B;
        if (id === CONTACT_A) return { telefono: phoneA };
        if (id === CONTACT_B) return { telefono: phoneB };
        return null;
      }),
    },
    notificationRepo: {
      create: vi.fn().mockResolvedValue({ id: "n-1" }),
    },
    auditRepo: {
      writeContactReveal: vi.fn().mockResolvedValue(undefined),
      writeRouteDecision: vi.fn(),
      writeConsentStateChange: vi.fn(),
    },
  } as unknown as RevealDeps;
}

describe("requestReveal — service", () => {
  it("flujo parcial: marca revealA y envía notificacion de espera + aviso a party_b (sin telefono)", async () => {
    const deps = makeDeps(); // sin reveal de ninguna parte
    const result = await requestReveal(deps, {
      relayId: RELAY_ID,
      callerChannelId: CHANNEL_A,
    });

    expect(result.status).toBe("waiting_other");

    // Debe marcar la parte correcta
    expect(
      (deps.relayRepo as { markRevealRequested: ReturnType<typeof vi.fn> })
        .markRevealRequested,
    ).toHaveBeenCalledWith(RELAY_ID, "a");

    // Notificaciones sin telefono
    const createCalls = (
      deps.notificationRepo as { create: ReturnType<typeof vi.fn> }
    ).create.mock.calls as Array<[{ channel_id: string; payload: { mensaje: string } }]>;
    expect(createCalls).toHaveLength(2);
    for (const [call] of createCalls) {
      expect(call.payload.mensaje).not.toContain(PHONE_A);
      expect(call.payload.mensaje).not.toContain(PHONE_B);
    }
  });

  it("flujo bilateral: si party_a ya pidio, party_b revela -> ambos reciben el telefono del otro", async () => {
    const deps = makeDeps({ revealA: true }); // party_a ya pidio
    const result = await requestReveal(deps, {
      relayId: RELAY_ID,
      callerChannelId: CHANNEL_B,
    });

    expect(result.status).toBe("revealed");

    expect(
      (deps.relayRepo as { markRevealRequested: ReturnType<typeof vi.fn> })
        .markRevealRequested,
    ).toHaveBeenCalledWith(RELAY_ID, "b");

    const createCalls = (
      deps.notificationRepo as { create: ReturnType<typeof vi.fn> }
    ).create.mock.calls as Array<[{ channel_id: string; payload: { mensaje: string } }]>;
    expect(createCalls).toHaveLength(2);

    const notifA = createCalls.find(([c]) => c.channel_id === CHANNEL_A);
    const notifB = createCalls.find(([c]) => c.channel_id === CHANNEL_B);

    // Party A recibe telefono de party B
    expect(notifA![0].payload.mensaje).toContain(PHONE_B);
    expect(notifA![0].payload.mensaje).not.toContain(PHONE_A);

    // Party B recibe telefono de party A
    expect(notifB![0].payload.mensaje).toContain(PHONE_A);
    expect(notifB![0].payload.mensaje).not.toContain(PHONE_B);

    // Debe escribir evento de auditoria
    expect(
      (deps.auditRepo as { writeContactReveal: ReturnType<typeof vi.fn> })
        .writeContactReveal,
    ).toHaveBeenCalledOnce();
  });

  it("idempotente: si la parte ya pidio, no llama markRevealRequested de nuevo", async () => {
    const deps = makeDeps({ revealA: true }); // party_a ya pidio
    const result = await requestReveal(deps, {
      relayId: RELAY_ID,
      callerChannelId: CHANNEL_A, // party_a pide de nuevo
    });

    expect(result.status).toBe("waiting_other"); // party_b aun no pidio
    expect(
      (deps.relayRepo as { markRevealRequested: ReturnType<typeof vi.fn> })
        .markRevealRequested,
    ).not.toHaveBeenCalled();

    // Solo 1 notificacion a party_a (confirmacion de espera)
    expect(
      (deps.notificationRepo as { create: ReturnType<typeof vi.fn> }).create,
    ).toHaveBeenCalledTimes(1);
  });

  it("sin telefono en ninguna parte: no revela (notifica con fallback sin PII)", async () => {
    const deps = makeDeps({ revealA: true, phoneA: null, phoneB: null });
    const result = await requestReveal(deps, {
      relayId: RELAY_ID,
      callerChannelId: CHANNEL_B,
    });

    // Estado revealed (proceso completado) pero sin telefono disponible
    expect(result.status).toBe("revealed");

    const createCalls = (
      deps.notificationRepo as { create: ReturnType<typeof vi.fn> }
    ).create.mock.calls as Array<[{ payload: { mensaje: string } }]>;
    // Ningun mensaje debe tener telefono
    for (const [call] of createCalls) {
      expect(call.payload.mensaje).not.toMatch(/\+58|0412|0414/);
    }
  });
});
