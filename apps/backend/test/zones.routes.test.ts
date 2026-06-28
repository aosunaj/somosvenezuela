import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { PublicZone, ZoneCreate, ZoneRepo } from "db";
import { errorHandler } from "../src/errors.js";
import { registerZoneRoutes } from "../src/routes/zones.js";

// Pruebas de contrato de las rutas de zonas con repo FALSO.

const NOW = "2026-06-28T12:00:00.000Z";
const SERVICE_TOKEN = "test-service-token";
// UUID v4 valido (zod 4 z.uuid() exige version 1..8 y variante 8/9/a/b).
const ZONE_ID = "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f70";

function fakeZone(overrides: Partial<PublicZone> = {}): PublicZone {
  return {
    id: ZONE_ID,
    nombre: "Petare",
    lat: 10.49,
    lng: -66.81,
    estado: "afectada",
    updated_at: NOW,
    ...overrides,
  };
}

interface Fakes {
  zoneRepo: ZoneRepo;
  created: ZoneCreate[];
}

function buildFakes(zones: PublicZone[]): Fakes {
  const fakes: Fakes = { created: [], zoneRepo: {} as ZoneRepo };
  fakes.zoneRepo = {
    async listPublic(): Promise<PublicZone[]> {
      return zones;
    },
    async create(input): Promise<PublicZone> {
      fakes.created.push(input);
      return fakeZone({ nombre: input.nombre });
    },
  };
  return fakes;
}

async function buildTestApp(
  fakes: Fakes,
  serviceToken: string | undefined = SERVICE_TOKEN,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerZoneRoutes(app, { zoneRepo: fakes.zoneRepo, serviceToken });
  await app.ready();
  return app;
}

describe("GET /zones", () => {
  it("devuelve { zones } con la forma publica", async () => {
    const fakes = buildFakes([fakeZone()]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({ method: "GET", url: "/zones" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { zones: PublicZone[] };
    expect(body.zones).toHaveLength(1);
    expect(body.zones[0]).toMatchObject({ id: fakeZone().id, nombre: "Petare" });
    // La vista publica no expone actualizado_por (identidad del voluntario).
    expect(body.zones[0]).not.toHaveProperty("actualizado_por");
  });
});

describe("POST /zones", () => {
  it("crea una zona con token de servicio valido (201)", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({
      method: "POST",
      url: "/zones",
      headers: { "x-service-token": SERVICE_TOKEN },
      payload: { nombre: "Petare", lat: 10.49, lng: -66.81, estado: "afectada" },
    });

    expect(res.statusCode).toBe(201);
    expect(fakes.created).toHaveLength(1);
    const body = res.json() as PublicZone;
    expect(body).not.toHaveProperty("actualizado_por");
  });

  it("rechaza sin token (401) y no crea", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({
      method: "POST",
      url: "/zones",
      payload: { nombre: "Petare" },
    });

    expect(res.statusCode).toBe(401);
    expect(fakes.created).toHaveLength(0);
  });

  it("rechaza con token incorrecto (401)", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({
      method: "POST",
      url: "/zones",
      headers: { "x-service-token": "wrong" },
      payload: { nombre: "Petare" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rechaza cuando no hay secreto configurado (401)", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes, undefined);

    const res = await app.inject({
      method: "POST",
      url: "/zones",
      headers: { "x-service-token": "cualquier-cosa" },
      payload: { nombre: "Petare" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rechaza entrada invalida con 400 (token valido)", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({
      method: "POST",
      url: "/zones",
      headers: { "x-service-token": SERVICE_TOKEN },
      payload: { nombre: "" },
    });

    expect(res.statusCode).toBe(400);
  });
});
