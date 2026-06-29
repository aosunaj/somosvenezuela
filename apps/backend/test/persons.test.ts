import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  makeFakeMatchRepo,
  makeFakePersonRepo,
  makeFakeSearchRepo,
  makeRepoCalls,
  SYNTH_CONTACT_ID,
  SYNTH_PERSON_ID,
  type RepoCalls,
} from "./fakes.js";

// Contrato de privacidad y de defaults para personas (spec 01, guardrail #1).
// Se prueba la API completa con fastify.inject() y repos FALSOS (sin BD).

let app: FastifyInstance;
let calls: RepoCalls;

beforeEach(async () => {
  calls = makeRepoCalls();
  app = await buildApp(
    {
      personRepo: makeFakePersonRepo(calls),
      searchRepo: makeFakeSearchRepo(calls),
      matchRepo: makeFakeMatchRepo(calls),
      serviceToken: "token-de-servicio-sintetico",
    },
    // Limite alto para que el rate limit no interfiera con los tests.
    { rateLimitMax: 1000 },
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

/** Claves/valores que NUNCA deben aparecer en una respuesta publica. */
const FORBIDDEN_KEYS = ["contact_id", "buscador_contact_id", "telefono", "email"];

/** Recorre el JSON entero y comprueba que ninguna clave/valor prohibido aparece. */
function assertNoContact(payload: string): void {
  for (const key of FORBIDDEN_KEYS) {
    expect(payload).not.toContain(key);
  }
  expect(payload).not.toContain(SYNTH_CONTACT_ID);
}

describe("POST /persons", () => {
  it("crea y responde la vista publica SIN contact_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons",
      payload: { nombre: "Persona Sintetica", zona: "Zona Norte" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    // Contrato de privacidad: recorrer el JSON completo.
    assertNoContact(res.payload);
    expect("contact_id" in body).toBe(false);
    expect(body.id).toBe(SYNTH_PERSON_ID);
  });

  it("resulta en estado='desaparecida' y verificacion='sin_verificar' (defaults)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons",
      payload: { nombre: "Persona Sintetica" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.estado).toBe("desaparecida");
    expect(body.verificacion).toBe("sin_verificar");
    // El cliente no manda estado/verificacion: el repo los fija por defecto.
    expect(calls.personCreated).toHaveLength(1);
    expect(calls.personCreated[0]).not.toHaveProperty("estado");
  });

  it("no propaga contact_id a la respuesta aunque venga en el alta", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons",
      payload: { nombre: "Persona Sintetica", contact_id: SYNTH_CONTACT_ID },
    });

    expect(res.statusCode).toBe(201);
    assertNoContact(res.payload);
  });

  it("rechaza body invalido con 400 (nombre vacio)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons",
      payload: { nombre: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });

  it("rechaza body invalido con 400 (edad fuera de rango)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/persons",
      payload: { nombre: "Persona Sintetica", edad: 999 },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /persons/:id — auth de servicio (guardrail #7)", () => {
  it("sin x-service-token -> 401 y no borra", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${SYNTH_PERSON_ID}`,
    });

    expect(res.statusCode).toBe(401);
    expect(calls.removedIds).toHaveLength(0);
  });

  it("con token incorrecto -> 401 y no borra", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${SYNTH_PERSON_ID}`,
      headers: { "x-service-token": "token-incorrecto" },
    });

    expect(res.statusCode).toBe(401);
    expect(calls.removedIds).toHaveLength(0);
  });

  it("con token correcto -> 204 y llama al repo", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/persons/${SYNTH_PERSON_ID}`,
      headers: { "x-service-token": "token-de-servicio-sintetico" },
    });

    expect(res.statusCode).toBe(204);
    expect(calls.removedIds).toEqual([SYNTH_PERSON_ID]);
  });

  it("id invalido (no uuid) con token correcto -> 400", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/persons/no-es-uuid",
      headers: { "x-service-token": "token-de-servicio-sintetico" },
    });

    expect(res.statusCode).toBe(400);
    expect(calls.removedIds).toHaveLength(0);
  });
});

describe("DELETE /persons/:id — sin serviceToken configurado", () => {
  it("responde 401 aunque se envie cualquier token", async () => {
    const localCalls = makeRepoCalls();
    const localApp = await buildApp(
      {
        personRepo: makeFakePersonRepo(localCalls),
        searchRepo: makeFakeSearchRepo(localCalls),
        matchRepo: makeFakeMatchRepo(localCalls),
        serviceToken: undefined,
      },
      { rateLimitMax: 1000 },
    );
    await localApp.ready();

    const res = await localApp.inject({
      method: "DELETE",
      url: `/persons/${SYNTH_PERSON_ID}`,
      headers: { "x-service-token": "cualquier-cosa" },
    });

    expect(res.statusCode).toBe(401);
    expect(localCalls.removedIds).toHaveLength(0);
    await localApp.close();
  });
});
