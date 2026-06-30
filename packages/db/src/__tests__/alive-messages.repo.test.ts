import { describe, expect, it } from "vitest";
import type { DbClient } from "../client.js";
import { createAliveMessagesRepo } from "../repos/alive-messages.js";

// Tests TDD para AliveMessagesRepo (Spec 06, Slice 1).
// Usa fakes de DbClient — sin BD real. Datos 100% sintéticos (guardrail: sin PII).

const SYNTH_MSG_ID = "f0000001-0000-4000-8000-000000000001";
const SYNTH_PERSON_ID = "a0000001-0000-4000-8000-000000000002";
const SYNTH_PERSON_ID_2 = "b0000001-0000-4000-8000-000000000003";

// ── Helpers para fake DbClient ─────────────────────────────────────────────

/** Fila de BD sintetica para alive_messages (snake_case). */
function makeFakeRow(overrides: Partial<{
  id: string;
  person_id: string | null;
  autor_nombre: string;
  tipo: string;
  contenido: string;
  zona: string | null;
  entregado: boolean;
  created_at: string;
}> = {}) {
  return {
    id: SYNTH_MSG_ID,
    person_id: null,
    autor_nombre: "Autor Sintético",
    tipo: "texto",
    contenido: "Estamos bien, refugio norte",
    zona: "La Guaira",
    entregado: false,
    created_at: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Spy recorder for query builder calls.
 * Records each chained method name + argument so tests can assert
 * that the correct SQL filters were wired up (eq, update, order, etc.).
 */
interface SpyCall {
  method: string;
  arg0?: unknown;
  arg1?: unknown;
}

/** Fake client para operaciones de INSERT con .select().single(). */
function makeFakeInsertClient(row: ReturnType<typeof makeFakeRow>): DbClient {
  const queryBuilder: Record<string, unknown> = {};
  queryBuilder.insert = () => queryBuilder;
  queryBuilder.select = () => queryBuilder;
  queryBuilder.single = () => Promise.resolve({ data: row, error: null });
  queryBuilder.eq = () => queryBuilder;
  queryBuilder.order = () => queryBuilder;
  queryBuilder.limit = () => queryBuilder;
  queryBuilder.returns = () => Promise.resolve({ data: [], error: null });
  queryBuilder.update = () => queryBuilder;
  queryBuilder.delete = () => queryBuilder;
  return { from: () => queryBuilder } as unknown as DbClient;
}

/**
 * Fake client that records eq/order/update call arguments (spy).
 * Returns the given rows array via `.returns()` (for list queries).
 */
function makeFakeSpySelectClient(
  rows: ReturnType<typeof makeFakeRow>[],
  spy: SpyCall[],
): DbClient {
  const maybeSingleRow = rows[0] ?? null;
  const queryBuilder = {
    select: () => queryBuilder,
    eq: (col: unknown, val: unknown) => {
      spy.push({ method: "eq", arg0: col, arg1: val });
      return queryBuilder;
    },
    order: (col: unknown, opts: unknown) => {
      spy.push({ method: "order", arg0: col, arg1: opts });
      return queryBuilder;
    },
    limit: () => queryBuilder,
    maybeSingle: () => Promise.resolve({ data: maybeSingleRow, error: null }),
    // returns() resolves the rows immediately (list queries)
    returns: () => Promise.resolve({ data: rows, error: null }),
    update: (vals: unknown) => {
      spy.push({ method: "update", arg0: vals });
      return queryBuilder;
    },
    delete: () => queryBuilder,
    insert: () => queryBuilder,
    single: () => Promise.resolve({ data: maybeSingleRow, error: null }),
    then: (resolve: (v: { data: typeof rows; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  return { from: () => queryBuilder } as unknown as DbClient;
}

/** Fake client para operaciones de UPDATE (no devuelve filas, solo vacío). */
function makeFakeSpyUpdateClient(spy: SpyCall[]): DbClient {
  const queryBuilder = {
    update: (vals: unknown) => {
      spy.push({ method: "update", arg0: vals });
      return queryBuilder;
    },
    eq: (col: unknown, val: unknown) => {
      spy.push({ method: "eq", arg0: col, arg1: val });
      return queryBuilder;
    },
    select: () => queryBuilder,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: null, error: null }),
  };
  return { from: () => queryBuilder } as unknown as DbClient;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AliveMessagesRepo.create", () => {
  it("persists a message and maps snake_case row to camelCase domain", async () => {
    const row = makeFakeRow({ autor_nombre: "Pedro Simón", zona: "Caracas" });
    const client = makeFakeInsertClient(row);
    const repo = createAliveMessagesRepo(client);

    const result = await repo.create({
      autorNombre: "Pedro Simón",
      tipo: "texto",
      contenido: "Estamos vivos",
      zona: "Caracas",
    });

    expect(result.id).toBe(SYNTH_MSG_ID);
    // autorNombre maps from autor_nombre (snake→camel); fake row has autor_nombre: "Pedro Simón"
    expect(result.autorNombre).toBe("Pedro Simón");
    expect(result.entregado).toBe(false);
    expect(result.personId).toBeNull();
    expect(result.createdAt).toBe("2026-01-15T10:00:00.000Z");
  });

  it("does NOT expose any contact_id or PII on the result", async () => {
    const row = makeFakeRow();
    const client = makeFakeInsertClient(row);
    const repo = createAliveMessagesRepo(client);

    const result = await repo.create({
      autorNombre: "Test Author",
      tipo: "texto",
      contenido: "Alive and well",
    });

    // The domain object must not contain contact_id
    expect(Object.keys(result)).not.toContain("contact_id");
    expect(Object.keys(result)).not.toContain("buscador_contact_id");
  });
});

describe("AliveMessagesRepo.getById", () => {
  it("returns the message when found", async () => {
    const spy: SpyCall[] = [];
    const row = makeFakeRow({ id: SYNTH_MSG_ID });
    const client = makeFakeSpySelectClient([row], spy);
    const repo = createAliveMessagesRepo(client);

    const result = await repo.getById(SYNTH_MSG_ID);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(SYNTH_MSG_ID);
  });

  it("returns null when not found", async () => {
    const spy: SpyCall[] = [];
    const client = makeFakeSpySelectClient([], spy);
    const repo = createAliveMessagesRepo(client);

    const result = await repo.getById("nonexistent-id");

    expect(result).toBeNull();
  });
});

describe("AliveMessagesRepo.getPendingByPersonId", () => {
  it("calls .eq('person_id', personId) and .eq('entregado', false) and .order('created_at', ascending)", async () => {
    const spy: SpyCall[] = [];
    const pending = makeFakeRow({ person_id: SYNTH_PERSON_ID, entregado: false });
    const client = makeFakeSpySelectClient([pending], spy);
    const repo = createAliveMessagesRepo(client);

    const results = await repo.getPendingByPersonId(SYNTH_PERSON_ID);

    // Must have called .eq with person_id filter
    const personIdEq = spy.find((c) => c.method === "eq" && c.arg0 === "person_id");
    expect(personIdEq).toBeDefined();
    expect(personIdEq!.arg1).toBe(SYNTH_PERSON_ID);

    // Must have called .eq with entregado=false filter
    const entregadoEq = spy.find((c) => c.method === "eq" && c.arg0 === "entregado");
    expect(entregadoEq).toBeDefined();
    expect(entregadoEq!.arg1).toBe(false);

    // Must have called .order('created_at', { ascending: true })
    const orderCall = spy.find((c) => c.method === "order" && c.arg0 === "created_at");
    expect(orderCall).toBeDefined();
    expect((orderCall!.arg1 as { ascending: boolean }).ascending).toBe(true);

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]!.entregado).toBe(false);
  });

  it("would exclude a delivered row: eq('entregado', false) filter arg is proven false (not true)", async () => {
    const spy: SpyCall[] = [];
    // Simulate only pending rows being returned (delivered row excluded by SQL)
    const pending = makeFakeRow({ person_id: SYNTH_PERSON_ID, entregado: false });
    const client = makeFakeSpySelectClient([pending], spy);
    const repo = createAliveMessagesRepo(client);

    await repo.getPendingByPersonId(SYNTH_PERSON_ID);

    // The filter arg for entregado is false — not true — proving the intent
    const entregadoEq = spy.find((c) => c.method === "eq" && c.arg0 === "entregado");
    expect(entregadoEq!.arg1).toBe(false);
    expect(entregadoEq!.arg1).not.toBe(true);
  });

  it("would exclude rows for a different person: eq('person_id', <id>) uses the caller's id", async () => {
    const spy: SpyCall[] = [];
    const client = makeFakeSpySelectClient([], spy);
    const repo = createAliveMessagesRepo(client);

    await repo.getPendingByPersonId(SYNTH_PERSON_ID);

    const personIdEq = spy.find((c) => c.method === "eq" && c.arg0 === "person_id");
    // Must use exactly the given personId — not some other person's id
    expect(personIdEq!.arg1).toBe(SYNTH_PERSON_ID);
    expect(personIdEq!.arg1).not.toBe(SYNTH_PERSON_ID_2);
  });

  it("returns an empty array when no pending messages", async () => {
    const spy: SpyCall[] = [];
    const client = makeFakeSpySelectClient([], spy);
    const repo = createAliveMessagesRepo(client);

    const results = await repo.getPendingByPersonId(SYNTH_PERSON_ID);

    expect(results).toHaveLength(0);
  });
});

describe("AliveMessagesRepo.markDelivered", () => {
  it("calls .update({ entregado: true }) and .eq('id', id)", async () => {
    const spy: SpyCall[] = [];
    const client = makeFakeSpyUpdateClient(spy);
    const repo = createAliveMessagesRepo(client);

    await expect(repo.markDelivered(SYNTH_MSG_ID)).resolves.toBeUndefined();

    // Must have called .update with entregado: true
    const updateCall = spy.find((c) => c.method === "update");
    expect(updateCall).toBeDefined();
    expect((updateCall!.arg0 as { entregado: boolean }).entregado).toBe(true);

    // Must have called .eq('id', SYNTH_MSG_ID)
    const idEq = spy.find((c) => c.method === "eq" && c.arg0 === "id");
    expect(idEq).toBeDefined();
    expect(idEq!.arg1).toBe(SYNTH_MSG_ID);
  });
});
