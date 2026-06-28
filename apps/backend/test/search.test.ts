import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  makeFakePersonRepo,
  makeFakeSearchRepo,
  makeRepoCalls,
  SYNTH_CONTACT_ID,
  type RepoCalls,
} from "./fakes.js";

// Contrato de busqueda y de creacion de busquedas (spec 01, guardrail #1).

let app: FastifyInstance;
let calls: RepoCalls;

beforeEach(async () => {
  calls = makeRepoCalls();
  app = await buildApp(
    {
      personRepo: makeFakePersonRepo(calls),
      searchRepo: makeFakeSearchRepo(calls),
      serviceToken: "token-de-servicio-sintetico",
    },
    { rateLimitMax: 1000 },
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const FORBIDDEN = ["contact_id", "buscador_contact_id", "telefono", "email"];

function assertNoContact(payload: string): void {
  for (const key of FORBIDDEN) expect(payload).not.toContain(key);
  expect(payload).not.toContain(SYNTH_CONTACT_ID);
}

describe("GET /search", () => {
  it("devuelve resultados con score y SIN contacto", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/search?q=persona&zona=Norte",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    // Cada resultado lleva score y verificacion/fuente; nunca contacto.
    expect(body.results[0].score).toBeTypeOf("number");
    expect(body.results[0].verificacion).toBe("sin_verificar");
    expect(body.results[0].fuente).toBe("propia");
    assertNoContact(res.payload);
    // La zona se reenvia al repo como filtro.
    expect(calls.searchQueries[0]).toEqual({ query: "persona", zona: "Norte" });
  });

  it("funciona sin zona (solo q)", async () => {
    const res = await app.inject({ method: "GET", url: "/search?q=persona" });

    expect(res.statusCode).toBe(200);
    expect(calls.searchQueries[0]).toEqual({ query: "persona" });
  });

  it("sin q -> 400", async () => {
    const res = await app.inject({ method: "GET", url: "/search?zona=Norte" });

    expect(res.statusCode).toBe(400);
    expect(calls.searchQueries).toHaveLength(0);
  });

  it("tipo=mascota -> 501 (no soportado en Fase 1)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/search?q=firulais&tipo=mascota",
    });

    expect(res.statusCode).toBe(501);
    expect(res.json().error).toBe("not_implemented");
    expect(calls.searchQueries).toHaveLength(0);
  });

  it("tipo invalido -> 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/search?q=algo&tipo=otra-cosa",
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /searches", () => {
  it("crea y responde SIN buscador_contact_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: {
        tipo: "persona",
        target_nombre: "Persona Buscada",
        buscador_contact_id: SYNTH_CONTACT_ID,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    assertNoContact(res.payload);
    expect("buscador_contact_id" in body).toBe(false);
    expect(body.tipo).toBe("persona");
    // El campo sensible si llega al repo (uso interno), pero no sale en la respuesta.
    expect(calls.searchCreated[0]?.buscador_contact_id).toBe(SYNTH_CONTACT_ID);
  });

  it("rechaza body invalido con 400 (tipo no valido)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: { tipo: "extraterrestre" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });
});

describe("GET /health", () => {
  it("responde 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});
