import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { ChannelLinkRepo, SecureDeleteRepo } from "db";
import { errorHandler } from "../src/errors.js";
import { registerDeleteSecureRoutes } from "../src/routes/delete-secure.js";

// Tests de DELETE /persons/:id/by-channel (borrado seguro por propiedad del canal).
// Fakes PROPIOS, Fastify a mano. Datos SINTETICOS.

const OWNER_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const OTHER_CONTACT_ID = "c0000000-0000-4000-8000-000000000002";
const PERSON_ID = "a0000000-0000-4000-8000-000000000001";

interface Calls {
  deleted: Array<{ personId: string; contactId: string | null }>;
}

/**
 * Fake channelLinkRepo: el canal (telegram, "tg-owner") pertenece a OWNER_CONTACT_ID.
 * Cualquier otro canal devuelve null (desconocido).
 */
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

/** Fake secureDeleteRepo: la persona PERSON_ID pertenece a `personContactId`. */
function makeFakeSecureDeleteRepo(
  personContactId: string | null,
  calls: Calls,
): SecureDeleteRepo {
  return {
    async getPersonContactId(personId) {
      return personId === PERSON_ID ? personContactId : null;
    },
    async deletePersonAndOwner(personId, contactId) {
      calls.deleted.push({ personId, contactId });
    },
  };
}

let app: FastifyInstance;
let calls: Calls;

async function buildWith(personContactId: string | null): Promise<void> {
  calls = { deleted: [] };
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerDeleteSecureRoutes(app, {
    channelLinkRepo: makeFakeChannelLinkRepo(),
    secureDeleteRepo: makeFakeSecureDeleteRepo(personContactId, calls),
  });
  await app.ready();
}

afterEach(async () => {
  await app.close();
});

describe("DELETE /persons/:id/by-channel — dueno correcto", () => {
  beforeEach(async () => {
    await buildWith(OWNER_CONTACT_ID);
  });

  it("borra (204) cuando el canal pertenece al contacto de la persona", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${PERSON_ID}/by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    expect(res.statusCode).toBe(204);
    expect(calls.deleted).toEqual([{ personId: PERSON_ID, contactId: OWNER_CONTACT_ID }]);
  });

  it("acepta la prueba de propiedad por cabeceras (sin body)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${PERSON_ID}/by-channel`,
      headers: { "x-plataforma": "telegram", "x-chat-id": "tg-owner" },
    });

    expect(res.statusCode).toBe(204);
    expect(calls.deleted).toHaveLength(1);
  });
});

describe("DELETE /persons/:id/by-channel — no autorizado", () => {
  it("403 si el canal pertenece a OTRO contacto", async () => {
    await buildWith(OTHER_CONTACT_ID);

    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${PERSON_ID}/by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    expect(res.statusCode).toBe(403);
    expect(calls.deleted).toHaveLength(0);
  });

  it("403 si el canal no existe (findContactByChannel null)", async () => {
    await buildWith(OWNER_CONTACT_ID);

    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${PERSON_ID}/by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-desconocido" },
    });

    expect(res.statusCode).toBe(403);
    expect(calls.deleted).toHaveLength(0);
  });

  it("403 si la persona no tiene contacto", async () => {
    await buildWith(null);

    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${PERSON_ID}/by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    expect(res.statusCode).toBe(403);
    expect(calls.deleted).toHaveLength(0);
  });

  it("403 si falta la prueba de propiedad (sin body ni headers)", async () => {
    await buildWith(OWNER_CONTACT_ID);

    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${PERSON_ID}/by-channel`,
    });

    expect(res.statusCode).toBe(403);
    expect(calls.deleted).toHaveLength(0);
  });
});
