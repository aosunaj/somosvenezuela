import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { PublicPerson } from "core";
import type {
  MatchConfirmContext,
  MatchEstadoRevision,
  MatchRepo,
  MatchWithContext,
  NotificationCreate,
  NotificationRepo,
} from "db";
import { errorHandler } from "../src/errors.js";
import { registerMatchRoutes } from "../src/routes/matches.js";

// Tests de las rutas de REVISION HUMANA de matches (x-service-token). Fakes
// PROPIOS, Fastify a mano. Datos SINTETICOS (guardrail #5).
//
// CONTRATO 5:
//   - GET /matches/pending devuelve matches 'propuesto' con contexto, SIN PII.
//   - POST /matches/:id/confirm confirma y crea notificacion segura al buscador.
//   - confirm sin buscador -> { ok:true, notified:false } y NO notifica.
//   - POST /matches/:id/discard descarta.

const SERVICE_TOKEN = "token-de-servicio-sintetico";
const MATCH_ID = "b0000000-0000-4000-8000-000000000001";
const SEARCH_ID = "d0000000-0000-4000-8000-000000000001";
const PERSON_ID = "a0000000-0000-4000-8000-000000000001";
const CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "e0000000-0000-4000-8000-000000000001";

interface Calls {
  pendingListed: number;
  estadoChanges: Array<{ id: string; estado: MatchEstadoRevision; revisadoPor?: string }>;
  notifications: NotificationCreate[];
  confirmContextFor: string[];
}

function makeCalls(): Calls {
  return { pendingListed: 0, estadoChanges: [], notifications: [], confirmContextFor: [] };
}

