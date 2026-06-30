import { describe, expect, it } from "vitest";
import type { NotificationRepo } from "db";
import type {
  RescatadoInput,
  RescatadoDeps,
} from "../src/services/rescatado.js";
import { reportRescatado } from "../src/services/rescatado.js";

// Tests de reportRescatado (Slice D).
// Strict TDD — estos tests se escriben ANTES de la implementacion (RED).
//
// PRIVACIDAD: ningun mensaje expone PII. channel_id son UUIDs internos.
// GUARDRAIL #2: menor → revision humana (nunca a_salvo automatico).
// GUARDRAIL #4: a_salvo NUNCA automatico — solo notifica; no modifica estado.

const SYNTH_REGISTRANT_CHANNEL = "bbbbbbbb-0000-4000-8000-000000000002";
const SYNTH_PERSON_ID = "cccccccc-0000-4000-8000-000000000003";
const SYNTH_SEARCH_ID = "dddddddd-0000-4000-8000-000000000004";
const SYNTH_CONSENT_ID = "eeeeeeee-0000-4000-8000-000000000005";
const SYNTH_SEARCHER_CHANNEL = "aaaaaaaa-0000-4000-8000-000000000001";
// FIX (PR 6): contact_id del buscador — diferente del channel_id (SYNTH_SEARCHER_CHANNEL)
const SYNTH_SEARCHER_CONTACT_ID = "ffffffff-0000-4000-8000-000000000006";

interface CreatedNotification {
  channel_id: string;
  tipo: string;
  payload: Record<string, unknown>;
}

function makeFakeNotificationRepo(): NotificationRepo & {
  created: CreatedNotification[];
} {
  const created: CreatedNotification[] = [];
  return {
    created,
    async create(input) {
      created.push({
        channel_id: input.channel_id,
        tipo: input.tipo,
        payload: input.payload as Record<string, unknown>,
      });
    },
    async listPending() {
      return [];
    },
    async markSent() {},
    async markFailed() {},
  };
}

function makeBaseDeps(overrides: Partial<RescatadoDeps> = {}): RescatadoDeps {
  return {
    personRepo: {
      async isMinorById(_id) {
        return false;
      },
    },
    searchRepo: {
      async isMinorByContactId(_id) {
        return false;
      },
    },
    consentRepo: {
      async openConsentSession(_input) {
        return SYNTH_CONSENT_ID;
      },
      async acceptConsent(_id, _party) {
        return "accepted_one";
      },
      async closeRelaysAndDeleteContact(_id) {
        return [];
      },
      async anonymizeAuditContact(_id) {},
    },
    notificationRepo: makeFakeNotificationRepo(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<RescatadoInput> = {}): RescatadoInput {
  return {
    personId: SYNTH_PERSON_ID,
    searchId: SYNTH_SEARCH_ID,
    registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
    searcherChannelId: SYNTH_SEARCHER_CHANNEL,
    // Por defecto el buscador resuelve a un contacto ADULTO positivo. El gate A1
    // (sin contact_id → human_review) se prueba explicitamente abajo con undefined.
    searcherContactId: SYNTH_SEARCHER_CONTACT_ID,
    ...overrides,
  };
}

// ── Flujo normal ─────────────────────────────────────────────────────────────

describe("reportRescatado — flujo normal (adulto, activa)", () => {
  it("notifica al REGISTRANTE (quien registro la persona), no al buscador activo", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo });

    await reportRescatado(deps, makeInput());

    const registrantNotifs = notifRepo.created.filter(
      (n) => n.channel_id === SYNTH_REGISTRANT_CHANNEL,
    );
    expect(registrantNotifs).toHaveLength(1);
    // El buscador activo NO recibe notificacion directa del rescatado
    const searcherNotifs = notifRepo.created.filter(
      (n) => n.channel_id === SYNTH_SEARCHER_CHANNEL,
    );
    expect(searcherNotifs).toHaveLength(0);
  });

  it("el mensaje al registrante NO contiene PII de contacto", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo });

    await reportRescatado(deps, makeInput());

    const n = notifRepo.created.find(
      (x) => x.channel_id === SYNTH_REGISTRANT_CHANNEL,
    );
    expect(n).toBeDefined();
    const msg = (n?.payload as { mensaje?: string })?.mensaje ?? "";
    // No debe contener UUIDs de canal ni IDs de persona en texto
    expect(msg).not.toContain(SYNTH_SEARCHER_CHANNEL);
    expect(msg).not.toContain(SYNTH_REGISTRANT_CHANNEL);
  });

  it("devuelve outcome='queued' (encola, nunca cambia estado automaticamente)", async () => {
    const deps = makeBaseDeps();
    const result = await reportRescatado(deps, makeInput());
    expect(result.outcome).toBe("queued");
  });

  it("NO establece estado a_salvo automaticamente (guardrail #4)", async () => {
    const deps = makeBaseDeps();
    const result = await reportRescatado(deps, makeInput());
    // outcome nunca puede ser 'a_salvo_set' ni similar
    expect(result.outcome).not.toContain("a_salvo");
  });

  it("abre consent_session y devuelve consentSessionId para intercambio bilateral", async () => {
    const deps = makeBaseDeps();
    const result = await reportRescatado(deps, makeInput());

    expect(result.outcome).toBe("queued");
    expect(result.consentSessionId).toBe(SYNTH_CONSENT_ID);
  });
});

