import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { PlataformaCanal } from "core";
import type {
  ChannelRepo,
  ChannelTransport,
  Notification,
  NotificationRepo,
} from "db";
import { errorHandler } from "../src/errors.js";
import { registerNotificationsRoutes } from "../src/routes/notifications.js";

// Tests de las rutas internas de notificaciones (x-service-token). Fakes PROPIOS,
// Fastify a mano. Datos SINTETICOS.
//
// CONTRATO 3: GET /notifications/pending devuelve la DIRECCION DE TRANSPORTE
// (plataforma, chat_id) resuelta desde channels, SIN contact_id ni telefono.

const SERVICE_TOKEN = "token-de-servicio-sintetico";
const NOTIF_ID = "f0000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "e0000000-0000-4000-8000-000000000001";
const SYNTH_CHAT_ID = "tg-chat-000";

// Segunda notificacion/canal SINTETICOS para probar el filtro por plataforma a
// nivel de servidor (su canal es de WhatsApp).
const NOTIF_ID_WA = "f0000000-0000-4000-8000-000000000002";
const CHANNEL_ID_WA = "e0000000-0000-4000-8000-000000000002";
const SYNTH_CHAT_ID_WA = "wa-chat-000";

interface Calls {
  pendingListed: number;
  sentIds: string[];
  transportLookups: string[];
}

// Cola de notificaciones de prueba con la plataforma de su canal anotada, para que
// el fake repo pueda emular el filtrado por plataforma que hoy ocurre en BD.
interface FakeRow {
  readonly notification: Notification;
  readonly plataforma: PlataformaCanal;
  readonly chat_id: string;
}

function fakeNotification(): Notification {
  return {
    id: NOTIF_ID,
    contact_id: "c0000000-0000-4000-8000-000000000001",
    channel_id: CHANNEL_ID,
    tipo: "match",
    prioridad: "alta",
    payload: { mensaje: "Posible coincidencia.", match_id: NOTIF_ID },
    estado: "pendiente",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function fakeRows(): FakeRow[] {
  return [
    { notification: fakeNotification(), plataforma: "telegram", chat_id: SYNTH_CHAT_ID },
    {
      notification: {
        id: NOTIF_ID_WA,
        contact_id: "c0000000-0000-4000-8000-000000000002",
        channel_id: CHANNEL_ID_WA,
        tipo: "match",
        prioridad: "alta",
        payload: { mensaje: "Posible coincidencia (WA).", match_id: NOTIF_ID_WA },
        estado: "pendiente",
        created_at: "2026-01-01T00:00:01.000Z",
      },
      plataforma: "whatsapp",
      chat_id: SYNTH_CHAT_ID_WA,
    },
  ];
}

function makeFakeNotificationRepo(calls: Calls, rows: FakeRow[] = fakeRows()): NotificationRepo {
  return {
    async create() {
      return fakeNotification();
    },
    // Emula el contrato real: si llega `plataforma`, filtra por la plataforma del
    // canal (lo que en produccion hace el inner join en BD).
    async listPending(_limit, plataforma) {
      calls.pendingListed += 1;
      const selected =
        plataforma === undefined ? rows : rows.filter((r) => r.plataforma === plataforma);
      return selected.map((r) => r.notification);
    },
    async markSent(id) {
      calls.sentIds.push(id);
    },
    async markFailed() {
      /* no-op */
    },
  };
}

function makeFakeChannelRepo(calls: Calls, rows: FakeRow[] = fakeRows()): ChannelRepo {
  return {
    async create() {
      throw new Error("no usado");
    },
    async listByContact() {
      return [];
    },
    async getTransport(id): Promise<ChannelTransport | null> {
      calls.transportLookups.push(id);
      const row = rows.find((r) => r.notification.channel_id === id);
      if (row === undefined) return null;
      return { plataforma: row.plataforma, chat_id: row.chat_id };
    },
    async remove() {
      /* no-op */
    },
  };
}

let app: FastifyInstance;
let calls: Calls;

function buildWith(serviceToken: string | undefined): void {
  calls = { pendingListed: 0, sentIds: [], transportLookups: [] };
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerNotificationsRoutes(app, {
    notificationRepo: makeFakeNotificationRepo(calls),
    channelRepo: makeFakeChannelRepo(calls),
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

  it("plataforma=telegram -> 200 con direccion de transporte y SIN PII de contacto", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/pending?plataforma=telegram",
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications).toHaveLength(1);
    const notif = body.notifications[0];
    // Direccion de transporte resuelta desde channels via channel_id.
    expect(notif.id).toBe(NOTIF_ID);
    expect(notif.plataforma).toBe("telegram");
    expect(notif.chat_id).toBe(SYNTH_CHAT_ID);
    expect(notif.tipo).toBe("match");
    expect(notif.prioridad).toBe("alta");
    expect(calls.pendingListed).toBe(1);
    expect(calls.transportLookups).toEqual([CHANNEL_ID]);
    // GUARDRAIL #1: nunca contact_id ni telefono en la proyeccion para el bot.
    expect(res.payload).not.toContain("contact_id");
    expect(res.payload).not.toContain("telefono");
    expect(res.payload).not.toContain("c0000000-0000-4000-8000-000000000001");
  });

  it("plataforma=telegram NO devuelve notificaciones cuyo canal es whatsapp (FIX W1)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/pending?plataforma=telegram",
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Solo la de telegram: la de whatsapp NO se filtra hacia este bot (no exponemos
    // su chat_id a la otra plataforma).
    expect(body.notifications.map((n: { id: string }) => n.id)).toEqual([NOTIF_ID]);
    expect(res.payload).not.toContain(NOTIF_ID_WA);
    expect(res.payload).not.toContain(SYNTH_CHAT_ID_WA);
  });

  it("plataforma=whatsapp NO devuelve notificaciones cuyo canal es telegram (FIX W1)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/pending?plataforma=whatsapp",
      headers: { "x-service-token": SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications.map((n: { id: string }) => n.id)).toEqual([NOTIF_ID_WA]);
    expect(res.payload).not.toContain(NOTIF_ID);
    expect(res.payload).not.toContain(SYNTH_CHAT_ID);
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
