import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { PlataformaCanal } from "core";
import type {
  ChannelLinkRepo,
  MatchRepo,
  NotificationCreate,
  NotificationRepo,
  RequestReunionResult,
  ReunionConsentResult,
  ReunionParteContacto,
} from "db";
import { errorHandler } from "../src/errors.js";
import { registerReunionRoutes } from "../src/routes/reunion.js";

// Tests de las rutas de REENCUENTRO con consentimiento bilateral. Fakes PROPIOS,
// Fastify a mano. Datos SINTETICOS (telefonos que NO casan el patron venezolano que
// vigila guardrails-scan).
//
// CONTRATO:
//   - POST /reunion/request : el buscador inicia; gate de menores; avisa al registrante
//     SIN contacto. Estados: requested | minor | failed.
//   - POST /reunion/consent : el registrante acepta/rechaza; SOLO con doble 'aceptado'
//     se comparte contacto (dos notificaciones). El rechazo no comparte nada.
//   - NUNCA aparece un telefono en una respuesta ni en una notificacion que no sea el
//     intercambio final tras el doble si.

const PERSON_ID = "a0000000-0000-4000-8000-000000000001";
const MATCH_ID = "b0000000-0000-4000-8000-000000000001";
const BUSCADOR_CONTACT = "c0000000-0000-4000-8000-0000000000b1";
const REGISTRANTE_CONTACT = "c0000000-0000-4000-8000-0000000000a1";
const BUSCADOR_CHANNEL = "e0000000-0000-4000-8000-0000000000b1";
const REGISTRANTE_CHANNEL = "e0000000-0000-4000-8000-0000000000a1";

// Telefonos SINTETICOS que NO casan /\+58 4\d{2}.../ (scanner de guardrails).
const TEL_BUSCADOR = "tel-sintetico-buscador";
const TEL_REGISTRANTE = "tel-sintetico-registrante";

const BUSCADOR_CHANNEL_ID = { plataforma: "telegram" as PlataformaCanal, chatId: "1001" };
const REGISTRANTE_CHANNEL_ID = { plataforma: "telegram" as PlataformaCanal, chatId: "2002" };

interface Calls {
  notifications: NotificationCreate[];
  requestReunionArgs: Array<{ buscadorContactId: string; personId: string }>;
  respondReunionArgs: Array<{ registranteContactId: string; decision: string }>;
}

function makeCalls(): Calls {
  return { notifications: [], requestReunionArgs: [], respondReunionArgs: [] };
}

/**
 * Fake de channelLinkRepo: resuelve el contacto dueno por (plataforma, chatId). Mapea
 * el chatId del buscador y del registrante a sus contactos; cualquier otro -> null.
 */
function makeFakeChannelLinkRepo(): ChannelLinkRepo {
  return {
    async ensureChannel() {
      throw new Error("no usado en estos tests");
    },
    async findContactByChannel(_plataforma, chatId) {
      if (chatId === BUSCADOR_CHANNEL_ID.chatId) return BUSCADOR_CONTACT;
      if (chatId === REGISTRANTE_CHANNEL_ID.chatId) return REGISTRANTE_CONTACT;
      return null;
    },
  };
}

/** Fake de matchRepo con requestReunion/respondReunion programables por test. */
function makeFakeMatchRepo(
  calls: Calls,
  requestResult: RequestReunionResult,
  respondResult: ReunionConsentResult,
): MatchRepo {
  return {
    async create() {
      throw new Error("no usado");
    },
    async listPendingWithContext() {
      return [];
    },
    async getById() {
      return null;
    },
    async setEstadoRevision() {
      /* no-op */
    },
    async getConfirmContext() {
      return null;
    },
    async requestReunion(input) {
      calls.requestReunionArgs.push(input);
      return requestResult;
    },
    async respondReunion(input) {
      calls.respondReunionArgs.push(input);
      return respondResult;
    },
  };
}

