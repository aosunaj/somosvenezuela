import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import postgres from "postgres";
import { DbConfigError, loadMigrationEnv } from "../env.js";
import { loadDotenvIfPresent } from "../loadDotenv.js";

// Carga el .env de la raiz si existe (desarrollo local); en prod usa el entorno real.
loadDotenvIfPresent();

// Runner de migraciones. Aplica migrations/*.sql en ORDEN alfabetico contra la
// conexion directa Postgres (DATABASE_URL). PostgREST/supabase-js no ejecuta SQL
// arbitrario; las migraciones (DDL) requieren conexion directa.
//
// Alternativa operativa: aplicarlas via el MCP de Supabase (apply_migration), como
// describe docs/automatizacion-plataformas.md. Este runner es para entornos con
// DATABASE_URL disponible (backend/CI).
//
// Idempotencia: las migraciones del proyecto ya usan IF NOT EXISTS / OR REPLACE.

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Directorio migrations/ en la raiz del repo (este archivo vive en packages/db/src/scripts). */
const MIGRATIONS_DIR = resolve(__dirname, "../../../../migrations");

async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  let env;
  try {
    env = loadMigrationEnv();
  } catch (err) {
    if (err instanceof DbConfigError) {
      console.error(`[migrate] ${err.message}`);
      console.error(
        "[migrate] Alternativa: aplica migrations/*.sql via el MCP de Supabase (apply_migration).",
      );
      process.exit(1);
    }
    throw err;
  }

  const files = await listMigrationFiles(MIGRATIONS_DIR);
  if (files.length === 0) {
    console.error(`[migrate] No se encontraron archivos .sql en ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    for (const file of files) {
      const fullPath = join(MIGRATIONS_DIR, file);
      const ddl = await readFile(fullPath, "utf8");
      console.log(`[migrate] aplicando ${file}...`);
      // Cada archivo se ejecuta como un bloque (puede contener varias sentencias).
      await sql.unsafe(ddl);
    }
    console.log(`[migrate] OK. ${files.length} migracion(es) aplicada(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[migrate] fallo: ${message}`);
  process.exit(1);
});
