import { describe, expect, it } from "vitest";
import type { MatchCreate, MatchRepo, PersonRepo, PublicPersonResult } from "db";
import {
  MATCH_THRESHOLD,
  MATCH_TOP_N,
  runMatchingForSearch,
} from "../src/services/matching.js";

// Tests del servicio de matching con dobles PUROS (sin BD ni red). Datos SINTETICOS.
//
// GUARDRAILS verificados:
//   - #4: los matches se persisten como 'propuesto' (lo fija el repo/esquema) y el
//     servicio NUNCA notifica.
//   - #2: los candidatos llegan SOLO de searchPersonsPublic (vista publica, sin
//     menores); el servicio nunca toca la tabla base.

const SEARCH_ID = "d0000000-0000-4000-8000-000000000001";

function publicPerson(id: string, nombre: string, zona: string | null): PublicPersonResult {
  return {
    id,
    nombre,
    apellidos: null,
    edad: 30,
    zona,
    descripcion: null,
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    // El score de la RPC no se usa para persistir: el servicio re-rankea con el motor.
    score: 0.5,
  };
}

/** Doble de PersonRepo que devuelve un pool fijo desde searchPersonsPublic. */
function fakePersonRepo(
  pool: PublicPersonResult[],
  captured: Array<{ query: string; zona?: string }>,
): PersonRepo {
  return {
    async create() {
      throw new Error("no usado");
    },
    async listPublic() {
      return [];
    },
    async getPublic() {
      return null;
    },
    async searchPersonsPublic(query, zona) {
      captured.push(zona === undefined ? { query } : { query, zona });
      return pool;
    },
    async remove() {
      /* no-op */
    },
    async markFound() {
      /* no-op */
    },
    async listByContact() {
      return [];
    },
  };
}

/** Doble de MatchRepo que captura los matches creados. */
function fakeMatchRepo(created: MatchCreate[]): MatchRepo {
  return {
    async create(input) {
      created.push(input);
      return {
        id: `match-${created.length}`,
        search_id: input.search_id,
        person_id: input.person_id ?? null,
        pet_id: input.pet_id ?? null,
        score: input.score,
        metodo: input.metodo,
        estado_revision: "propuesto",
        revisado_por: null,
        created_at: "2026-01-01T00:00:00.000Z",
      };
    },
    async listPendingWithContext() {
      return [];
    },
    async getById() {
      return null;
    },
    async setEstadoRevision() {
      /* no-op */
    },
    async getConfirmContext() {
      return null;
    },
  };
}

