import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Notification, NotificationRepo } from "db";
import { errorHandler } from "../src/errors.js";
import { registerNotificationsRoutes } from "../src/routes/notifications.js";

// Tests de las rutas internas de notificaciones (x-service-token). Fakes PROPIOS,
// Fastify a mano. Datos SINTETICOS.

const SERVICE_TOKEN = "token-de-servicio-sintetico";
const NOTIF_ID = "f0000000-0000-4000-8000-000000000001";

interface Calls {
  pendingListed: number;
  sentIds: string[];
}

function fakeNotification(): Notification {
  return {
    id: NOTIF_ID,
    contact_id: "c0000000-0000-4000-8000-000000000001",
    channel_id: "e0000000-0000-4000-8000-000000000001",
    tipo: "match",
    prioridad: "alta",
    payload: { person_id: "a0000000-0000-4000-8000-000000000001" },
    estado: "pendiente",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function makeFakeNotificationRepo(calls: Calls): NotificationRepo {
  return {
    async create() {
      return fakeNotification();
    },
    async listPending() {
      calls.pendingListed += 1;
      return [fakeNotification()];
    },
    async markSent(id) {
      calls.sentIds.push(id);
    },
    async markFailed() {
      /* no-op */
    },
  };
}

let app: FastifyInstance;
let calls: Calls;

function buildWith(serviceToken: string | undefined): void {
  calls = { pendingListed: 0, sentIds: [] };
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerNotificationsRoutes(app, {
    notificationRepo: makeFakeNotificationRepo(calls),
    serviceToken,
  });
}

afterEach(async () => {
  await app.close();
});

describe("GET /notifications/pending (x-service-token)", () => {
  beforeEach(async () => {
    buildWith(SERVICE_TOKEN);
    await app.ready();
  });

  it("sin token -> 401 y no lista", async () => {
    const res = await app.inject({ method: "GET", url: "/notifications/pending" });
    expect(res.statusCode).toBe(401);
    expect(calls.pendingListed).toBe(0);
  });

  it("token incorrecto -> 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/pending",
      headers: { "x-service-token": "incorrecto" },
    });
    expect(res.statusCode).toBe(401);
    expect(calls.pendingListed).toBe(0);
  });

  it("token correcto -> 200 con { notifications: [...] }", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/pending",
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].id).toBe(NOTIF_ID);
    expect(calls.pendingListed).toBe(1);
  });
});

describe("POST /notifications/:id/sent (x-service-token)", () => {
  beforeEach(async () => {
    buildWith(SERVICE_TOKEN);
    await app.ready();
  });

  it("sin token -> 401 y no marca", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${NOTIF_ID}/sent`,
    });
    expect(res.statusCode).toBe(401);
    expect(calls.sentIds).toHaveLength(0);
  });

  it("token correcto -> 200 { ok:true } y marca enviada", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${NOTIF_ID}/sent`,
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls.sentIds).toEqual([NOTIF_ID]);
  });

  it("id invalido -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notifications/no-es-uuid/sent",
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(400);
    expect(calls.sentIds).toHaveLength(0);
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
      url: "/notifications/pending",
      headers: { "x-service-token": "cualquier-cosa" },
    });
    expect(res.statusCode).toBe(401);
  });
});
