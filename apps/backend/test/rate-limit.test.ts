import rateLimit from "@fastify/rate-limit";
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type {
  ChannelLinkRepo,
  PersonRepo,
  PersonStateAuditRepo,
  SecureDeleteRepo,
} from "db";
import { errorHandler } from "../src/errors.js";
import { registerMarkFoundSecureRoutes } from "../src/routes/mark-found-secure.js";
import {
  GLOBAL_RATE_LIMIT_MAX,
  RATE_LIMIT_TIME_WINDOW,
  SENSITIVE_RATE_LIMIT_MAX,
} from "../src/rate-limit.js";

// Test ENFOCADO de rate limiting (guardrail #6).
//
// Verifica que, con el plugin @fastify/rate-limit registrado, el endpoint SENSIBLE
// por canal (rescatado) aplica el limite ESTRICTO por-ruta y responde 429 al
// excederlo. El resto de los suites construyen la app SIN rate limit
// (NODE_ENV==='test' o rateLimitEnabled:false), por eso no reciben 429; aqui lo
// activamos a proposito. Fakes PROPIOS, Fastify a mano. Datos SINTETICOS.

const OWNER_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const PERSON_ID = "a0000000-0000-4000-8000-000000000001";

/** Fake channelLinkRepo: el canal (telegram, "tg-owner") pertenece al dueno. */
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

/** Fake secureDeleteRepo: la persona PERSON_ID pertenece al dueno del canal. */
function makeFakeSecureDeleteRepo(): SecureDeleteRepo {
  return {
    async getPersonContactId(personId) {
      return personId === PERSON_ID ? OWNER_CONTACT_ID : null;
    },
    async deletePersonAndOwner() {
      throw new Error("no usado en este test");
    },
  };
}

/** Fake personRepo: markFound siempre resuelve (el foco es el rate limit, no el repo). */
function makeFakePersonRepo(): PersonRepo {
  return {
    async create() {
      throw new Error("no usado en este test");
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
      throw new Error("no usado en este test");
    },
    async markFound() {
      /* no-op: autorizado */
    },
  };
}

/** Fake auditoria: no-op (el foco de este test es el rate limit, no la auditoria). */
function makeFakePersonStateAuditRepo(): PersonStateAuditRepo {
  return {
    async record() {
      /* no-op */
    },
  };
}

let app: FastifyInstance;

/**
 * Construye un Fastify "a mano" CON el plugin de rate limit registrado (igual que
 * hace buildApp cuando rateLimitEnabled es true) y la ruta sensible montada. Asi el
 * `config.rateLimit` por-ruta queda activo y podemos comprobar el 429.
 */
async function buildWithRateLimit(): Promise<void> {
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, {
    max: GLOBAL_RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_TIME_WINDOW,
  });
  registerMarkFoundSecureRoutes(app, {
    channelLinkRepo: makeFakeChannelLinkRepo(),
    secureDeleteRepo: makeFakeSecureDeleteRepo(),
    personRepo: makeFakePersonRepo(),
    personStateAuditRepo: makeFakePersonStateAuditRepo(),
  });
  await app.ready();
}

afterEach(async () => {
  await app.close();
});

describe("rate limit estricto en endpoint sensible (guardrail #6)", () => {
  it("responde 429 al exceder el limite por-ruta del rescatado", async () => {
    await buildWithRateLimit();

    // Hasta el limite estricto, todas las peticiones autorizadas pasan (200).
    for (let i = 0; i < SENSITIVE_RATE_LIMIT_MAX; i += 1) {
      const ok = await app.inject({
        method: "POST",
        url: `/persons/${PERSON_ID}/found-by-channel`,
        payload: { plataforma: "telegram", chatId: "tg-owner" },
      });
      expect(ok.statusCode).toBe(200);
    }

    // La siguiente (la #11) supera el limite estricto: 429 Too Many Requests.
    const blocked = await app.inject({
      method: "POST",
      url: `/persons/${PERSON_ID}/found-by-channel`,
      payload: { plataforma: "telegram", chatId: "tg-owner" },
    });
    expect(blocked.statusCode).toBe(429);
  });
});
