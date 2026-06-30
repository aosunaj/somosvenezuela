import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type {
  ChannelLinkRepo,
  PersonRepo,
  PersonStateAuditRepo,
  PersonStateChangeInput,
  SecureDeleteRepo,
} from "db";
import { errorHandler } from "../src/errors.js";
import { registerMarkFoundSecureRoutes } from "../src/routes/mark-found-secure.js";

// Tests de POST /persons/:id/found-by-channel (rescatado seguro por propiedad del
// canal). Misma autorizacion que el borrado seguro; en vez de borrar, marca el
// estado. Fakes PROPIOS, Fastify a mano. Datos SINTETICOS.

const OWNER_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const OTHER_CONTACT_ID = "c0000000-0000-4000-8000-000000000002";
const PERSON_ID = "a0000000-0000-4000-8000-000000000001";

interface Calls {
  markedFound: string[];
  audited: PersonStateChangeInput[];
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
function makeFakeSecureDeleteRepo(personContactId: string | null): SecureDeleteRepo {
  return {
    async getPersonContactId(personId) {
      return personId === PERSON_ID ? personContactId : null;
    },
    async deletePersonAndOwner() {
      throw new Error("no usado en estos tests");
    },
  };
}

/**
 * Fake personRepo: solo implementa markFound (captura los ids) y deja el resto sin
 * uso. Cubre el contrato de la ruta sin tocar la BD.
 */
function makeFakePersonRepo(calls: Calls): PersonRepo {
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
    async remove() {
      throw new Error("no usado en estos tests");
    },
    async markFound(id) {
      calls.markedFound.push(id);
    },
    async listByContact() {
      return [];
    },
  };
}

/** Fake auditoria: captura las filas de cambio de estado para aserciones. */
function makeFakePersonStateAuditRepo(calls: Calls): PersonStateAuditRepo {
  return {
    async record(input) {
      calls.audited.push(input);
    },
  };
}

let app: FastifyInstance;
let calls: Calls;

async function buildWith(personContactId: string | null): Promise<void> {
  calls = { markedFound: [], audited: [] };
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerMarkFoundSecureRoutes(app, {
    channelLinkRepo: makeFakeChannelLinkRepo(),
    secureDeleteRepo: makeFakeSecureDeleteRepo(personContactId),
    personRepo: makeFakePersonRepo(calls),
    personStateAuditRepo: makeFakePersonStateAuditRepo(calls),
  });
  await app.ready();
}

afterEach(async () => {
  await app.close();
});

describe("POST /persons/:id/found-by-channel — dueno correcto", () => {
  beforeEach(async () => {
    await buildWith(OWNER_CONTACT_ID);
  });

  it("marca (200) cuando el canal pertenece al contacto de la persona", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/persons/${PERSON_ID}/found-by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    expect(res.statusCode).toBe(200);
    expect(calls.markedFound).toEqual([PERSON_ID]);
  });

  it("registra EXACTAMENTE una fila de auditoria con persona, autor y estado nuevo (guardrail #8)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/persons/${PERSON_ID}/found-by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    expect(res.statusCode).toBe(200);
    // Quien + cuando + estado nuevo: una sola fila de auditoria, con el contacto
    // dueno del canal como autor del cambio.
    expect(calls.audited).toHaveLength(1);
    expect(calls.audited[0]).toMatchObject({
      personId: PERSON_ID,
      changedByContactId: OWNER_CONTACT_ID,
      estadoNuevo: "encontrada_viva",
    });
  });

  it("acepta la prueba de propiedad por cabeceras (sin body)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/persons/${PERSON_ID}/found-by-channel`,
      headers: { "x-plataforma": "telegram", "x-chat-id": "tg-owner" },
    });

    expect(res.statusCode).toBe(200);
    expect(calls.markedFound).toHaveLength(1);
  });
});

describe("POST /persons/:id/found-by-channel — no autorizado", () => {
  it("403 si el canal pertenece a OTRO contacto", async () => {
    await buildWith(OTHER_CONTACT_ID);

    const res = await app.inject({
      method: "POST",
      url: `/persons/${PERSON_ID}/found-by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    expect(res.statusCode).toBe(403);
    expect(calls.markedFound).toHaveLength(0);
    // Un cambio no autorizado NO deja rastro de auditoria.
    expect(calls.audited).toHaveLength(0);
  });

  it("403 si el canal no existe (findContactByChannel null)", async () => {
    await buildWith(OWNER_CONTACT_ID);

    const res = await app.inject({
      method: "POST",
      url: `/persons/${PERSON_ID}/found-by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-desconocido" },
    });

    expect(res.statusCode).toBe(403);
    expect(calls.markedFound).toHaveLength(0);
  });

  it("403 si la persona no tiene contacto", async () => {
    await buildWith(null);

    const res = await app.inject({
      method: "POST",
      url: `/persons/${PERSON_ID}/found-by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });

    expect(res.statusCode).toBe(403);
    expect(calls.markedFound).toHaveLength(0);
  });

  it("403 si falta la prueba de propiedad (sin body ni headers)", async () => {
    await buildWith(OWNER_CONTACT_ID);

    const res = await app.inject({
      method: "POST",
      url: `/persons/${PERSON_ID}/found-by-channel`,
    });

    expect(res.statusCode).toBe(403);
    expect(calls.markedFound).toHaveLength(0);
  });
});
