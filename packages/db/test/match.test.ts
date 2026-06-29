import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/client.js";
import { createMatchRepo } from "../src/repos/match.js";
import type { MatchRow, PersonPublicRow } from "../src/types.js";

// Tests de matchRepo con un fake DbClient PROPIO (no toca BD). Datos SINTETICOS.
//
// GUARDRAILS verificados:
//   - #1: listPendingWithContext lee el candidato de persons_public (sin
//     contact_id); getConfirmContext expone buscador_contact_id SOLO al backend.
//   - #2: el candidato sale de persons_public (sin menores), nunca de persons.
//   - #4: create persiste con estado_revision='propuesto' (DEFAULT del esquema).

const SEARCH_ID = "d0000000-0000-4000-8000-000000000001";
const PERSON_ID = "a0000000-0000-4000-8000-000000000001";
const MATCH_ID = "b0000000-0000-4000-8000-000000000001";
const CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "e0000000-0000-4000-8000-000000000001";

interface Capture {
  fromRelations: string[];
  inserts: Array<{ relation: string; values: Record<string, unknown> }>;
  updates: Array<{ relation: string; values: Record<string, unknown>; id: string }>;
}

const personPublicRow: PersonPublicRow = {
  id: PERSON_ID,
  nombre: "Persona Sintetica",
  apellidos: "Apellido Ficticio",
  edad: 30,
  zona: "Zona Norte",
  descripcion: "Datos de prueba",
  foto_url: null,
  estado: "desaparecida",
  fuente: "propia",
  verificacion: "sin_verificar",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

/**
 * Fake DbClient enrutado por relacion. Soporta:
 *   - matches: insert+single, select+eq(estado_revision)+order+limit, select+eq(id)+maybeSingle, update+eq(id)
 *   - searches: select+eq(id)+maybeSingle (contexto + buscador_contact_id)
 *   - persons_public: select+eq(id)+maybeSingle (candidato publico)
 *   - channels: select+eq(contact_id)+eq(opt_in)+order+limit+maybeSingle
 */
function makeFakeClient(
  matchRow: MatchRow | null,
  capture: Capture,
): DbClient {
  const makeBuilder = (relation: string): Record<string, unknown> => {
    let mode: "select" | "insert" | "update" = "select";
    let insertValues: Record<string, unknown> | null = null;
    let updateValues: Record<string, unknown> | null = null;
    let idFilter: string | null = null;
    let selectedColumns: string[] | null = null;

    // Fila "completa" por relacion. El fake PROYECTA segun .select() para reflejar
    // PostgREST: una consulta solo devuelve las columnas pedidas (asi una columna
    // SENSIBLE no aparece si el repo no la selecciono).
    const fullRow = (): Record<string, unknown> | null => {
      if (relation === "matches") {
        return matchRow as unknown as Record<string, unknown> | null;
      }
      if (relation === "searches") {
        return { target_nombre: "Persona Buscada", zona: "Zona Norte", buscador_contact_id: CONTACT_ID };
      }
      if (relation === "persons_public") {
        return personPublicRow as unknown as Record<string, unknown>;
      }
      if (relation === "channels") return { id: CHANNEL_ID };
      return null;
    };

    const resolveSelectRow = (): unknown => {
      const row = fullRow();
      if (row === null) return null;
      // Si el repo selecciono columnas concretas (no "*"), proyecta solo esas.
      if (selectedColumns === null || selectedColumns.includes("*")) return row;
      const projected: Record<string, unknown> = {};
      for (const col of selectedColumns) {
        if (col in row) projected[col] = row[col];
      }
      return projected;
    };

    const builder: Record<string, unknown> = {
      select: (columns?: string) => {
        if (typeof columns === "string") {
          selectedColumns = columns.split(",").map((c) => c.trim());
        }
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (values: Record<string, unknown>) => {
        mode = "insert";
        insertValues = values;
        capture.inserts.push({ relation, values });
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        mode = "update";
        updateValues = values;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        if (column === "id") idFilter = value as string;
        if (mode === "update" && idFilter !== null && updateValues !== null) {
          capture.updates.push({ relation, values: updateValues, id: idFilter });
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      returns: () => Promise.resolve({ data: matchRow ? [matchRow] : [], error: null }),
      single: () => {
        const row: MatchRow = {
          id: MATCH_ID,
          search_id: (insertValues?.["search_id"] as string | null) ?? null,
          person_id: (insertValues?.["person_id"] as string | null) ?? null,
          pet_id: (insertValues?.["pet_id"] as string | null) ?? null,
          score: (insertValues?.["score"] as number) ?? 0,
          metodo: (insertValues?.["metodo"] as MatchRow["metodo"]) ?? "trigram",
          // El DEFAULT del esquema fija 'propuesto'; el fake lo refleja.
          estado_revision: "propuesto",
          revisado_por: null,
          created_at: "2026-01-01T00:00:00.000Z",
        };
        return Promise.resolve({ data: row, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: resolveSelectRow(), error: null }),
    };
    return builder;
  };

  const client = {
    from(relation: string) {
      capture.fromRelations.push(relation);
      return makeBuilder(relation);
    },
  };
  return client as unknown as DbClient;
}

function emptyCapture(): Capture {
  return { fromRelations: [], inserts: [], updates: [] };
}

const baseMatchRow: MatchRow = {
  id: MATCH_ID,
  search_id: SEARCH_ID,
  person_id: PERSON_ID,
  pet_id: null,
  score: 0.87,
  metodo: "trigram",
  estado_revision: "propuesto",
  revisado_por: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("matchRepo.create", () => {
  it("inserta en 'matches' y nace 'propuesto' (la IA sugiere, los humanos confirman)", async () => {
    const capture = emptyCapture();
    const repo = createMatchRepo(makeFakeClient(null, capture));

    const created = await repo.create({
      search_id: SEARCH_ID,
      person_id: PERSON_ID,
      score: 0.87,
      metodo: "trigram",
    });

    expect(capture.fromRelations).toContain("matches");
    expect(created.estado_revision).toBe("propuesto");
    expect(created.person_id).toBe(PERSON_ID);
    expect(created.score).toBe(0.87);
    // El insert NO fija estado_revision: lo deja al DEFAULT del esquema.
    expect(capture.inserts[0]?.values).not.toHaveProperty("estado_revision");
  });

  it("rechaza score fuera de [0,1] (zod)", async () => {
    const repo = createMatchRepo(makeFakeClient(null, emptyCapture()));
    await expect(
      repo.create({ search_id: SEARCH_ID, person_id: PERSON_ID, score: 1.5, metodo: "trigram" }),
    ).rejects.toThrow();
  });
});

describe("matchRepo.setEstadoRevision", () => {
  it("actualiza estado y revisado_por sobre 'matches'", async () => {
    const capture = emptyCapture();
    const repo = createMatchRepo(makeFakeClient(baseMatchRow, capture));

    await repo.setEstadoRevision(MATCH_ID, "confirmado", "operador-1");

    expect(capture.updates).toHaveLength(1);
    expect(capture.updates[0]?.relation).toBe("matches");
    expect(capture.updates[0]?.values).toEqual({
      estado_revision: "confirmado",
      revisado_por: "operador-1",
    });
    expect(capture.updates[0]?.id).toBe(MATCH_ID);
  });

  it("descarta sin revisor (no incluye revisado_por)", async () => {
    const capture = emptyCapture();
    const repo = createMatchRepo(makeFakeClient(baseMatchRow, capture));

    await repo.setEstadoRevision(MATCH_ID, "descartado");

    expect(capture.updates[0]?.values).toEqual({ estado_revision: "descartado" });
  });
});

describe("matchRepo.listPendingWithContext", () => {
  it("lee el candidato de persons_public (sin contact_id) y la busqueda sin buscador", async () => {
    const capture = emptyCapture();
    const repo = createMatchRepo(makeFakeClient(baseMatchRow, capture));

    const result = await repo.listPendingWithContext();

    expect(result).toHaveLength(1);
    expect(capture.fromRelations).toContain("matches");
    // GUARDRAIL #2: candidato de la vista publica, NUNCA de la tabla base.
    expect(capture.fromRelations).toContain("persons_public");
    expect(capture.fromRelations).not.toContain("persons");
    const m = result[0];
    expect(m?.candidate?.nombre).toBe("Persona Sintetica");
    expect(m?.search.target_nombre).toBe("Persona Buscada");
    // GUARDRAIL #1: ni contact_id ni buscador en el contexto de revision.
    const json = JSON.stringify(result);
    expect(json).not.toContain("contact_id");
    expect(json).not.toContain("buscador_contact_id");
    expect(json).not.toContain(CONTACT_ID);
  });
});

describe("matchRepo.getConfirmContext", () => {
  it("resuelve buscador_contact_id (SENSIBLE, solo backend) y su canal preferente", async () => {
    const capture = emptyCapture();
    const repo = createMatchRepo(makeFakeClient(baseMatchRow, capture));

    const ctx = await repo.getConfirmContext(MATCH_ID);

    expect(ctx).not.toBeNull();
    expect(ctx?.buscadorContactId).toBe(CONTACT_ID);
    expect(ctx?.channelId).toBe(CHANNEL_ID);
    expect(ctx?.searchId).toBe(SEARCH_ID);
    expect(ctx?.personId).toBe(PERSON_ID);
  });

  it("devuelve null si el match no existe", async () => {
    const repo = createMatchRepo(makeFakeClient(null, emptyCapture()));
    const ctx = await repo.getConfirmContext(MATCH_ID);
    expect(ctx).toBeNull();
  });
});