describe("runMatchingForSearch", () => {
  it("no corre si el nombre objetivo esta vacio", async () => {
    const created: MatchCreate[] = [];
    const captured: Array<{ query: string; zona?: string }> = [];
    const result = await runMatchingForSearch(
      { personRepo: fakePersonRepo([], captured), matchRepo: fakeMatchRepo(created) },
      SEARCH_ID,
      { nombre: "   " },
    );
    expect(result.created).toBe(0);
    expect(captured).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("no corre si la query no trae NINGUN criterio (nombre/zona/descripcion vacios)", async () => {
    const created: MatchCreate[] = [];
    const captured: Array<{ query: string; zona?: string }> = [];
    const result = await runMatchingForSearch(
      { personRepo: fakePersonRepo([], captured), matchRepo: fakeMatchRepo(created) },
      SEARCH_ID,
      { nombre: "  ", zona: "", descripcion: "   " },
    );
    expect(result.created).toBe(0);
    expect(captured).toHaveLength(0);
  });

  it("corre SOLO con zona: recupera el pool con q vacio y la zona como filtro", async () => {
    const created: MatchCreate[] = [];
    const captured: Array<{ query: string; zona?: string }> = [];
    // Candidato cuya zona coincide plenamente: re-rankea alto pese a no haber nombre.
    const pool = [publicPerson("a1", "Pedro Lopez", "La Guaira")];

    const result = await runMatchingForSearch(
      { personRepo: fakePersonRepo(pool, captured), matchRepo: fakeMatchRepo(created) },
      SEARCH_ID,
      { zona: "La Guaira" },
    );

    // Sin nombre, el termino libre del RPC es "" y la zona viaja como filtro.
    expect(captured[0]).toEqual({ query: "", zona: "La Guaira" });
    expect(result.created).toBe(1);
    expect(created[0]?.person_id).toBe("a1");
    // Zona plena, unico campo provisto -> score 1, metodo no 'exacto' (sin nombre).
    expect(created[0]?.score).toBe(1);
    expect(created[0]?.metodo).not.toBe("exacto");
  });

  it("corre SOLO con descripcion: usa las senas como termino libre del RPC", async () => {
    const created: MatchCreate[] = [];
    const captured: Array<{ query: string; zona?: string }> = [];
    const pool = [
      {
        ...publicPerson("a1", "Persona", null),
        descripcion: "camisa roja y gorra azul",
      },
    ];

    const result = await runMatchingForSearch(
      { personRepo: fakePersonRepo(pool, captured), matchRepo: fakeMatchRepo(created) },
      SEARCH_ID,
      { descripcion: "camisa roja y gorra azul" },
    );

    // El termino libre es la descripcion (no hay nombre); sin zona, no se filtra.
    expect(captured[0]).toEqual({ query: "camisa roja y gorra azul" });
    expect(result.created).toBe(1);
    expect(created[0]?.person_id).toBe("a1");
  });

  it("persiste como match el candidato que coincide exactamente (score=1, 'propuesto')", async () => {
    const created: MatchCreate[] = [];
    const captured: Array<{ query: string; zona?: string }> = [];
    const pool = [publicPerson("a1", "Maria Lopez", "Zona Norte")];

    const result = await runMatchingForSearch(
      { personRepo: fakePersonRepo(pool, captured), matchRepo: fakeMatchRepo(created) },
      SEARCH_ID,
      { nombre: "Maria Lopez", zona: "Zona Norte" },
    );

    expect(result.created).toBe(1);
    // La zona se reenvia al pool publico como filtro.
    expect(captured[0]).toEqual({ query: "Maria Lopez", zona: "Zona Norte" });
    expect(created).toHaveLength(1);
    expect(created[0]?.search_id).toBe(SEARCH_ID);
    expect(created[0]?.person_id).toBe("a1");
    expect(created[0]?.metodo).toBe("exacto");
    expect(created[0]?.score).toBe(1);
  });

  it("descarta candidatos por debajo del umbral", async () => {
    const created: MatchCreate[] = [];
    const captured: Array<{ query: string; zona?: string }> = [];
    // Nombre totalmente distinto: el score local cae por debajo del umbral.
    const pool = [publicPerson("a1", "Zzzzz Qqqqq", "Otra Zona")];

    const result = await runMatchingForSearch(
      { personRepo: fakePersonRepo(pool, captured), matchRepo: fakeMatchRepo(created) },
      SEARCH_ID,
      { nombre: "Maria Lopez" },
    );

    expect(result.created).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("respeta el umbral y top-N configurables", async () => {
    const created: MatchCreate[] = [];
    const captured: Array<{ query: string; zona?: string }> = [];
    // Tres candidatos identicos al objetivo (todos score=1 'exacto').
    const pool = [
      publicPerson("a1", "Maria Lopez", null),
      publicPerson("a2", "Maria Lopez", null),
      publicPerson("a3", "Maria Lopez", null),
    ];

    const result = await runMatchingForSearch(
      { personRepo: fakePersonRepo(pool, captured), matchRepo: fakeMatchRepo(created) },
      SEARCH_ID,
      { nombre: "Maria Lopez" },
      { topN: 2 },
    );

    expect(result.created).toBe(2);
    expect(created).toHaveLength(2);
  });

  it("expone defaults de umbral y top-N coherentes", () => {
    expect(MATCH_THRESHOLD).toBeGreaterThan(0);
    expect(MATCH_THRESHOLD).toBeLessThan(1);
    expect(MATCH_TOP_N).toBeGreaterThan(0);
  });
});
