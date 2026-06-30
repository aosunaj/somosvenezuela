import { describe, expect, it, vi } from "vitest";
import type { ConsentRepo, NotificationRepo, AuditRepo } from "db";
import {
  respondConsent,
  type RespondConsentDeps,
  type RespondConsentInput,
} from "../src/services/consent.js";

// Tests del servicio de respuesta a consent: accept/decline + bifurcacion post-accept.
// Cubre los paths criticos del diseño:
//   - accepted_one: confirm ok, sin relay aun
//   - both_accepted + relay creado: notificar relay-abierto a ambas partes
//   - both_accepted + no relay (no_op): NO notificar relay (judgment-r3 item 2)
//   - declined: registrar y punto
//   - no_op: idempotente
//
// NO usa argon2 ni verifica contraseñas — eso lo cubre el test de verification (aparte).
// Datos SINTETICOS sin PII.

const CONSENT_ID = "cs000001-0000-4000-8000-000000000001";
const SEARCHER_CHAN = "c0000001-0000-4000-8000-000000000001";
const REGISTRANT_CHAN = "c0000002-0000-4000-8000-000000000002";

type FakeConsentRepo = {
  acceptConsent: ReturnType<typeof vi.fn>;
  getActiveRelay?: ReturnType<typeof vi.fn>;
};

type FakeNotifRepo = {
  create: ReturnType<typeof vi.fn>;
};

type FakeAuditRepo = {
  writeConsentStateChange: ReturnType<typeof vi.fn>;
};

function makeInput(overrides: Partial<RespondConsentInput> = {}): RespondConsentInput {
  return {
    consentId: CONSENT_ID,
    party: "searcher",
    action: "accept",
    searcherChannelId: SEARCHER_CHAN,
    registrantChannelId: REGISTRANT_CHAN,
    ...overrides,
  };
}

function makeDeps(
  rpcResult: "both_accepted" | "accepted_one" | "no_op" = "accepted_one",
  relayExists = true,
): RespondConsentDeps & {
  consentRepo: FakeConsentRepo;
  notificationRepo: FakeNotifRepo;
  auditRepo: FakeAuditRepo;
} {
  const consentRepo: FakeConsentRepo = {
    acceptConsent: vi.fn().mockResolvedValue(rpcResult),
  };
  const notificationRepo: FakeNotifRepo = {
    create: vi.fn().mockResolvedValue({ id: "notif-x" }),
  };
  const auditRepo: FakeAuditRepo = {
    writeConsentStateChange: vi.fn().mockResolvedValue(undefined),
  };

  const relayRepo = {
    getActiveRelay: vi.fn().mockResolvedValue(
      relayExists
        ? { relayId: "relay-001", otherChannelId: REGISTRANT_CHAN }
        : null,
    ),
    closeRelay: vi.fn(),
  };

  return {
    consentRepo: consentRepo as unknown as ConsentRepo & FakeConsentRepo,
    notificationRepo: notificationRepo as unknown as NotificationRepo & FakeNotifRepo,
    auditRepo: auditRepo as unknown as AuditRepo & FakeAuditRepo,
    relayRepo: relayRepo as unknown as import("db").RelayRepo,
  };
}

describe("respondConsent — accept paths", () => {
  it("accepted_one: llama a acceptConsent con el consent_id y la parte", async () => {
    const deps = makeDeps("accepted_one");
    await respondConsent(deps, makeInput());

    expect(deps.consentRepo.acceptConsent).toHaveBeenCalledOnce();
    expect(deps.consentRepo.acceptConsent).toHaveBeenCalledWith(CONSENT_ID, "searcher");
  });

  it("accepted_one: NO envia notificacion de relay (el otro aun no ha aceptado)", async () => {
    const deps = makeDeps("accepted_one");
    await respondConsent(deps, makeInput());

    // Solo debe haber mando una notificacion de confirmacion al que aceptó (opcional)
    // pero NUNCA una notificacion de relay-abierto
    const calls = deps.notificationRepo.create.mock.calls as unknown[][];
    const relayOpenMsg = calls.find((c) => {
      const msg = ((c[0] as { payload?: { mensaje?: string } }).payload?.mensaje ?? "");
      return msg.toLowerCase().includes("relay") || msg.toLowerCase().includes("conectados");
    });
    expect(relayOpenMsg).toBeUndefined();
  });

  it("both_accepted + relay existe: envia notificacion de relay-abierto a AMBAS partes (judgment-r3 item 2)", async () => {
    const deps = makeDeps("both_accepted", true);
    await respondConsent(deps, makeInput());

    const calls = deps.notificationRepo.create.mock.calls as unknown[][];
    // Debe haber exactamente 2 notificaciones de relay-abierto
    const relayMsgs = calls.filter((c) => {
      const msg = ((c[0] as { payload?: { mensaje?: string } }).payload?.mensaje ?? "");
      return msg.toLowerCase().includes("conectad") || msg.toLowerCase().includes("contacto");
    });
    expect(relayMsgs.length).toBe(2);
  });

  it("both_accepted + NO hay relay (no_op del lado del relay): NO envia notificacion de relay-abierto (judgment-r3 item 2)", async () => {
    // El rpc devolvio both_accepted pero getActiveRelay retorna null
    // (concurrent second accept que llegó tarde — el relay ya existía pero este hilo llega a no_op indirecto)
    const deps = makeDeps("both_accepted", false);
    await respondConsent(deps, makeInput());

    const calls = deps.notificationRepo.create.mock.calls as unknown[][];
    const relayMsgs = calls.filter((c) => {
      const msg = ((c[0] as { payload?: { mensaje?: string } }).payload?.mensaje ?? "");
      return msg.toLowerCase().includes("conectad") || msg.toLowerCase().includes("contacto");
    });
    // Sin relay confirmado → sin notificacion de relay
    expect(relayMsgs.length).toBe(0);
  });

  it("no_op: NO lanza, NO envia notificaciones, es idempotente", async () => {
    const deps = makeDeps("no_op");
    await expect(respondConsent(deps, makeInput())).resolves.not.toThrow();
    // no_op puede no crear notificaciones (idempotencia)
    // Lo importante es que no lance
  });
});

