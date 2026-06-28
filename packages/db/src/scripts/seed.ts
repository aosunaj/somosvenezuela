import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { DbConfigError, loadMigrationEnv } from "../env.js";
import { loadDotenvIfPresent } from "../loadDotenv.js";

// Carga el .env de la raiz si existe (desarrollo local); en prod usa el entorno real.
loadDotenvIfPresent();

// Aplica los seeds SINTETICOS (packages/db/seeds/seed.sql) contra la conexion
// directa Postgres (DATABASE_URL). Datos claramente ficticios, SIN PII real.
// Idempotente: el seed usa ids fijos y ON CONFLICT DO NOTHING.
//
// Alternativa operativa: aplicar seeds/seed.sql via el MCP de Supabase.

const __dirname = dirname(fileURLToPath(import.meta.url));
/** packages/db/seeds/seed.sql (este archivo vive en packages/db/src/scripts). */
const SEED_FILE = resolve(__dirname, "../../seeds/seed.sql");

async function main(): Promise<void> {
  let env;
  try {
    env = loadMigrationEnv();
  } catch (err) {
    if (err instanceof DbConfigError) {
      console.error(`[seed] ${err.message}`);
      console.error("[seed] Alternativa: aplica packages/db/seeds/seed.sql via el MCP de Supabase.");
      process.exit(1);
    }
    throw err;
  }

  const seedSql = await readFile(SEED_FILE, "utf8");
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    console.log("[seed] aplicando datos sinteticos...");
    await sql.unsafe(seedSql);
    console.log("[seed] OK. Datos sinteticos aplicados.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[seed] fallo: ${message}`);
  process.exit(1);
});
