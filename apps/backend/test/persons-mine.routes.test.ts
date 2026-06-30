import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { OwnedPerson } from "core";
import type { ChannelLinkRepo, PersonRepo } from "db";
import { errorHandler } from "../src/errors.js";
import { registerPersonsMineRoutes } from "../src/routes/persons-mine.js";

// Tests de POST /persons/mine-by-channel: el dueno lista SUS registros por canal para
// elegir cual marcar/borrar sin pegar codigos. Fakes PROPIOS, Fastify a mano. Datos
// SINTETICOS. Contrato: nunca expone contact_id; canal desconocido => lista vacia.

const OWNER_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const PERSON_ID = "a0000000-0000-4000-8000-000000000001";
const FORBIDDEN_CONTACT_ID = "c0000000-0000-4000-8000-000000000099";

interface Calls {
  listedBy: string[];
}

/** El canal (telegram, "tg-owner") pertenece a OWNER_CONTACT_ID; cualquier otro, null. */
function makeFakeChannelLinkRepo(): ChannelLinkRepo {
  return {
    async ensureChannel() {
      return { contactId: OWNER_CONTACT_ID, channelId: "e0000000-0000-4000-8000-000000000001" };
    },
    async findContactByChannel(plataforma, chatId) {
      if (plataforma === "telegram" && chatId === "tg-owner") return OWNER_CONTACT_ID;
      return null;
    },
  };
}

/** Fake personRepo: solo implementa listByContact (captura el contactId) y un registro. */
function makeFakePersonRepo(calls: Calls): PersonRepo {
  const owned: OwnedPerson = {
    id: PERSON_ID,
    nombre: "Persona Sintetica",
    apellidos: "De Prueba",
    zona: "Zona Ficticia",
    estado: "desaparecida",
  };
  return {
    async create() {
      throw new Error("no usado en estos tests");
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
    async listByContact(contactId) {
      calls.listedBy.push(contactId);
      return [owned];
    },
    async remove() {
      throw new Error("no usado en estos tests");
    },
    async markFound() {
      throw new Error("no usado en estos tests");
    },
  };
}

let app: FastifyInstance;
let calls: Calls;

async function build(): Promise<void> {
  calls = { listedBy: [] };
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerPersonsMineRoutes(app, {
    channelLinkRepo: makeFakeChannelLinkRepo(),
    personRepo: makeFakePersonRepo(calls),
  });
  await app.ready();
}

beforeEach(build);
afterEach(async () => {
  await app.close();
});

describe("POST /persons/mine-by-channel", () => {
  it("devuelve los registros del dueno cuando el canal le pertenece", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons/mine-by-channel",
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { persons: OwnedPerson[] };
    expect(body.persons).toHaveLength(1);
    expect(body.persons[0]?.nombre).toBe("Persona Sintetica");
    // Resolvio el contacto del canal y listo por ese contacto.
    expect(calls.listedBy).toEqual([OWNER_CONTACT_ID]);
  });

  it("nunca expone contact_id ni telefono en la respuesta (guardrail #1)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons/mine-by-channel",
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    const raw = res.body;
    expect(raw).not.toContain("contact_id");
    expect(raw).not.toContain("telefono");
    expect(raw).not.toContain(OWNER_CONTACT_ID);
    expect(raw).not.toContain(FORBIDDEN_CONTACT_ID);
  });

  it("canal desconocido => lista vacia, sin consultar registros", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons/mine-by-channel",
      payload: { plataforma: "telegram", chatId: "tg-desconocido" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { persons: OwnedPerson[] }).persons).toEqual([]);
    expect(calls.listedBy).toHaveLength(0);
  });

  it("sin prueba de propiedad (sin body ni headers) => lista vacia", async () => {
    const res = await app.inject({ method: "POST", url: "/persons/mine-by-channel" });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { persons: OwnedPerson[] }).persons).toEqual([]);
    expect(calls.listedBy).toHaveLength(0);
  });

  it("acepta la prueba de propiedad por cabeceras (sin body)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons/mine-by-channel",
      headers: { "x-plataforma": "telegram", "x-chat-id": "tg-owner" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { persons: OwnedPerson[] }).persons).toHaveLength(1);
  });
});