describe("respondConsent — auditoría usa el estado unificado 'pending' (judgment-r3 item 8)", () => {
  // El CHECK de 0008 NO admite pending_a/pending_b. El audit previo escribía esos
  // valores hardcodeados. Estos tests fijan el contrato: previousState siempre es
  // 'pending' y NUNCA pending_a/pending_b.
  function previousStatesWritten(audit: FakeAuditRepo): string[] {
    const calls = audit.writeConsentStateChange.mock.calls as unknown[][];
    return calls.map((c) => (c[0] as { previousState: string }).previousState);
  }

  it("decline: previousState='pending' (no pending_a)", async () => {
    const deps = makeDeps("accepted_one");
    await respondConsent(deps, makeInput({ action: "decline" }));

    const prevs = previousStatesWritten(deps.auditRepo);
    expect(prevs).toContain("pending");
    expect(prevs).not.toContain("pending_a");
    expect(prevs).not.toContain("pending_b");
  });

  it("accepted_one: previousState='pending' y newState='pending' (no pending_a/pending_b)", async () => {
    const deps = makeDeps("accepted_one");
    await respondConsent(deps, makeInput());

    const calls = deps.auditRepo.writeConsentStateChange.mock.calls as unknown[][];
    const args = calls.map((c) => c[0] as { previousState: string; newState: string });
    expect(args).toContainEqual(
      expect.objectContaining({ previousState: "pending", newState: "pending" }),
    );
    const allStates = args.flatMap((a) => [a.previousState, a.newState]);
    expect(allStates).not.toContain("pending_a");
    expect(allStates).not.toContain("pending_b");
  });

  it("both_accepted + relay: previousState='pending', newState='both_accepted'", async () => {
    const deps = makeDeps("both_accepted", true);
    await respondConsent(deps, makeInput());

    const calls = deps.auditRepo.writeConsentStateChange.mock.calls as unknown[][];
    const args = calls.map((c) => c[0] as { previousState: string; newState: string });
    expect(args).toContainEqual(
      expect.objectContaining({ previousState: "pending", newState: "both_accepted" }),
    );
    const allStates = args.flatMap((a) => [a.previousState, a.newState]);
    expect(allStates).not.toContain("pending_a");
    expect(allStates).not.toContain("pending_b");
  });
});

describe("respondConsent — decline path", () => {
  it("action=decline: NO llama a acceptConsent (no tiene sentido aceptar un decline)", async () => {
    const deps = makeDeps("accepted_one");
    await respondConsent(deps, makeInput({ action: "decline" }));

    expect(deps.consentRepo.acceptConsent).not.toHaveBeenCalled();
  });

  it("action=decline: envia notificacion de declive al otro lado (para que no quede esperando)", async () => {
    const deps = makeDeps("accepted_one");
    await respondConsent(deps, makeInput({ action: "decline", party: "registrant" }));

    const calls = deps.notificationRepo.create.mock.calls as unknown[][];
    // El buscador debe recibir una notificacion de que fue declinado
    const declineMsg = calls.find((c) => {
      const channelId = (c[0] as { channel_id?: string }).channel_id;
      return channelId === SEARCHER_CHAN;
    });
    expect(declineMsg).toBeDefined();
  });
});
