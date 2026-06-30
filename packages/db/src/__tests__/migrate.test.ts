import { describe, expect, it, vi } from "vitest";
import { runMigrations, type MigrationSql } from "../migrate.js";

// Tests para el runner de migraciones con ledger de idempotencia.
//
// PROHIBICION: estos tests NUNCA tocan la Supabase live ni ninguna DB real.
// Toda la logica se prueba contra fakes del cliente postgres.
//
// Datos SINTETICOS: ningun UUID ni cadena pertenece a datos reales.

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Registro capturado de cada llamada al fake sql.
 * Distingue entre unsafe (sentencias DDL/DML) e insert de ledger.
 */
interface SqlCall {
  type: "unsafe" | "ledger_select" | "ledger_insert" | "create_ledger" | "begin";
  arg?: string;
}

/**
 * Builds a fake `postgres` sql client for migration tests.
 * Supports: template literal calls (ledger_select/insert/create_ledger),
 * sql.unsafe (DDL), sql.begin (per-file tx).
 */
function makeFakeSql(opts: {
  /** Files already in the ledger (will be returned as "found"). */
  appliedFiles?: string[];
  /** If set, sql.begin rethrows this error (simulates DDL failure inside tx). */
  beginError?: Error;
}): { sql: MigrationSql; calls: SqlCall[] } {
  const appliedFiles = new Set(opts.appliedFiles ?? []);
  const calls: SqlCall[] = [];

  // Template literal handler: distinguishes ledger queries from DDL.
  const handler = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const query = strings.join("?").trim();

    if (/create table if not exists schema_migrations/i.test(query)) {
      calls.push({ type: "create_ledger" });
      return Promise.resolve([]);
    }

    if (/select 1 from schema_migrations where filename/i.test(query)) {
      const filename = values[0] as string;
      calls.push({ type: "ledger_select", arg: filename });
      return appliedFiles.has(filename) ? Promise.resolve([{ "?column?": 1 }]) : Promise.resolve([]);
    }

    if (/insert into schema_migrations \(filename\)/i.test(query)) {
      const filename = values[0] as string;
      calls.push({ type: "ledger_insert", arg: filename });
      return Promise.resolve([]);
    }

    calls.push({ type: "unsafe", arg: query });
    return Promise.resolve([]);
  };

  const fakeSql = Object.assign(handler, {
    unsafe: (ddl: string): Promise<unknown[]> => {
      calls.push({ type: "unsafe", arg: ddl.substring(0, 120) });
      return Promise.resolve([]);
    },
    begin: async (fn: (tx: MigrationSql) => Promise<void>): Promise<void> => {
      if (opts.beginError) throw opts.beginError;
      calls.push({ type: "begin" });
      await fn(fakeSql);
    },
    end: vi.fn().mockResolvedValue(undefined),
  }) as unknown as MigrationSql;

  return { sql: fakeSql, calls };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("runMigrations — idempotency ledger", () => {
  it("skips files already recorded in schema_migrations", async () => {
    const { sql, calls } = makeFakeSql({ appliedFiles: ["0001_init.sql"] });

    await runMigrations(sql, [
      { filename: "0001_init.sql", content: "CREATE TABLE IF NOT EXISTS test_ledger (id int);" },
      { filename: "0002_other.sql", content: "CREATE TABLE IF NOT EXISTS other_ledger (id int);" },
    ]);

    const ledgerSelects = calls.filter((c) => c.type === "ledger_select");
    expect(ledgerSelects).toHaveLength(2);

    const ledgerInserts = calls.filter((c) => c.type === "ledger_insert");
    // Only the unapplied file gets inserted
    expect(ledgerInserts).toHaveLength(1);
    expect(ledgerInserts[0]?.arg).toBe("0002_other.sql");

    // The already-applied file must NOT produce a DDL unsafe call or a begin
    const unsafeDdlCalls = calls.filter(
      (c) => c.type === "unsafe" && c.arg?.includes("test_ledger"),
    );
    expect(unsafeDdlCalls).toHaveLength(0);
  });

  it("records the file in the ledger after applying it", async () => {
    const { sql, calls } = makeFakeSql({});

    await runMigrations(sql, [
      { filename: "0002_fresh.sql", content: "CREATE TABLE IF NOT EXISTS fresh_ledger (id int);" },
    ]);

    const inserts = calls.filter((c) => c.type === "ledger_insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.arg).toBe("0002_fresh.sql");
  });

  it("creates the ledger table once at startup before processing any file", async () => {
    const { sql, calls } = makeFakeSql({});

    await runMigrations(sql, [
      { filename: "0001_init.sql", content: "CREATE TABLE IF NOT EXISTS t_startup (id int);" },
    ]);

    const createIdx = calls.findIndex((c) => c.type === "create_ledger");
    const firstSelect = calls.findIndex((c) => c.type === "ledger_select");
    expect(createIdx).toBeGreaterThanOrEqual(0);
    // create_ledger must appear before the first ledger_select
    expect(createIdx).toBeLessThan(firstSelect);
  });

  it("does NOT add ledger entry when the file was skipped", async () => {
    const { sql, calls } = makeFakeSql({ appliedFiles: ["0001_init.sql"] });

    await runMigrations(sql, [{ filename: "0001_init.sql", content: "SELECT 1;" }]);

    const inserts = calls.filter((c) => c.type === "ledger_insert");
    expect(inserts).toHaveLength(0);
  });
});

describe("runMigrations — per-file transaction rollback", () => {
  it("wraps each unapplied non-ADD-VALUE file in its own transaction", async () => {
    const { sql, calls } = makeFakeSql({});

    await runMigrations(sql, [
      { filename: "0001_init.sql", content: "CREATE TABLE IF NOT EXISTS a_tx (id int);" },
      { filename: "0002_other.sql", content: "CREATE TABLE IF NOT EXISTS b_tx (id int);" },
    ]);

    const begins = calls.filter((c) => c.type === "begin");
    expect(begins).toHaveLength(2);
  });

  it("stops processing on the failing file but does NOT add it to the ledger", async () => {
    const { sql, calls } = makeFakeSql({
      beginError: new Error("DDL failed synthetically"),
    });

    await expect(
      runMigrations(sql, [
        { filename: "0001_fail.sql", content: "CREATE TABLE bad_syntax_fake;" },
      ]),
    ).rejects.toThrow();

    const inserts = calls.filter((c) => c.type === "ledger_insert");
    expect(inserts).toHaveLength(0);
  });
});

describe("runMigrations — ALTER TYPE ADD VALUE detection by content regex", () => {
  it("detects ADD VALUE by regex on file CONTENT (not filename) and runs outside tx", async () => {
    const { sql, calls } = makeFakeSql({});
    // File is named with a generic name — detection must use content, not name
    const addValueContent = "ALTER TYPE estado_persona ADD VALUE IF NOT EXISTS 'a_salvo';";

    await runMigrations(sql, [
      { filename: "generic_name.sql", content: addValueContent },
    ]);

    // Must NOT be wrapped in begin() — runs outside transaction
    const begins = calls.filter((c) => c.type === "begin");
    expect(begins).toHaveLength(0);

    // Must run via sql.unsafe (outside tx)
    const unsafeCalls = calls.filter((c) => c.type === "unsafe");
    expect(unsafeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("wraps normal DDL (even with 'ADD' keyword in content) inside a transaction", async () => {
    const { sql, calls } = makeFakeSql({});
    const normalContent = "CREATE TABLE IF NOT EXISTS add_table_fake (id int);";

    await runMigrations(sql, [
      { filename: "0003_normal.sql", content: normalContent },
    ]);

    // Normal DDL wraps in begin()
    const begins = calls.filter((c) => c.type === "begin");
    expect(begins).toHaveLength(1);
  });

  it("still records the ADD VALUE file in the ledger after running outside tx", async () => {
    const { sql, calls } = makeFakeSql({});
    const addValueContent = "ALTER TYPE estado_persona ADD VALUE IF NOT EXISTS 'a_salvo';";

    await runMigrations(sql, [
      { filename: "0007_a_salvo.sql", content: addValueContent },
    ]);

    const inserts = calls.filter((c) => c.type === "ledger_insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.arg).toBe("0007_a_salvo.sql");
  });

  it("runs multiple files correctly: ADD VALUE outside tx, normal inside tx", async () => {
    const { sql, calls } = makeFakeSql({});

    await runMigrations(sql, [
      {
        filename: "0001_normal.sql",
        content: "CREATE TABLE IF NOT EXISTS normal_multi (id int);",
      },
      {
        filename: "0007_addvalue.sql",
        content: "ALTER TYPE some_type ADD VALUE IF NOT EXISTS 'new_val';",
      },
    ]);

    const begins = calls.filter((c) => c.type === "begin");
    // Only the normal file uses begin
    expect(begins).toHaveLength(1);

    // Both files get ledger inserts
    const inserts = calls.filter((c) => c.type === "ledger_insert");
    expect(inserts).toHaveLength(2);
  });
});
