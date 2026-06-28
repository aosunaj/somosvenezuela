import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { NeedCreate, NeedRepo, PublicNeed } from "db";
import { errorHandler } from "../src/errors.js";
import { registerNeedRoutes } from "../src/routes/needs.js";

// Pruebas de contrato de las rutas de necesidades con repo FALSO.

const NOW = "2026-06-28T12:00:00.000Z";
const SERVICE_TOKEN = "test-service-token";
// UUIDs v4 validos (zod 4 z.uuid() exige version 1..8 y variante 8/9/a/b).
const ZONE_ID = "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f70";
const NEED_ID = "e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7081";

function fakeNeed(overrides: Partial<PublicNeed> = {}): PublicNeed {
  return {
    id: NEED_ID,
    zone_id: ZONE_ID,
    tipo: "agua",
    urgencia: "alta",
    descripcion: "Faltan garrafas de agua potable",
    updated_at: NOW,
    ...overrides,
  };
}

interface Fakes {
  needRepo: NeedRepo;
  created: NeedCreate[];
  lastZoneFilter: string | undefined | "UNSET";
}

function buildFakes(needs: PublicNeed[]): Fakes {
  const fakes: Fakes = { created: [], lastZoneFilter: "UNSET", needRepo: {} as NeedRepo };
  fakes.needRepo = {
    async listPublicByZone(zoneId): Promise<PublicNeed[]> {
      fakes.lastZoneFilter = zoneId;
      return needs;
    },
    async create(input): Promise<PublicNeed> {
      fakes.created.push(input);
      return fakeNeed({ tipo: input.tipo, urgencia: input.urgencia, zone_id: input.zone_id });
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
  registerNeedRoutes(app, { needRepo: fakes.needRepo, serviceToken });
  await app.ready();
  return app;
}

describe("GET /needs", () => {
  it("devuelve { needs } con la forma publica", async () => {
    const fakes = buildFakes([fakeNeed()]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({ method: "GET", url: "/needs" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { needs: PublicNeed[] };
    expect(body.needs).toHaveLength(1);
    expect(body.needs[0]).toMatchObject({ zone_id: ZONE_ID, urgencia: "alta" });
    expect(fakes.lastZoneFilter).toBeUndefined();
  });

  it("propaga el filtro zoneId al repo", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({ method: "GET", url: `/needs?zoneId=${ZONE_ID}` });

    expect(res.statusCode).toBe(200);
    expect(fakes.lastZoneFilter).toBe(ZONE_ID);
  });

  it("rechaza zoneId que no es uuid (400)", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({ method: "GET", url: "/needs?zoneId=no-uuid" });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /needs", () => {
  it("crea una necesidad con token valido (201)", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({
      method: "POST",
      url: "/needs",
      headers: { "x-service-token": SERVICE_TOKEN },
      payload: { zone_id: ZONE_ID, tipo: "agua", urgencia: "critica" },
    });

    expect(res.statusCode).toBe(201);
    expect(fakes.created).toHaveLength(1);
  });

  it("rechaza sin token (401) y no crea", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({
      method: "POST",
      url: "/needs",
      payload: { zone_id: ZONE_ID, tipo: "agua", urgencia: "alta" },
    });

    expect(res.statusCode).toBe(401);
    expect(fakes.created).toHaveLength(0);
  });

  it("rechaza urgencia invalida con 400 (token valido)", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({
      method: "POST",
      url: "/needs",
      headers: { "x-service-token": SERVICE_TOKEN },
      payload: { zone_id: ZONE_ID, tipo: "agua", urgencia: "altisima" },
    });

    expect(res.statusCode).toBe(400);
  });
});