function fakeCandidate(): PublicPerson {
  return {
    id: PERSON_ID,
    nombre: "Persona Sintetica",
    apellidos: "Apellido Ficticio",
    edad: 30,
    zona: "Zona Norte",
    descripcion: "Datos de prueba",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function fakePending(): MatchWithContext {
  return {
    id: MATCH_ID,
    score: 0.87,
    metodo: "trigram",
    created_at: "2026-01-01T00:00:00.000Z",
    search: { target_nombre: "Persona Buscada", zona: "Zona Norte" },
    candidate: fakeCandidate(),
  };
}

/** confirmContext con buscador resoluble (caso "notifica"). */
function contextWithBuscador(): MatchConfirmContext {
  return {
    matchId: MATCH_ID,
    searchId: SEARCH_ID,
    personId: PERSON_ID,
    buscadorContactId: CONTACT_ID,
    channelId: CHANNEL_ID,
  };
}

function makeFakeMatchRepo(calls: Calls, confirmCtx: MatchConfirmContext | null): MatchRepo {
  return {
    async create() {
      throw new Error("no usado en estos tests");
    },
    async listPendingWithContext() {
      calls.pendingListed += 1;
      return [fakePending()];
    },
    async getById() {
      return null;
    },
    async setEstadoRevision(id, estado, revisadoPor) {
      calls.estadoChanges.push(
        revisadoPor === undefined ? { id, estado } : { id, estado, revisadoPor },
      );
    },
    async getConfirmContext(id) {
      calls.confirmContextFor.push(id);
      return confirmCtx;
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

let app: FastifyInstance;
let calls: Calls;

function buildWith(
  serviceToken: string | undefined,
  confirmCtx: MatchConfirmContext | null = contextWithBuscador(),
): void {
  calls = makeCalls();
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerMatchRoutes(app, {
    matchRepo: makeFakeMatchRepo(calls, confirmCtx),
    notificationRepo: makeFakeNotificationRepo(calls),
    serviceToken,
  });
}

afterEach(async () => {
  await app.close();
});

describe("GET /matches/pending (x-service-token)", () => {
  beforeEach(async () => {
    buildWith(SERVICE_TOKEN);
    await app.ready();
  });

  it("sin token -> 401 y no lista", async () => {
    const res = await app.inject({ method: "GET", url: "/matches/pending" });
    expect(res.statusCode).toBe(401);
    expect(calls.pendingListed).toBe(0);
  });

  it("token correcto -> 200 con contexto y SIN PII de contacto", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/matches/pending",
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matches).toHaveLength(1);
    const m = body.matches[0];
    expect(m.id).toBe(MATCH_ID);
    expect(m.score).toBeTypeOf("number");
    expect(m.search.target_nombre).toBe("Persona Buscada");
    expect(m.candidate.nombre).toBe("Persona Sintetica");
    // GUARDRAIL #1: jamas contact_id/telefono ni el id de contacto sintetico.
    expect(res.payload).not.toContain("contact_id");
    expect(res.payload).not.toContain("buscador_contact_id");
    expect(res.payload).not.toContain("telefono");
    expect(res.payload).not.toContain(CONTACT_ID);
  });
});

describe("POST /matches/:id/confirm (x-service-token)", () => {
  it("sin token -> 401 y no confirma ni notifica", async () => {
    buildWith(SERVICE_TOKEN);
    await app.ready();
    const res = await app.inject({ method: "POST", url: `/matches/${MATCH_ID}/confirm` });
    expect(res.statusCode).toBe(401);
    expect(calls.estadoChanges).toHaveLength(0);
    expect(calls.notifications).toHaveLength(0);
  });

  it("con buscador -> confirma y crea notificacion SEGURA (sin PII de la otra parte)", async () => {
    buildWith(SERVICE_TOKEN);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/matches/${MATCH_ID}/confirm`,
      headers: { "x-service-token": SERVICE_TOKEN },
      payload: { revisado_por: "operador-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Estado pasa a 'confirmado' con el revisor registrado.
    expect(calls.estadoChanges).toEqual([
      { id: MATCH_ID, estado: "confirmado", revisadoPor: "operador-1" },
    ]);

    // Se crea UNA notificacion dirigida al buscador, prioridad alta, tipo match.
    expect(calls.notifications).toHaveLength(1);
    const notif = calls.notifications[0];
    expect(notif?.contact_id).toBe(CONTACT_ID);
    expect(notif?.channel_id).toBe(CHANNEL_ID);
    expect(notif?.tipo).toBe("match");
    expect(notif?.prioridad).toBe("alta");

    // El payload es un mensaje humano + ids internos; SIN datos de la otra persona.
    const payload = JSON.stringify(notif?.payload);
    expect(payload).toContain("coincidencia");
    expect(payload).toContain(MATCH_ID);
    expect(payload).not.toContain("telefono");
    expect(payload).not.toContain("Persona Sintetica");
    expect(payload).not.toContain("Apellido Ficticio");
  });

  it("sin buscador -> confirma pero responde { ok:true, notified:false } y NO notifica", async () => {
    const ctxSinBuscador: MatchConfirmContext = {
      matchId: MATCH_ID,
      searchId: SEARCH_ID,
      personId: PERSON_ID,
      buscadorContactId: null,
      channelId: null,
    };
    buildWith(SERVICE_TOKEN, ctxSinBuscador);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/matches/${MATCH_ID}/confirm`,
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, notified: false });
    expect(calls.estadoChanges).toEqual([{ id: MATCH_ID, estado: "confirmado" }]);
    expect(calls.notifications).toHaveLength(0);
  });
});

describe("POST /matches/:id/discard (x-service-token)", () => {
  beforeEach(async () => {
    buildWith(SERVICE_TOKEN);
    await app.ready();
  });

  it("sin token -> 401 y no descarta", async () => {
    const res = await app.inject({ method: "POST", url: `/matches/${MATCH_ID}/discard` });
    expect(res.statusCode).toBe(401);
    expect(calls.estadoChanges).toHaveLength(0);
  });

  it("token correcto -> 200 { ok:true } y marca descartado", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/matches/${MATCH_ID}/discard`,
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls.estadoChanges).toEqual([{ id: MATCH_ID, estado: "descartado" }]);
  });

  it("id invalido -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/matches/no-es-uuid/discard",
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(400);
    expect(calls.estadoChanges).toHaveLength(0);
  });
});

describe("sin serviceToken configurado", () => {
  beforeEach(async () => {
    buildWith(undefined);
    await app.ready();
  });

  it("GET pending responde 401 aunque se envie cualquier token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/matches/pending",
      headers: { "x-service-token": "cualquier-cosa" },
    });
    expect(res.statusCode).toBe(401);
  });
});