// ── Menor o fallecida → revision humana ──────────────────────────────────────

describe("reportRescatado — menor o fallecida → revision humana", () => {
  it("registrante menor → outcome='human_review'; NO notifica al registrante directamente", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({
      personRepo: {
        async isMinorById(_id) {
          return true;
        },
      },
      notificationRepo: notifRepo,
    });

    const result = await reportRescatado(deps, makeInput());
    expect(result.outcome).toBe("human_review");
    // El operador gestiona — no notificar directamente al registrante
    const registrantNotifs = notifRepo.created.filter(
      (n) => n.channel_id === SYNTH_REGISTRANT_CHANNEL,
    );
    expect(registrantNotifs).toHaveLength(0);
  });

  it("busqueda marcada es_menor (via isMinorByContactId con searcherContactId) → outcome='human_review'", async () => {
    // FIX (PR 6): debe pasarse searcherContactId real; el servicio lo pasa a isMinorByContactId.
    const deps = makeBaseDeps({
      searchRepo: {
        async isMinorByContactId(_id) {
          return true;
        },
      },
    });

    // Provide a searcherContactId so the service can perform the minor check.
    const result = await reportRescatado(deps, makeInput({ searcherContactId: SYNTH_SEARCHER_CONTACT_ID }));
    expect(result.outcome).toBe("human_review");
  });

  it("registrante con estado fallecida → outcome='human_review'", async () => {
    const deps = makeBaseDeps();
    const input = makeInput({ registrantEstado: "fallecida" });

    const result = await reportRescatado(deps, input);
    expect(result.outcome).toBe("human_review");
  });
});

// ── Guard de carrera con consentimiento pendiente ────────────────────────────

describe("reportRescatado — guard de carrera con consent pendiente", () => {
  it("con existingConsentId → NO abre otro consent_session", async () => {
    let openConsentCalled = 0;
    const deps = makeBaseDeps({
      consentRepo: {
        async openConsentSession(_input) {
          openConsentCalled++;
          return SYNTH_CONSENT_ID;
        },
        async acceptConsent(_id, _party) {
          return "accepted_one";
        },
        async closeRelaysAndDeleteContact(_id) {
          return [];
        },
        async anonymizeAuditContact(_id) {},
      },
    });

    await reportRescatado(deps, makeInput({ existingConsentId: SYNTH_CONSENT_ID }));
    expect(openConsentCalled).toBe(0);
  });

  it("con existingConsentId → outcome='consent_pending'", async () => {
    const deps = makeBaseDeps();
    const result = await reportRescatado(
      deps,
      makeInput({ existingConsentId: SYNTH_CONSENT_ID }),
    );
    expect(result.outcome).toBe("consent_pending");
  });

  it("sin existingConsentId → abre consent y outcome='queued'", async () => {
    let openConsentCalled = 0;
    const deps = makeBaseDeps({
      consentRepo: {
        async openConsentSession(_input) {
          openConsentCalled++;
          return SYNTH_CONSENT_ID;
        },
        async acceptConsent(_id, _party) {
          return "accepted_one";
        },
        async closeRelaysAndDeleteContact(_id) {
          return [];
        },
        async anonymizeAuditContact(_id) {},
      },
    });

    const result = await reportRescatado(deps, makeInput());
    expect(openConsentCalled).toBe(1);
    expect(result.outcome).toBe("queued");
  });
});

// ── Reportante no localizable ─────────────────────────────────────────────────

describe("reportRescatado — registrante no localizable", () => {
  it("sin registrantChannelId → outcome='operator_queue'", async () => {
    const deps = makeBaseDeps();
    const input = makeInput({ registrantChannelId: undefined });

    const result = await reportRescatado(deps, input);
    expect(result.outcome).toBe("operator_queue");
  });
});

