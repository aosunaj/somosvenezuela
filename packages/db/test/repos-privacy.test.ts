import { describe, expect, expectTypeOf, it } from "vitest";
import type { PublicPerson, PublicPet } from "core";
import type { DbClient } from "../src/client.js";
import {
  createPersonRepo,
  createPetRepo,
  type PublicPersonResult,
} from "../src/repos/index.js";
import type { PersonPublicRow, PetPublicRow } from "../src/types.js";

// Test de CONTRATO DE PRIVACIDAD (guardrail #1) sin BD real: un fake DbClient
// captura desde que RELACION se lee y devuelve filas controladas. Se verifica que
// los metodos publicos leen de las vistas *_public y NUNCA emiten contact_id.

const SYNTH_CONTACT = "c0000000-0000-4000-8000-000000000001";

const personPublicRow: PersonPublicRow = {
  id: "a0000000-0000-4000-8000-000000000001",
  nombre: "Persona de Prueba 1",
  apellidos: "Apellido Ficticio",
  edad: 34,
  zona: "Zona Sintetica Norte",
  descripcion: "Datos de prueba",
  foto_url: null,
  estado: "desaparecida",
  fuente: "propia",
  verificacion: "sin_verificar",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const petPublicRow: PetPublicRow = {
  id: "b0000000-0000-4000-8000-000000000001",
  nombre: "Mascota de Prueba 1",
  tipo: "perro",
  raza: "mestizo",
  zona: "Zona Sintetica Norte",
  foto_url: null,
  estado: "desaparecida",
  fuente: "propia",
  verificacion: "sin_verificar",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

interface ClientCalls {
  /** Relaciones (tablas/vistas) consultadas via .from(). */
  fromRelations: string[];
  /** Funciones RPC invocadas. */
  rpcNames: string[];
}

/**
 * Crea un fake DbClient con la cadena fluida minima de PostgREST que usan los
 * repos publicos. Devuelve siempre `rows` y registra las relaciones consultadas.
 */
function makeFakeClient(rows: unknown[], calls: ClientCalls): DbClient {
  // Builder que es thenable y soporta los metodos encadenados de los repos.
  const makeBuilder = (): Record<string, unknown> => {
    const result = { data: rows, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: () => builder,
      insert: () => builder,
      delete: () => builder,
      returns: () => builder,
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
    return builder;
  };

  const client = {
    from(relation: string) {
      calls.fromRelations.push(relation);
      return makeBuilder();
    },
    rpc(name: string) {
      calls.rpcNames.push(name);
      return makeBuilder();
    },
  };
  return client as unknown as DbClient;
}

describe("personRepo: lectura publica via vista, sin contacto", () => {
  it("listPublic lee de persons_public y no expone contact_id", async () => {
    const calls: ClientCalls = { fromRelations: [], rpcNames: [] };
    const repo = createPersonRepo(makeFakeClient([personPublicRow], calls));

    const result = await repo.listPublic();

    expect(calls.fromRelations).toContain("persons_public");
    // Nunca debe tocar la tabla base en lecturas publicas.
    expect(calls.fromRelations).not.toContain("persons");
    expect(result).toHaveLength(1);
    expect("contact_id" in (result[0] as object)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SYNTH_CONTACT);
  });

  it("getPublic lee de persons_public", async () => {
    const calls: ClientCalls = { fromRelations: [], rpcNames: [] };
    const repo = createPersonRepo(makeFakeClient([personPublicRow], calls));

    const result = await repo.getPublic(personPublicRow.id);

    expect(calls.fromRelations).toContain("persons_public");
    expect(calls.fromRelations).not.toContain("persons");
    expect(result).not.toBeNull();
    expect("contact_id" in (result as object)).toBe(false);
  });

  it("searchPersonsPublic invoca la RPC y devuelve score sin contacto", async () => {
    const calls: ClientCalls = { fromRelations: [], rpcNames: [] };
    const repo = createPersonRepo(makeFakeClient([{ ...personPublicRow, score: 0.87 }], calls));

    const result = await repo.searchPersonsPublic("prueba", "Zona Sintetica Norte");

    expect(calls.rpcNames).toContain("search_persons_public");
    expect(result[0]?.score).toBe(0.87);
    expect("contact_id" in (result[0] as object)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SYNTH_CONTACT);
  });
});

describe("petRepo: lectura publica via vista, sin contacto", () => {
  it("listPublic lee de pets_public y no expone contact_id", async () => {
    const calls: ClientCalls = { fromRelations: [], rpcNames: [] };
    const repo = createPetRepo(makeFakeClient([petPublicRow], calls));

    const result = await repo.listPublic();

    expect(calls.fromRelations).toContain("pets_public");
    expect(calls.fromRelations).not.toContain("pets");
    expect("contact_id" in (result[0] as object)).toBe(false);
  });
});

describe("contrato de TIPOS: el retorno publico no declara contact_id", () => {
  it("PublicPerson / PublicPet / PublicPersonResult no tienen la clave contact_id", () => {
    // Aserciones en tiempo de compilacion: si alguien reintroduce contact_id en el
    // tipo publico, el typecheck falla aqui.
    expectTypeOf<PublicPerson>().not.toHaveProperty("contact_id");
    expectTypeOf<PublicPet>().not.toHaveProperty("contact_id");
    expectTypeOf<PublicPersonResult>().not.toHaveProperty("contact_id");
    expectTypeOf<PublicPersonResult>().toHaveProperty("score");
  });
});
