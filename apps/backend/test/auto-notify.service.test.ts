import { describe, expect, it, vi } from "vitest";
import type { ConsentRepo, NotificationRepo } from "db";
import {
  openConsentAndNotify,
  type AutoNotifyDeps,
  type MatchForAutoNotify,
} from "../src/services/auto-notify.js";

// Tests de auto-notify: servicio que abre una consent_session y envia
// notificaciones bilaterales SIN exponer PII (guardrail #1).
//
// Datos SINTETICOS sin PII real.

const SYNTH_MATCH_ID = "m0000001-0000-4000-8000-000000000001";
const SYNTH_SEARCH_ID = "s0000001-0000-4000-8000-000000000001";
const SYNTH_PERSON_ID = "p0000001-0000-4000-8000-000000000001";
const SYNTH_SEARCHER_CHAN = "c0000001-0000-4000-8000-000000000001";
const SYNTH_REGISTRANT_CHAN = "c0000002-0000-4000-8000-000000000002";
const SYNTH_CONSENT_ID = "cs000001-0000-4000-8000-000000000001";

function makeMatch(overrides: Partial<MatchForAutoNotify> = {}): MatchForAutoNotify {
  return {
    matchId: SYNTH_MATCH_ID,
    searchId: SYNTH_SEARCH_ID,
    personId: SYNTH_PERSON_ID,
    searcherChannelId: SYNTH_SEARCHER_CHAN,
    registrantChannelId: SYNTH_REGISTRANT_CHAN,
    score: 0.92,
    ...overrides,
  };
}

function makeDeps(): AutoNotifyDeps & {
  consentRepo: { openConsentSession: ReturnType<typeof vi.fn> };
  notificationRepo: { create: ReturnType<typeof vi.fn> };
} {
  const consentRepo = {
    openConsentSession: vi.fn().mockResolvedValue(SYNTH_CONSENT_ID),
    // satisfies interface (other methods not used by auto-notify)
    acceptConsent: vi.fn(),
    closeRelaysAndDeleteContact: vi.fn(),
    anonymizeAuditContact: vi.fn(),
  };
  const notificationRepo = {
    create: vi.fn().mockResolvedValue({ id: "notif-1" }),
    listPending: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
  };
  return {
    consentRepo: consentRepo as unknown as ConsentRepo & { openConsentSession: ReturnType<typeof vi.fn> },
    notificationRepo: notificationRepo as unknown as NotificationRepo & { create: ReturnType<typeof vi.fn> },
  };
}

describe("openConsentAndNotify", () => {
  it("llama a openConsentSession con match_id, searcher y registrant channel ids", async () => {
    const deps = makeDeps();
    await openConsentAndNotify(deps, makeMatch());

    expect(deps.consentRepo.openConsentSession).toHaveBeenCalledOnce();
    expect(deps.consentRepo.openConsentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: SYNTH_MATCH_ID,
        searcherChannelId: SYNTH_SEARCHER_CHAN,
        registrantChannelId: SYNTH_REGISTRANT_CHAN,
      }),
    );
  });

  it("encola exactamente 2 notificaciones: una al buscador, otra al registrante", async () => {
    const deps = makeDeps();
    await openConsentAndNotify(deps, makeMatch());

    expect(deps.notificationRepo.create).toHaveBeenCalledTimes(2);
  });

  it("la notificacion al buscador va al searcherChannelId", async () => {
    const deps = makeDeps();
    await openConsentAndNotify(deps, makeMatch());

    const calls = deps.notificationRepo.create.mock.calls as unknown[][];
    const searcherCall = calls.find(
      (c) => (c[0] as { channel_id: string }).channel_id === SYNTH_SEARCHER_CHAN,
    );
    expect(searcherCall).toBeDefined();
  });

  it("la notificacion al registrante va al registrantChannelId", async () => {
    const deps = makeDeps();
    await openConsentAndNotify(deps, makeMatch());

    const calls = deps.notificationRepo.create.mock.calls as unknown[][];
    const registrantCall = calls.find(
      (c) => (c[0] as { channel_id: string }).channel_id === SYNTH_REGISTRANT_CHAN,
    );
    expect(registrantCall).toBeDefined();
  });

  it("NUNCA incluye telefono ni PII en el payload de la notificacion (guardrail #1)", async () => {
    const deps = makeDeps();
    await openConsentAndNotify(deps, makeMatch());

    const calls = deps.notificationRepo.create.mock.calls as unknown[][];
    for (const call of calls) {
      const input = call[0] as { payload: { mensaje: string } };
      const msg = input.payload?.mensaje ?? "";
      // No debe contener patrones de teléfono
      expect(msg).not.toMatch(/\+\d{7,}/);
      // El consent_id va en el mensaje (para que puedan responder)
      expect(msg).toContain(SYNTH_CONSENT_ID);
    }
  });

  it("devuelve el consentSessionId creado", async () => {
    const deps = makeDeps();
    const result = await openConsentAndNotify(deps, makeMatch());

    expect(result.consentSessionId).toBe(SYNTH_CONSENT_ID);
  });

  it("lanza si openConsentSession falla (no silencia errores de creacion)", async () => {
    const deps = makeDeps();
    deps.consentRepo.openConsentSession.mockRejectedValue(new Error("DB error"));

    await expect(openConsentAndNotify(deps, makeMatch())).rejects.toThrow("DB error");
  });
});