// ── Fix gate menor: usa buscador_contact_id real (PR 6, judgment-r3) ─────────

describe("reportRescatado — gate menor con buscador_contact_id real", () => {
  it("[TDD-RED] isMinorByContactId se llama con searcherContactId (no channelId)", async () => {
    // El fix: RescatadoInput debe aceptar searcherContactId opcional.
    // Si se provee, se usa para isMinorByContactId. Si no, comportamiento conservador.
    const calledWith: string[] = [];
    const deps = makeBaseDeps({
      searchRepo: {
        async isMinorByContactId(id) {
          calledWith.push(id);
          return false;
        },
      },
    });

    const input = makeInput({ searcherContactId: SYNTH_SEARCHER_CONTACT_ID });
    await reportRescatado(deps, input);

    // MUST be called with the contact id, NOT the channel id
    expect(calledWith).toContain(SYNTH_SEARCHER_CONTACT_ID);
    expect(calledWith).not.toContain(SYNTH_SEARCHER_CHANNEL);
  });

  it("sin searcherContactId → human_review (gate A1 conservador, NO queued)", async () => {
    // Precondicion explicita: el lado buscador NO se resuelve a un adulto positivo
    // (searcherContactId ausente). Antes esto OMITIA el chequeo y seguia a queued
    // (agujero en el guardrail de menores). Ahora gatea conservadoramente a humano.
    const deps = makeBaseDeps();
    const input = makeInput({ searcherContactId: undefined });
    const result = await reportRescatado(deps, input);
    expect(result.outcome).toBe("human_review");
  });

  it("sin searcherContactId → NUNCA llega a abrir consent_session (no queued)", async () => {
    // El gate dispara antes de openConsentSession: confirma que no se encola.
    let openConsentCalled = 0;
    const deps = makeBaseDeps({
      consentRepo: {
        async openConsentSession(_input) {
          openConsentCalled++;
          return SYNTH_CONSENT_ID;
        },
        async acceptConsent(_id, _party) {
          return "accepted_one";
        },
        async closeRelaysAndDeleteContact(_id) {
          return [];
        },
        async anonymizeAuditContact(_id) {},
      },
    });
    const result = await reportRescatado(deps, makeInput({ searcherContactId: undefined }));
    expect(result.outcome).toBe("human_review");
    expect(openConsentCalled).toBe(0);
  });

  it("con searcherContactId de un ADULTO positivo → sigue al flujo normal (queued)", async () => {
    // Precondicion explicita: el buscador resuelve a un adulto (isMinorByContactId=false).
    const deps = makeBaseDeps({
      searchRepo: {
        async isMinorByContactId(_id) {
          return false;
        },
      },
    });
    const result = await reportRescatado(
      deps,
      makeInput({ searcherContactId: SYNTH_SEARCHER_CONTACT_ID }),
    );
    expect(result.outcome).toBe("queued");
  });
});

describe("reportRescatado — orden de guards (M1): menor antes que fallecida", () => {
  it("registrante menor Y fallecida → human_review por MENOR (gate de menor primero)", async () => {
    // Ambos guards llevan a human_review, pero el de menor debe evaluarse primero.
    // Verificamos que isMinorById se consulta (no se corta antes por fallecida).
    let minorChecked = false;
    const deps = makeBaseDeps({
      personRepo: {
        async isMinorById(_id) {
          minorChecked = true;
          return true;
        },
      },
    });
    const result = await reportRescatado(
      deps,
      makeInput({ registrantEstado: "fallecida" }),
    );
    expect(result.outcome).toBe("human_review");
    expect(minorChecked).toBe(true);
  });
});

// ── assertEstadoASalvoValido como gate ────────────────────────────────────────

describe("assertEstadoASalvoValido gate (core rule verification)", () => {
  it("intentar a_salvo sin verificacion → GuardrailError", async () => {
    const { assertEstadoASalvoValido, GuardrailError } = await import("core");
    expect(() =>
      assertEstadoASalvoValido({ estado: "a_salvo", verificacion: "sin_verificar" }),
    ).toThrow(GuardrailError);
  });

  it("a_salvo con verificacion='verificada' → no lanza (human-confirmed valid)", async () => {
    const { assertEstadoASalvoValido } = await import("core");
    expect(() =>
      assertEstadoASalvoValido({ estado: "a_salvo", verificacion: "verificada" }),
    ).not.toThrow();
  });
});