function makeFakeNotificationRepo(calls: Calls): NotificationRepo {
  return {
    async create(input) {
      calls.notifications.push(input);
      return {
        id: "f0000000-0000-4000-8000-000000000001",
        contact_id: input.contact_id ?? null,
        channel_id: input.channel_id ?? null,
        tipo: input.tipo,
        prioridad: input.prioridad ?? "normal",
        payload: input.payload ?? null,
        estado: "pendiente",
        created_at: "2026-01-01T00:00:00.000Z",
      };
    },
    async listPending() {
      return [];
    },
    async markSent() {
      /* no-op */
    },
    async markFailed() {
      /* no-op */
    },
  };
}

function parte(contactId: string, channelId: string | null, telefono: string | null): ReunionParteContacto {
  return { contactId, channelId, telefono };
}

let app: FastifyInstance;
let calls: Calls;

function buildWith(
  requestResult: RequestReunionResult,
  respondResult: ReunionConsentResult,
): void {
  calls = makeCalls();
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerReunionRoutes(app, {
    channelLinkRepo: makeFakeChannelLinkRepo(),
    matchRepo: makeFakeMatchRepo(calls, requestResult, respondResult),
    notificationRepo: makeFakeNotificationRepo(calls),
  });
}

const REQUEST_NOOP: RequestReunionResult = { outcome: "not_found" };
const RESPOND_NOOP: ReunionConsentResult = { outcome: "not_found" };

afterEach(async () => {
  await app.close();
});

