import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import postgres from "postgres";
import { DbConfigError, loadMigrationEnv } from "../env.js";
import { loadDotenvIfPresent } from "../loadDotenv.js";
import { runMigrations, type MigrationFile } from "../migrate.js";

// Carga el .env de la raiz si existe (desarrollo local); en prod usa el entorno real.
loadDotenvIfPresent();

// CLI runner de migraciones. Wrapper fino sobre packages/db/src/migrate.ts que:
//   1) Lee archivos .sql del directorio migrations/ raiz del repo.
//   2) Los pasa a runMigrations() que aplica el ledger de idempotencia.
//
// Alternativa operativa: aplicar via el MCP de Supabase (apply_migration).
// Este runner es para entornos con DATABASE_URL disponible (backend/CI).

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Directorio migrations/ en la raiz del repo (este archivo vive en packages/db/src/scripts). */
const MIGRATIONS_DIR = resolve(__dirname, "../../../../migrations");

async function listMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = readdirSync(dir);
  const sqlFiles = entries
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(
    sqlFiles.map(async (filename) => {
      const content = await readFile(join(dir, filename), "utf8");
      return { filename, content };
    }),
  );
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
    console.log(`[migrate] Iniciando: ${files.length} archivo(s) en ${MIGRATIONS_DIR}`);
    await runMigrations(sql, files);
    console.log(`[migrate] OK. Migraciones aplicadas (ver schema_migrations para detalle).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[migrate] fallo: ${message}`);
  process.exit(1);
});
