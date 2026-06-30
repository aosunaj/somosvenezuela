import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/client.js";
import { createPersonRepo } from "../src/repos/person.js";

// Test de markFound (rescatado por el dueno) con un fake DbClient PROPIO.
// Verifica que el UPDATE fija estado='encontrada_viva' y verificacion='sin_verificar'
// (NUNCA 'verificada', guardrail #4) sobre la persona correcta, registra updated_at
// y exige que el UPDATE afecte una fila (TOCTOU). Datos SINTETICOS.

const PERSON_ID = "a0000000-0000-4000-8000-000000000001";

interface Captured {
  /** Relaciones tocadas via .from(). */
  fromRelations: string[];
  /** Payloads recibidos por .update(). */
  updates: Array<Record<string, unknown>>;
  /** Filtros .eq() aplicados (columna, valor). */
  filters: Array<{ column: string; value: unknown }>;
  /** Argumentos pasados a .select() (cadena de columnas), para auditar la proyeccion. */
  selects: string[];
}

interface FakeClientOptions {
  /** Error a devolver por la cadena (null = sin error). */
  readonly error?: { message: string; code?: string } | null;
  /** Filas afectadas que devuelve .select() tras el update (camino feliz: 1 fila). */
  readonly rows?: unknown[];
}

/**
 * Fake DbClient parametrizable: captura el update y el filtro de markFound. La
 * cadena fluida es thenable para resolver `update().eq().select()` sin BD real.
 * `rows` simula las filas afectadas que devuelve PostgREST con .select().
 */
function makeFakeClient(captured: Captured, options: FakeClientOptions = {}): DbClient {
  const error = options.error ?? null;
  // Por defecto, una fila afectada (camino feliz). Tests de cero filas pasan rows: [].
  const rows = options.rows ?? [{ id: PERSON_ID }];

  const makeBuilder = (): Record<string, unknown> => {
    const result = { data: rows, error };
    const builder: Record<string, unknown> = {
      select: (columns?: string) => {
        if (typeof columns === "string") captured.selects.push(columns);
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        captured.updates.push(values);
        return builder;
      },
      eq: (column: string, value: unknown) => {
        captured.filters.push({ column, value });
        return builder;
      },
      // Cadena de lectura de listByContact: order().limit().returns() son fluidos.
      order: () => builder,
      limit: () => builder,
      returns: () => builder,
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
    return builder;
  };

  const client = {
    from(relation: string) {
      captured.fromRelations.push(relation);
      return makeBuilder();
    },
  };
  return client as unknown as DbClient;
}

function makeCaptured(): Captured {
  return { fromRelations: [], updates: [], filters: [], selects: [] };
}

describe("personRepo.markFound (rescatado por el dueno)", () => {
  it("actualiza persons fijando encontrada_viva + sin_verificar y registra updated_at", async () => {
    const captured = makeCaptured();
    const repo = createPersonRepo(makeFakeClient(captured));

    await repo.markFound(PERSON_ID);

    // Escribe en la tabla base persons (no en la vista publica).
    expect(captured.fromRelations).toContain("persons");
    // El UPDATE fija exactamente el estado de rescatado, SIN verificar.
    const update = captured.updates[0];
    expect(update?.["estado"]).toBe("encontrada_viva");
    expect(update?.["verificacion"]).toBe("sin_verificar");
    // Deja rastro de CUANDO se marco (guardrail #8): updated_at ISO presente.
    expect(typeof update?.["updated_at"]).toBe("string");
    expect(update?.["updated_at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Aplica el filtro por id de la persona correcta.
    expect(captured.filters).toEqual([{ column: "id", value: PERSON_ID }]);
  });

  it("NUNCA marca 'verificada' (guardrail #4: el reporte del dueno solo sugiere)", async () => {
    const captured = makeCaptured();
    const repo = createPersonRepo(makeFakeClient(captured));

    await repo.markFound(PERSON_ID);

    expect(captured.updates[0]?.["verificacion"]).not.toBe("verificada");
  });

  it("lanza DbError si el UPDATE no afecta ninguna fila (persona borrada, TOCTOU)", async () => {
    const captured = makeCaptured();
    const repo = createPersonRepo(makeFakeClient(captured, { rows: [] }));

    await expect(repo.markFound(PERSON_ID)).rejects.toThrow();
  });

  it("propaga un DbError si el UPDATE falla", async () => {
    const captured = makeCaptured();
    const repo = createPersonRepo(
      makeFakeClient(captured, { error: { message: "fallo sintetico", code: "X" } }),
    );

    await expect(repo.markFound(PERSON_ID)).rejects.toThrow();
  });
});

// listByContact alimenta "mis registros" del bot (marcar/borrar sin codigos). Es del
// DUENO: lee la tabla base (puede incluir menores) PERO solo debe proyectar columnas
// no sensibles. Este test fija la proyeccion como contrato (guardrail #1: jamas
// contact_id) y verifica el filtro por contacto y la salida sin contacto.
const CONTACT_ID = "c0000000-0000-4000-8000-000000000001";

describe("personRepo.listByContact (lista del dueno, sin contacto)", () => {
  it("lee persons filtrando por contact_id y proyecta SOLO columnas no sensibles", async () => {
    const captured = makeCaptured();
    // El fake devuelve una fila CONTAMINADA con contact_id para probar que ni la
    // proyeccion ni el mapeo lo dejan salir.
    const repo = createPersonRepo(
      makeFakeClient(captured, {
        rows: [
          {
            id: PERSON_ID,
            nombre: "Persona Sintetica",
            apellidos: null,
            zona: "Zona Norte",
            estado: "desaparecida",
            contact_id: CONTACT_ID,
          },
        ],
      }),
    );

    const result = await repo.listByContact(CONTACT_ID);

    // Lee la tabla base persons (no la vista publica).
    expect(captured.fromRelations).toContain("persons");
    // Filtra por el contacto dueno.
    expect(captured.filters).toEqual([{ column: "contact_id", value: CONTACT_ID }]);
    // La proyeccion NUNCA pide contact_id (guardrail #1) y trae las 5 columnas esperadas.
    const projection = captured.selects.join(" ");
    expect(projection).not.toContain("contact_id");
    for (const col of ["id", "nombre", "apellidos", "zona", "estado"]) {
      expect(projection).toContain(col);
    }
    // La salida es la vista del dueno, sin contacto, aunque la fila viniera contaminada.
    expect(result).toEqual([
      {
        id: PERSON_ID,
        nombre: "Persona Sintetica",
        apellidos: null,
        zona: "Zona Norte",
        estado: "desaparecida",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(CONTACT_ID);
    expect(JSON.stringify(result)).not.toContain("contact_id");
  });

  it("devuelve lista vacia cuando el contacto no tiene registros", async () => {
    const captured = makeCaptured();
    const repo = createPersonRepo(makeFakeClient(captured, { rows: [] }));

    expect(await repo.listByContact(CONTACT_ID)).toEqual([]);
  });
});
