import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { errorHandler } from "../src/errors.js";
import { registerRescatadoRoutes } from "../src/routes/rescatado.js";
import type { RescatadoDeps } from "../src/services/rescatado.js";

// Tests de ruta POST /rescatado (Slice D).
// Strict TDD — tests escritos ANTES de la implementacion (RED).
//
// PRIVACIDAD: ninguna respuesta expone PII.
// La ruta delega en reportRescatado() con fake deps.

const SYNTH_PERSON_ID = "cccccccc-0000-4000-8000-000000000003";
const SYNTH_SEARCH_ID = "dddddddd-0000-4000-8000-000000000004";
const SYNTH_REGISTRANT_CHANNEL = "bbbbbbbb-0000-4000-8000-000000000002";
const SYNTH_SEARCHER_CHANNEL = "aaaaaaaa-0000-4000-8000-000000000001";
const SYNTH_CONSENT_ID = "eeeeeeee-0000-4000-8000-000000000005";

function makeFakeDeps(
  registrantIsMinor = false,
): RescatadoDeps {
  return {
    personRepo: {
      async isMinorById(_id) {
        return registrantIsMinor;
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
    notificationRepo: {
      async create(_input) {},
      async listPending() {
        return [];
      },
      async markSent() {},
      async markFailed() {},
    },
  };
}

let app: FastifyInstance;

async function buildApp(deps: RescatadoDeps): Promise<void> {
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerRescatadoRoutes(app, deps);
  await app.ready();
}

afterEach(async () => {
  if (app) await app.close();
});

describe("POST /rescatado — ruta", () => {
  beforeEach(async () => {
    await buildApp(makeFakeDeps(false));
  });

  it("200 con body valido (queued)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      payload: {
        personId: SYNTH_PERSON_ID,
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        searcherChannelId: SYNTH_SEARCHER_CHANNEL,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; outcome: string };
    expect(body.ok).toBe(true);
    expect(body.outcome).toBe("queued");
  });

  it("400 si falta personId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      payload: {
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        searcherChannelId: SYNTH_SEARCHER_CHANNEL,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si personId no es UUID valido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      payload: {
        personId: "not-a-uuid",
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        searcherChannelId: SYNTH_SEARCHER_CHANNEL,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /rescatado — outcome human_review", () => {
  it("200 con outcome='human_review' cuando registrante es menor", async () => {
    await buildApp(makeFakeDeps(true)); // registrantIsMinor=true

    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      payload: {
        personId: SYNTH_PERSON_ID,
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        searcherChannelId: SYNTH_SEARCHER_CHANNEL,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; outcome: string };
    expect(body.ok).toBe(true);
    expect(body.outcome).toBe("human_review");
  });
});
