import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  makeFakeMatchRepo,
  makeFakePersonRepo,
  makeFakePersonStateAuditRepo,
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
      matchRepo: makeFakeMatchRepo(calls),
      personStateAuditRepo: makeFakePersonStateAuditRepo(calls),
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
    // Contrato que consume el bot: la respuesta SIEMPRE trae `results` (array de
    // coincidencias publicas, sin contact_id). Sin esto, el bot no puede mostrar
    // resultados y rompe la busqueda (regresion de Capa 2).
    expect(Array.isArray(body.results)).toBe(true);
    // El campo sensible si llega al repo (uso interno), pero no sale en la respuesta.
    expect(calls.searchCreated[0]?.buscador_contact_id).toBe(SYNTH_CONTACT_ID);
  });

  it("re-puntua los results con score ponderado honesto (no el greatest del RPC)", async () => {
    // El fake searchPersonsPublic devuelve "Persona Sintetica Apellido Ficticio"
    // con score de RPC 0.91. Al buscar SOLO el nombre de pila ("Persona"), el
    // re-ranking ponderado debe dar un parecido PARCIAL (< 1, distinto del 0.91
    // crudo del RPC): coincidir un campo no es certeza (requisito de la dueña).
    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: { tipo: "persona", target_nombre: "Persona" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    const top = body.results[0];
    expect(top.score).toBeTypeOf("number");
    // Honesto: nombre de pila suelto vs registro con apellidos -> NUNCA 100%.
    expect(top.score).toBeLessThan(1);
    expect(top.score).toBeGreaterThan(0);
    // Y NO es el score crudo del RPC (0.91): se recalculo con la media ponderada.
    expect(top.score).toBeLessThan(0.91);
    assertNoContact(res.payload);
  });

  it("results ordenados por score ponderado descendente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: { tipo: "persona", target_nombre: "Persona Sintetica" },
    });

    expect(res.statusCode).toBe(201);
    const scores: number[] = res.json().results.map((r: { score: number }) => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]!);
    }
  });

  it("busca SOLO por zona (sin nombre) y devuelve results", async () => {
    // Caso real de emergencia: "quien hay registrado en La Guaira". Sin nombre, el
    // backend recupera el pool con q vacio y la zona como filtro, y re-rankea.
    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: { tipo: "persona", zona: "Zona Sintetica Norte" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].score).toBeTypeOf("number");
    assertNoContact(res.payload);
    // El RPC recibe q vacio y la zona como filtro (no exige nombre).
    expect(calls.searchQueries[0]).toEqual({ query: "", zona: "Zona Sintetica Norte" });
  });

  it("busca SOLO por descripcion (sin nombre ni zona) y devuelve results", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: { tipo: "persona", target_descripcion: "camisa roja" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    // Sin nombre, el termino libre del RPC es la descripcion; sin zona, sin filtro.
    expect(calls.searchQueries[0]).toEqual({ query: "camisa roja" });
  });

  it("sin NINGUN criterio (solo tipo) no dispara busqueda: results vacio", async () => {
    // El guard de la busqueda guiada exige al menos un dato; aqui defendemos el
    // mismo contrato a nivel de API: sin criterio, no se recupera nada.
    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: { tipo: "persona" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().results).toEqual([]);
    expect(calls.searchQueries).toHaveLength(0);
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
