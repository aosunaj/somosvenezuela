import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Pet, PublicPet } from "core";
import type { ChannelLinkRepo, PetRepo, PetSearchRepo, PublicPetResult } from "db";
import { errorHandler } from "../src/errors.js";
import { registerPetRoutes } from "../src/routes/pets.js";

// Pruebas de contrato de las rutas de mascotas con repos FALSOS (sin red ni
// Supabase). Verifican: forma de la respuesta y que el contacto NUNCA sale.

const NOW = "2026-06-28T12:00:00.000Z";

/** Mascota interna de ejemplo (incluye contact_id, que jamas debe salir). */
// UUIDs v4 validos (zod 4 z.uuid() exige version 1..8 y variante 8/9/a/b).
const PET_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const PET_CONTACT_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const PET_PUBLIC_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const LINKED_CONTACT_ID = "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80";
const LINKED_CHANNEL_ID = "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091";

function fakePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: PET_ID,
    nombre: "Firulais",
    tipo: "perro",
    raza: "mestizo",
    zona: "Petare",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    contact_id: PET_CONTACT_ID,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

/** Resultado publico de busqueda (sin contact_id) + score. */
function fakePublicPetResult(overrides: Partial<PublicPetResult> = {}): PublicPetResult {
  return {
    id: PET_PUBLIC_ID,
    nombre: "Michi",
    tipo: "gato",
    raza: null,
    zona: "Petare",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: NOW,
    updated_at: NOW,
    score: 0.87,
    ...overrides,
  };
}

interface EnsuredCall {
  plataforma: string;
  chatId: string;
  telefono?: string;
}

interface Fakes {
  petRepo: PetRepo;
  petSearchRepo: PetSearchRepo;
  channelLinkRepo: ChannelLinkRepo;
  created: Pet[];
  createdContactIds: Array<string | null | undefined>;
  ensured: EnsuredCall[];
  lastSearch: { query: string; zona?: string } | null;
}

function buildFakes(searchResults: PublicPetResult[]): Fakes {
  const fakes: Fakes = {
    created: [],
    createdContactIds: [],
    ensured: [],
    lastSearch: null,
    petRepo: {} as PetRepo,
    petSearchRepo: {} as PetSearchRepo,
    channelLinkRepo: {} as ChannelLinkRepo,
  };

  fakes.petRepo = {
    async create(input): Promise<Pet> {
      fakes.createdContactIds.push(input.contact_id);
      const pet = fakePet({
        nombre: input.nombre ?? null,
        tipo: input.tipo ?? null,
        raza: input.raza ?? null,
        zona: input.zona ?? null,
        contact_id: input.contact_id ?? null,
      });
      fakes.created.push(pet);
      return pet;
    },
    async listPublic(): Promise<PublicPet[]> {
      return [];
    },
    async getPublic(): Promise<PublicPet | null> {
      return null;
    },
    async remove(): Promise<void> {
      // no-op
    },
  };

  fakes.petSearchRepo = {
    async searchPetsPublic(query, zona): Promise<PublicPetResult[]> {
      fakes.lastSearch = zona === undefined ? { query } : { query, zona };
      return searchResults;
    },
  };

  fakes.channelLinkRepo = {
    async ensureChannel(input) {
      fakes.ensured.push({
        plataforma: input.plataforma,
        chatId: input.chatId,
        ...(input.telefono === undefined ? {} : { telefono: input.telefono }),
      });
      return { contactId: LINKED_CONTACT_ID, channelId: LINKED_CHANNEL_ID };
    },
    async findContactByChannel() {
      return null;
    },
  };

  return fakes;
}

async function buildTestApp(fakes: Fakes): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerPetRoutes(app, {
    petRepo: fakes.petRepo,
    petSearchRepo: fakes.petSearchRepo,
    channelLinkRepo: fakes.channelLinkRepo,
  });
  await app.ready();
  return app;
}

describe("POST /pets", () => {
  let fakes: Fakes;
  let app: FastifyInstance;

  beforeEach(async () => {
    fakes = buildFakes([]);
    app = await buildTestApp(fakes);
  });

  it("crea una mascota y responde 201 con solo el id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pets",
      payload: { nombre: "Firulais", tipo: "perro", zona: "Petare" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ id: fakes.created[0]?.id });
  });

  it("NUNCA expone contact_id en la respuesta de creacion", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pets",
      payload: { nombre: "Firulais", tipo: "perro" },
    });

    const body = res.json();
    expect(Object.keys(body)).toEqual(["id"]);
    expect(body).not.toHaveProperty("contact_id");
    expect(JSON.stringify(body)).not.toContain(PET_CONTACT_ID);
  });

  it("rechaza entrada invalida con 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pets",
      payload: { foto_url: "no-es-una-url" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("sin channel sigue funcionando y no crea contacto (contact_id null)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pets",
      payload: { nombre: "Firulais", tipo: "perro", zona: "Petare" },
    });

    expect(res.statusCode).toBe(201);
    expect(fakes.ensured).toHaveLength(0);
    expect(fakes.createdContactIds[0] ?? null).toBeNull();
  });

  it("con channel resuelve el contacto (ensureChannel) y crea la mascota linkeada", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pets",
      payload: {
        nombre: "Firulais",
        tipo: "perro",
        zona: "Petare",
        channel: { plataforma: "telegram", chatId: "tg-98765", telefono: "+580000000000" },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    // La respuesta sigue siendo SOLO el id (sin contacto ni canal, guardrail #1).
    expect(Object.keys(body)).toEqual(["id"]);

    // Se aseguro el vinculo con el canal recibido y la mascota se ligo al contacto.
    expect(fakes.ensured).toEqual([
      { plataforma: "telegram", chatId: "tg-98765", telefono: "+580000000000" },
    ]);
    expect(fakes.createdContactIds[0]).toBe(LINKED_CONTACT_ID);

    // PRIVACIDAD: ni el canal ni el contacto se filtran en la respuesta.
    const payload = res.payload;
    for (const forbidden of [
      "contact_id",
      "telefono",
      "chat_id",
      "chatId",
      LINKED_CONTACT_ID,
      "+580000000000",
      "tg-98765",
    ]) {
      expect(payload).not.toContain(forbidden);
    }
  });
});

describe("GET /search/pets", () => {
  it("devuelve { results } con score y sin contact_id", async () => {
    const fakes = buildFakes([fakePublicPetResult()]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({ method: "GET", url: "/search/pets?q=michi&zona=Petare" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<PublicPetResult> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.score).toBe(0.87);
    expect(body.results[0]).not.toHaveProperty("contact_id");
    expect(fakes.lastSearch).toEqual({ query: "michi", zona: "Petare" });
  });

  it("pasa la zona como opcional cuando no se envia", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({ method: "GET", url: "/search/pets?q=michi" });

    expect(res.statusCode).toBe(200);
    expect(fakes.lastSearch).toEqual({ query: "michi" });
  });

  it("rechaza busqueda sin termino (400)", async () => {
    const fakes = buildFakes([]);
    const app = await buildTestApp(fakes);

    const res = await app.inject({ method: "GET", url: "/search/pets" });

    expect(res.statusCode).toBe(400);
  });
});