describe("POST /reunion/request (el buscador inicia)", () => {
  it("'requested' -> 200 status:requested y notifica al registrante SIN contacto", async () => {
    buildWith(
      {
        outcome: "requested",
        matchId: MATCH_ID,
        registrante: { contactId: REGISTRANTE_CONTACT, channelId: REGISTRANTE_CHANNEL },
      },
      RESPOND_NOOP,
    );
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/reunion/request",
      payload: { channel: BUSCADOR_CHANNEL_ID, personId: PERSON_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "requested" });
    // Correlaciono al buscador por su canal.
    expect(calls.requestReunionArgs).toEqual([
      { buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID },
    ]);
    // Una notificacion al registrante, SIN telefono de nadie (guardrail #1).
    expect(calls.notifications).toHaveLength(1);
    const notif = calls.notifications[0];
    expect(notif?.contact_id).toBe(REGISTRANTE_CONTACT);
    expect(notif?.channel_id).toBe(REGISTRANTE_CHANNEL);
    const payload = JSON.stringify(notif?.payload);
    expect(payload.toLowerCase()).toContain("/conectar");
    expect(payload).not.toContain("telefono");
    expect(payload).not.toContain(TEL_REGISTRANTE);
    expect(payload).not.toContain(TEL_BUSCADOR);
  });

  it("'minor_blocked' -> 200 status:minor y NO notifica (guardrail #2 antitrata)", async () => {
    buildWith({ outcome: "minor_blocked" }, RESPOND_NOOP);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/reunion/request",
      payload: { channel: BUSCADOR_CHANNEL_ID, personId: PERSON_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "minor" });
    expect(calls.notifications).toHaveLength(0);
  });

  it("'not_found' -> 200 status:failed (generico, sin revelar nada)", async () => {
    buildWith({ outcome: "not_found" }, RESPOND_NOOP);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/reunion/request",
      payload: { channel: BUSCADOR_CHANNEL_ID, personId: PERSON_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "failed" });
    expect(calls.notifications).toHaveLength(0);
  });

  it("canal desconocido -> 200 status:failed sin tocar el repo de reencuentro", async () => {
    buildWith(REQUEST_NOOP, RESPOND_NOOP);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/reunion/request",
      payload: { channel: { plataforma: "telegram", chatId: "9999" }, personId: PERSON_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "failed" });
    expect(calls.requestReunionArgs).toHaveLength(0);
  });

  it("body invalido (personId no uuid) -> 400", async () => {
    buildWith(REQUEST_NOOP, RESPOND_NOOP);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/reunion/request",
      payload: { channel: BUSCADOR_CHANNEL_ID, personId: "no-es-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /reunion/consent (el registrante responde)", () => {
  it("RECHAZO -> 200 status:rejected, avisa al buscador SIN compartir contacto", async () => {
    buildWith(REQUEST_NOOP, {
      outcome: "rejected",
      matchId: MATCH_ID,
      buscador: { contactId: BUSCADOR_CONTACT, channelId: BUSCADOR_CHANNEL },
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/reunion/consent",
      payload: { channel: REGISTRANTE_CHANNEL_ID, decision: "rechazado" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "rejected" });
    expect(calls.respondReunionArgs).toEqual([
      { registranteContactId: REGISTRANTE_CONTACT, decision: "rechazado" },
    ]);
    // Una notificacion al buscador, SIN telefono de nadie.
    expect(calls.notifications).toHaveLength(1);
    expect(calls.notifications[0]?.contact_id).toBe(BUSCADOR_CONTACT);
    const payload = JSON.stringify(calls.notifications[0]?.payload);
    expect(payload).not.toContain(TEL_BUSCADOR);
    expect(payload).not.toContain(TEL_REGISTRANTE);
  });

  it("DOBLE SI -> 200 status:exchanged y DOS notificaciones, cada una con el contacto de la OTRA parte", async () => {
    buildWith(REQUEST_NOOP, {
      outcome: "exchanged",
      matchId: MATCH_ID,
      buscador: parte(BUSCADOR_CONTACT, BUSCADOR_CHANNEL, TEL_BUSCADOR),
      registrante: parte(REGISTRANTE_CONTACT, REGISTRANTE_CHANNEL, TEL_REGISTRANTE),
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/reunion/consent",
      payload: { channel: REGISTRANTE_CHANNEL_ID, decision: "aceptado" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "exchanged" });

    // Exactamente DOS notificaciones de intercambio.
    expect(calls.notifications).toHaveLength(2);
    const aBuscador = calls.notifications.find((n) => n.contact_id === BUSCADOR_CONTACT);
    const aRegistrante = calls.notifications.find((n) => n.contact_id === REGISTRANTE_CONTACT);

    // Al buscador le llega el telefono del REGISTRANTE (no el suyo).
    const pBuscador = JSON.stringify(aBuscador?.payload);
    expect(pBuscador).toContain(TEL_REGISTRANTE);
    expect(pBuscador).not.toContain(TEL_BUSCADOR);

    // Al registrante le llega el telefono del BUSCADOR (no el suyo).
    const pRegistrante = JSON.stringify(aRegistrante?.payload);
    expect(pRegistrante).toContain(TEL_BUSCADOR);
    expect(pRegistrante).not.toContain(TEL_REGISTRANTE);
  });

  it("'accepted_waiting' -> 200 status:accepted_waiting y NO comparte contacto", async () => {
    buildWith(REQUEST_NOOP, { outcome: "accepted_waiting", matchId: MATCH_ID });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/reunion/consent",
      payload: { channel: REGISTRANTE_CHANNEL_ID, decision: "aceptado" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "accepted_waiting" });
    // NUNCA se comparte contacto sin el doble si: cero notificaciones.
    expect(calls.notifications).toHaveLength(0);
  });

  it("'not_found' -> 200 status:not_found, sin notificar", async () => {
    buildWith(REQUEST_NOOP, { outcome: "not_found" });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/reunion/consent",
      payload: { channel: REGISTRANTE_CHANNEL_ID, decision: "aceptado" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "not_found" });
    expect(calls.notifications).toHaveLength(0);
  });

  it("canal desconocido -> 200 status:not_found sin tocar el repo", async () => {
    buildWith(REQUEST_NOOP, RESPOND_NOOP);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/reunion/consent",
      payload: { channel: { plataforma: "telegram", chatId: "9999" }, decision: "aceptado" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "not_found" });
    expect(calls.respondReunionArgs).toHaveLength(0);
  });

  it("decision invalida -> 400", async () => {
    buildWith(REQUEST_NOOP, RESPOND_NOOP);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/reunion/consent",
      payload: { channel: REGISTRANTE_CHANNEL_ID, decision: "quiza" },
    });
    expect(res.statusCode).toBe(400);
  });
});
