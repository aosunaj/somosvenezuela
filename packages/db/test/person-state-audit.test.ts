import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/client.js";
import { createPersonStateAuditRepo } from "../src/repos/person-state-audit.js";

// Test de PersonStateAuditRepo.record (auditoria de cambios de estado, guardrail #8)
// con un fake DbClient PROPIO. Verifica que inserta UNA fila en person_state_changes
// con person_id, estado_nuevo y changed_by_contact_id correctos, y que NO fija
// changed_at (lo pone el DEFAULT now() de la BD). Datos SINTETICOS.

const PERSON_ID = "a0000000-0000-4000-8000-000000000001";
const OWNER_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";

interface Captured {
  /** Relaciones tocadas via .from(). */
  fromRelations: string[];
  /** Payloads recibidos por .insert(). */
  inserts: Array<Record<string, unknown>>;
}

interface FakeClientOptions {
  readonly error?: { message: string; code?: string } | null;
}

/**
 * Fake DbClient parametrizable: captura el insert de la auditoria. La cadena
 * `insert()` es thenable para resolver sin BD real.
 */
function makeFakeClient(captured: Captured, options: FakeClientOptions = {}): DbClient {
  const error = options.error ?? null;

  const makeBuilder = (): Record<string, unknown> => {
    const result = { data: null, error };
    const builder: Record<string, unknown> = {
      insert: (values: Record<string, unknown>) => {
        captured.inserts.push(values);
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
  return { fromRelations: [], inserts: [] };
}

describe("personStateAuditRepo.record (auditoria de estado, guardrail #8)", () => {
  it("inserta UNA fila en person_state_changes con persona, estado nuevo y autor", async () => {
    const captured = makeCaptured();
    const repo = createPersonStateAuditRepo(makeFakeClient(captured));

    await repo.record({
      personId: PERSON_ID,
      estadoNuevo: "encontrada_viva",
      changedByContactId: OWNER_CONTACT_ID,
    });

    // Escribe en la tabla de auditoria.
    expect(captured.fromRelations).toEqual(["person_state_changes"]);
    // Exactamente un insert con los campos correctos.
    expect(captured.inserts).toHaveLength(1);
    const row = captured.inserts[0];
    expect(row?.["person_id"]).toBe(PERSON_ID);
    expect(row?.["estado_nuevo"]).toBe("encontrada_viva");
    expect(row?.["changed_by_contact_id"]).toBe(OWNER_CONTACT_ID);
    // estado_anterior por defecto null (no se leyo en este flujo).
    expect(row?.["estado_anterior"]).toBeNull();
    // changed_at NO se envia: lo fija el DEFAULT now() de la BD (quien + CUANDO).
    expect(row).not.toHaveProperty("changed_at");
  });

  it("deja changed_by_contact_id null cuando no se conoce el autor", async () => {
    const captured = makeCaptured();
    const repo = createPersonStateAuditRepo(makeFakeClient(captured));

    await repo.record({ personId: PERSON_ID, estadoNuevo: "reunida" });

    expect(captured.inserts[0]?.["changed_by_contact_id"]).toBeNull();
  });

  it("propaga un DbError si el insert falla", async () => {
    const captured = makeCaptured();
    const repo = createPersonStateAuditRepo(
      makeFakeClient(captured, { error: { message: "fallo sintetico", code: "X" } }),
    );

    await expect(
      repo.record({ personId: PERSON_ID, estadoNuevo: "encontrada_viva" }),
    ).rejects.toThrow();
  });
});
