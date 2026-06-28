import { createServiceClient } from "../client.js";
import { DbConfigError } from "../env.js";
import { loadDotenvIfPresent } from "../loadDotenv.js";

// Carga el .env de la raiz si existe (desarrollo local); en prod usa el entorno real.
loadDotenvIfPresent();

// Verificacion de salud de la capa de datos para `pnpm verify` (db:check):
//   1. La configuracion de entorno existe y es valida (si falta -> fallo claro).
//   2. Hay conexion al proyecto Supabase.
//   3. Existen las tablas base y las vistas *_public esperadas.
//
// Usa el cliente service_role (PostgREST). No aplica DDL; solo lee. Si una tabla
// o vista no existe, PostgREST devuelve un error que aqui se reporta legible.

/** Tablas base que deben existir. */
const EXPECTED_TABLES = [
  "persons",
  "pets",
  "searches",
  "contacts",
  "channels",
  "sources",
] as const;

/** Vistas publicas que deben existir (lectura publica curada). */
const EXPECTED_VIEWS = [
  "persons_public",
  "pets_public",
  "zones_public",
  "needs_public",
  "sources_public",
] as const;

async function main(): Promise<void> {
  let client;
  try {
    client = createServiceClient();
  } catch (err) {
    if (err instanceof DbConfigError) {
      // Fallo claro y esperado cuando faltan las variables de entorno.
      console.error(`[db:check] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const faltantes: string[] = [];

  for (const relation of [...EXPECTED_TABLES, ...EXPECTED_VIEWS]) {
    // head:true => no trae filas, solo comprueba que la relacion responde.
    const { error } = await client.from(relation).select("*", { head: true, count: "exact" });
    if (error) {
      faltantes.push(`${relation} (${error.message})`);
    }
  }

  if (faltantes.length > 0) {
    console.error("[db:check] Faltan o fallan relaciones esperadas:");
    for (const f of faltantes) console.error(`  - ${f}`);
    console.error("[db:check] Aplica las migraciones (pnpm --filter db migrate) o revisa el proyecto Supabase.");
    process.exit(1);
  }

  console.log(
    `[db:check] OK. Conexion y ${EXPECTED_TABLES.length} tabla(s) + ${EXPECTED_VIEWS.length} vista(s) verificadas.`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[db:check] fallo inesperado: ${message}`);
  process.exit(1);
});
