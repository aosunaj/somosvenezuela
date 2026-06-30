import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { AliveMessage, AliveMessageCreate } from "core";
import type { AliveMessagesRepo } from "db";
import { errorHandler } from "../src/errors.js";
import { registerAliveMessagesRoutes } from "../src/routes/alive-messages.js";

// Tests TDD para POST /alive-messages (Spec 06, Slice 1).
// Datos 100% sintéticos — sin PII real (guardrail).
//
// Contrato verificado:
//   - 401 sin header x-bot-secret (cuando secreto configurado)
//   - 201 con body válido (tipo texto) + secreto correcto
//   - 400 tipo voz → rechazado en Slice 1
//   - 400 con body inválido (falta autorNombre, contenido vacío, tipo incorrecto)
//   - 400 autorNombre/contenido solo-espacios
//   - La respuesta NUNCA incluye contact_id ni PII de contacto
//   - Body 201 incluye contenido, tipo, createdAt y zona

const SYNTH_MSG_ID = "f1000001-0000-4000-8000-000000000001";
const SYNTH_PERSON_ID = "a1000001-0000-4000-8000-000000000002";
const FAKE_SECRET = "test-bot-secret-synthethic";

/** Dominio sintetico que devuelve el fake repo. */
function makeFakeMessage(overrides: Partial<AliveMessage> = {}): AliveMessage {
  return {
    id: SYNTH_MSG_ID,
    autorNombre: "Ana Bolívar",
    tipo: "texto",
    contenido: "Todos estamos bien, nos quedamos en el refugio",
    zona: "Caracas",
    personId: null,
    entregado: false,
    createdAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

interface RepoCalls {
  created: AliveMessageCreate[];
}

/** Fake AliveMessagesRepo que captura llamadas y devuelve mensajes sintéticos. */
function makeFakeAliveMessagesRepo(calls: RepoCalls): AliveMessagesRepo {
  return {
    async create(input) {
      calls.created.push(input);
      return makeFakeMessage({
        autorNombre: input.autorNombre,
        contenido: input.contenido,
        zona: input.zona ?? null,
      });
    },
    async getById(_id) {
      return null;
    },
    async getPendingByPersonId(_personId) {
      return [];
    },
    async markDelivered(_id) {
      /* no-op */
    },
  };
}

let app: FastifyInstance;
let calls: RepoCalls;

/** Build the app with the given botSecret (defaults to FAKE_SECRET so auth is active). */
async function build(botSecret: string | undefined = FAKE_SECRET): Promise<void> {
  calls = { created: [] };
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerAliveMessagesRoutes(app, {
    aliveMessagesRepo: makeFakeAliveMessagesRepo(calls),
    botSecret,
  });
  await app.ready();
}

beforeEach(() => build());
afterEach(async () => {
  await app.close();
});

describe("POST /alive-messages — auth (x-bot-secret)", () => {
  it("401 si falta el header x-bot-secret", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "texto",
        contenido: "Estamos bien",
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("401 si el secreto es incorrecto", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": "wrong-secret" },
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "texto",
        contenido: "Estamos bien",
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("201 si el secreto es correcto", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "texto",
        contenido: "Estamos bien",
      },
    });

    expect(res.statusCode).toBe(201);
  });
});

describe("POST /alive-messages — tipo voz rechazado en Slice 1", () => {
  it("400 para tipo voz con mensaje claro en español", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Luis Gómez",
        tipo: "voz",
        contenido: "nota-placeholder",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; message: string };
    expect(body.message).toContain("voz");
  });
});

describe("POST /alive-messages", () => {
  // ── 201 casos felices ─────────────────────────────────────────────────────

  it("201 con mensaje de texto válido — body incluye contenido, tipo, createdAt, zona", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "texto",
        contenido: "Estamos bien en el refugio norte",
        zona: "Caracas",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as AliveMessage;
    expect(body.id).toBe(SYNTH_MSG_ID);
    expect(body.autorNombre).toBe("Ana Bolívar");
    expect(body.entregado).toBe(false);
    // Fix B: assert contenido, tipo, createdAt, zona present and non-empty
    expect(body.contenido).toBeTruthy();
    expect(body.tipo).toBe("texto");
    expect(body.createdAt).toBeTruthy();
    expect(body.zona).toBe("Caracas");
  });

  it("201 con campos opcionales (zona y personId)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Carlos Díaz",
        tipo: "texto",
        contenido: "Sobrevivimos",
        zona: "La Guaira",
        personId: SYNTH_PERSON_ID,
      },
    });

    expect(res.statusCode).toBe(201);
    // repo.create was called with the parsed input
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]!.zona).toBe("La Guaira");
  });

  // ── 400 validaciones ──────────────────────────────────────────────────────

  it("400 si falta autorNombre", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        tipo: "texto",
        contenido: "Estamos bien",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si autorNombre está vacío", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "",
        tipo: "texto",
        contenido: "Estamos bien",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si autorNombre es solo espacios", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "   ",
        tipo: "texto",
        contenido: "Estamos bien",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si contenido está vacío", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "texto",
        contenido: "",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si contenido es solo espacios", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "texto",
        contenido: "   ",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si tipo es inválido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "imagen",
        contenido: "Estamos bien",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("400 si personId no es un UUID válido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "texto",
        contenido: "Estamos bien",
        personId: "not-a-uuid",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── GUARDRAIL: la respuesta no debe exponer PII de contacto ──────────────

  it("la respuesta NUNCA incluye contact_id ni PII de contacto (guardrail #1)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alive-messages",
      headers: { "x-bot-secret": FAKE_SECRET },
      payload: {
        autorNombre: "Ana Bolívar",
        tipo: "texto",
        contenido: "Estamos bien",
      },
    });

    expect(res.statusCode).toBe(201);
    const raw = res.body;
    expect(raw).not.toContain("contact_id");
    expect(raw).not.toContain("buscador_contact_id");
    expect(raw).not.toContain("telefono");
  });
});
