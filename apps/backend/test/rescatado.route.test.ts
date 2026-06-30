import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { errorHandler } from "../src/errors.js";
import {
  registerRescatadoRoutes,
  type RescatadoRouteDeps,
} from "../src/routes/rescatado.js";

// Tests de ruta POST /rescatado (Slice D).
//
// CONTRATO (B3): el cliente envia { personId, channel: { plataforma, chatId } } y
// la ruta resuelve searcherChannelId + searcherContactId server-side.
//
// PRIVACIDAD: ninguna respuesta expone PII.
// La ruta delega en reportRescatado() con fake deps.

const SYNTH_PERSON_ID = "cccccccc-0000-4000-8000-000000000003";
const SYNTH_SEARCH_ID = "dddddddd-0000-4000-8000-000000000004";
const SYNTH_REGISTRANT_CHANNEL = "bbbbbbbb-0000-4000-8000-000000000002";
const SYNTH_SEARCHER_CHANNEL = "aaaaaaaa-0000-4000-8000-000000000001";
const SYNTH_SEARCHER_CONTACT = "ffffffff-0000-4000-8000-000000000006";
const SYNTH_CONSENT_ID = "eeeeeeee-0000-4000-8000-000000000005";
// Secreto compartido bot<->backend (Modelo B). El test lo inyecta en deps y lo
// envia en el header x-bot-secret de las requests que deben llegar al handler.
const BOT_SECRET = "test-bot-secret";
const BOT_HEADERS = { "x-bot-secret": BOT_SECRET };

function makeFakeDeps(
  registrantIsMinor = false,
): RescatadoRouteDeps {
  return {
    botSecret: BOT_SECRET,
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
    channelLinkRepo: {
      // El buscador siempre resuelve a un canal + contacto adulto por defecto.
      async findChannelIdByChannel(_p, _c) {
        return SYNTH_SEARCHER_CHANNEL;
      },
      async findContactByChannel(_p, _c) {
        return SYNTH_SEARCHER_CONTACT;
      },
    },
  };
}

let app: FastifyInstance;

async function buildApp(deps: RescatadoRouteDeps): Promise<void> {
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

  it("401 si falta el header x-bot-secret (Modelo B, fail-closed)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      payload: {
        personId: SYNTH_PERSON_ID,
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        channel: { plataforma: "telegram", chatId: "tg-100" },
      },
      // sin header x-bot-secret
    });

    expect(res.statusCode).toBe(401);
  });

  it("200 con body valido (queued)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      headers: BOT_HEADERS,
      payload: {
        personId: SYNTH_PERSON_ID,
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        channel: { plataforma: "telegram", chatId: "tg-100" },
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
        channel: { plataforma: "telegram", chatId: "tg-100" },
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
        channel: { plataforma: "telegram", chatId: "tg-100" },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si falta channel (contrato by-channel)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      payload: {
        personId: SYNTH_PERSON_ID,
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si se envia el contrato viejo searcherChannelId (rechazado por .strict())", async () => {
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

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /rescatado — outcome human_review", () => {
  it("200 con outcome='human_review' cuando registrante es menor", async () => {
    await buildApp(makeFakeDeps(true)); // registrantIsMinor=true

    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      headers: BOT_HEADERS,
      payload: {
        personId: SYNTH_PERSON_ID,
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        channel: { plataforma: "telegram", chatId: "tg-100" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; outcome: string };
    expect(body.ok).toBe(true);
    expect(body.outcome).toBe("human_review");
  });
});

describe("POST /rescatado — resolucion del lado buscador (A1 + B3)", () => {
  it("canal no resuelto a channel_id → human_review (conservador)", async () => {
    const deps = makeFakeDeps(false);
    deps.channelLinkRepo.findChannelIdByChannel = async () => null;
    await buildApp(deps);

    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      headers: BOT_HEADERS,
      payload: {
        personId: SYNTH_PERSON_ID,
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        channel: { plataforma: "telegram", chatId: "tg-desconocido" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { outcome: string };
    expect(body.outcome).toBe("human_review");
  });

  it("buscador sin contact_id resuelto → human_review (gate A1 conservador)", async () => {
    const deps = makeFakeDeps(false);
    // channel resuelve, pero el contacto no → no es adulto positivo → human_review
    deps.channelLinkRepo.findContactByChannel = async () => null;
    await buildApp(deps);

    const res = await app.inject({
      method: "POST",
      url: "/rescatado",
      headers: BOT_HEADERS,
      payload: {
        personId: SYNTH_PERSON_ID,
        searchId: SYNTH_SEARCH_ID,
        registrantChannelId: SYNTH_REGISTRANT_CHANNEL,
        channel: { plataforma: "telegram", chatId: "tg-100" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { outcome: string };
    expect(body.outcome).toBe("human_review");
  });
});
