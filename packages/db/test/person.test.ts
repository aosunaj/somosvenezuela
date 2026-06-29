import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/client.js";
import { createPersonRepo } from "../src/repos/person.js";

// Test de markFound (rescatado por el dueno) con un fake DbClient PROPIO.
// Verifica que el UPDATE fija estado='encontrada_viva' y verificacion='sin_verificar'
// (NUNCA 'verificada', guardrail #4) sobre la persona correcta. Datos SINTETICOS.

const PERSON_ID = "a0000000-0000-4000-8000-000000000001";

interface Captured {
  /** Relaciones tocadas via .from(). */
  fromRelations: string[];
  /** Payloads recibidos por .update(). */
  updates: Array<Record<string, unknown>>;
  /** Filtros .eq() aplicados (columna, valor). */
  filters: Array<{ column: string; value: unknown }>;
}

/**
 * Fake DbClient parametrizable: captura el update y el filtro de markFound. La
 * cadena fluida es thenable para resolver `update().eq()` sin BD real.
 */
function makeFakeClient(captured: Captured, error: { message: string; code?: string } | null = null): DbClient {
  const makeBuilder = (): Record<string, unknown> => {
    const result = { data: null, error };
    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (values: Record<string, unknown>) => {
        captured.updates.push(values);
        return builder;
      },
      eq: (column: string, value: unknown) => {
        captured.filters.push({ column, value });
        return builder;
      },
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
  return { fromRelations: [], updates: [], filters: [] };
}

describe("personRepo.markFound (rescatado por el dueno)", () => {
  it("actualiza persons fijando encontrada_viva + sin_verificar para la persona dada", async () => {
    const captured = makeCaptured();
    const repo = createPersonRepo(makeFakeClient(captured));

    await repo.markFound(PERSON_ID);

    // Escribe en la tabla base persons (no en la vista publica).
    expect(captured.fromRelations).toContain("persons");
    // El UPDATE fija exactamente el estado de rescatado, SIN verificar.
    expect(captured.updates).toEqual([
      { estado: "encontrada_viva", verificacion: "sin_verificar" },
    ]);
    // Aplica el filtro por id de la persona correcta.
    expect(captured.filters).toEqual([{ column: "id", value: PERSON_ID }]);
  });

  it("NUNCA marca 'verificada' (guardrail #4: el reporte del dueno solo sugiere)", async () => {
    const captured = makeCaptured();
    const repo = createPersonRepo(makeFakeClient(captured));

    await repo.markFound(PERSON_ID);

    expect(captured.updates[0]?.["verificacion"]).not.toBe("verificada");
  });

  it("propaga un DbError si el UPDATE falla", async () => {
    const captured = makeCaptured();
    const repo = createPersonRepo(makeFakeClient(captured, { message: "fallo sintetico", code: "X" }));

    await expect(repo.markFound(PERSON_ID)).rejects.toThrow();
  });
});
