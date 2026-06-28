import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { ChannelLinkRepo, PersonRepo } from "db";
import type { Person, PersonCreate } from "core";
import { errorHandler } from "../src/errors.js";
import { registerRegisterLinkedRoutes } from "../src/routes/register-linked.js";

// Tests de POST /register-person con fakes PROPIOS (no toca fakes compartidos).
// Construye Fastify a mano (no se modifica app.ts). Datos SINTETICOS.

const SYNTH_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const SYNTH_PERSON_ID = "a0000000-0000-4000-8000-000000000001";
const SYNTH_CHANNEL_ID = "e0000000-0000-4000-8000-000000000001";

interface Calls {
  ensured: Array<{ plataforma: string; chatId: string; telefono?: string }>;
  personCreated: PersonCreate[];
}

function makeFakeChannelLinkRepo(calls: Calls): ChannelLinkRepo {
  return {
    async ensureChannel(input) {
      calls.ensured.push({
        plataforma: input.plataforma,
        chatId: input.chatId,
        ...(input.telefono === undefined ? {} : { telefono: input.telefono }),
      });
      return { contactId: SYNTH_CONTACT_ID, channelId: SYNTH_CHANNEL_ID };
    },
    async findContactByChannel() {
      return null;
    },
  };
}

function makeFakePersonRepo(calls: Calls): PersonRepo {
  return {
    async create(input) {
      calls.personCreated.push(input);
      const person: Person = {
        id: SYNTH_PERSON_ID,
        nombre: input.nombre,
        apellidos: input.apellidos ?? null,
        edad: input.edad ?? null,
        zona: input.zona ?? null,
        descripcion: input.descripcion ?? null,
        foto_url: input.foto_url ?? null,
        estado: "desaparecida",
        fuente: input.fuente ?? "propia",
        verificacion: "sin_verificar",
        contact_id: input.contact_id ?? SYNTH_CONTACT_ID,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };
      return person;
    },
    async listPublic() {
      return [];
    },
    async getPublic() {
      return null;
    },
    async searchPersonsPublic() {
      return [];
    },
    async remove() {
      /* no-op */
    },
  };
}

let app: FastifyInstance;
let calls: Calls;

beforeEach(async () => {
  calls = { ensured: [], personCreated: [] };
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerRegisterLinkedRoutes(app, {
    personRepo: makeFakePersonRepo(calls),
    channelLinkRepo: makeFakeChannelLinkRepo(calls),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("POST /register-person", () => {
  it("crea persona vinculada y responde 201 { personId } SIN contacto", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/register-person",
      payload: {
        person: { nombre: "Persona Sintetica", zona: "Zona Norte" },
        channel: { plataforma: "telegram", chatId: "tg-12345", telefono: "+580000000000" },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ personId: SYNTH_PERSON_ID });

    // El vinculo se aseguro con el canal recibido.
    expect(calls.ensured).toEqual([
      { plataforma: "telegram", chatId: "tg-12345", telefono: "+580000000000" },
    ]);
    // La persona se creo con el contact_id resuelto por el vinculo.
    expect(calls.personCreated[0]?.contact_id).toBe(SYNTH_CONTACT_ID);

    // PRIVACIDAD: la respuesta no filtra contacto ni canal (guardrail #1).
    const payload = res.payload;
    for (const forbidden of [
      "contact_id",
      "telefono",
      "chat_id",
      "chatId",
      SYNTH_CONTACT_ID,
      "+580000000000",
      "tg-12345",
    ]) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it("rechaza body sin canal con 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/register-person",
      payload: { person: { nombre: "Persona Sintetica" } },
    });

    expect(res.statusCode).toBe(400);
    expect(calls.personCreated).toHaveLength(0);
  });

  it("rechaza persona sin nombre con 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/register-person",
      payload: {
        person: { nombre: "" },
        channel: { plataforma: "telegram", chatId: "tg-1" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(calls.personCreated).toHaveLength(0);
  });
});
