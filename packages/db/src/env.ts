import { z } from "zod";

// Configuracion de entorno de la capa de datos.
// Lee y VALIDA las variables en runtime desde process.env. Nunca hardcodea
// secretos ni los imprime. El backend (service_role) es el unico que carga
// estas claves; las claves publicas (anon) viven en la web, no aqui.
//
// IMPORTANTE: este modulo NO lee archivos .env (estan protegidos y se gestionan
// como variables de entorno reales en cada plataforma). El proceso debe tener
// las variables ya presentes en process.env.

/**
 * Esquema de las variables de entorno requeridas por la capa de datos.
 * - SUPABASE_URL: URL del proyecto Supabase (https://...supabase.co).
 * - SUPABASE_SERVICE_ROLE_KEY: clave de servicio (BYPASSRLS). SECRETO, solo backend.
 */
const dbEnvSchema = z.object({
  SUPABASE_URL: z.url({
    // La URL del proyecto Supabase es siempre https; rechazar otros esquemas.
    protocol: /^https$/,
    error: "SUPABASE_URL debe ser una URL https valida del proyecto Supabase.",
  }),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string({ error: "SUPABASE_SERVICE_ROLE_KEY es obligatoria." })
    .min(1, "SUPABASE_SERVICE_ROLE_KEY no puede estar vacia."),
});

/** Variables de entorno validadas de la capa de datos. */
export type DbEnv = z.infer<typeof dbEnvSchema>;

/** Error claro y explicito cuando falta o es invalida la configuracion de la BD. */
export class DbConfigError extends Error {
  override readonly name = "DbConfigError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Lee y valida la configuracion de la capa de datos desde process.env.
 * Si falta o es invalida alguna variable, lanza DbConfigError con un mensaje
 * que nombra las variables afectadas SIN imprimir jamas sus valores.
 *
 * @param source - fuente de variables (por defecto process.env); inyectable en tests.
 */
export function loadDbEnv(source: NodeJS.ProcessEnv = process.env): DbEnv {
  const parsed = dbEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new DbConfigError(formatIssues(parsed.error.issues));
  }
  return parsed.data;
}

/**
 * Esquema de la conexion directa a Postgres, necesaria SOLO para aplicar
 * migraciones y seeds (DDL/DML por lotes). PostgREST/supabase-js no ejecuta SQL
 * arbitrario; por eso migrate/seed usan DATABASE_URL.
 */
const migrationEnvSchema = z.object({
  DATABASE_URL: z.string({ error: "DATABASE_URL es obligatoria para migrate/seed." }).min(1, "DATABASE_URL no puede estar vacia."),
});

/** Variables de entorno validadas para aplicar migraciones/seeds. */
export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

/**
 * Lee y valida DATABASE_URL para migrate/seed. Lanza DbConfigError si falta.
 * @param source - fuente de variables (por defecto process.env); inyectable en tests.
 */
export function loadMigrationEnv(source: NodeJS.ProcessEnv = process.env): MigrationEnv {
  const parsed = migrationEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new DbConfigError(formatIssues(parsed.error.issues));
  }
  return parsed.data;
}

/** Formatea los issues de zod nombrando variables y motivo, NUNCA su valor. */
function formatIssues(issues: z.core.$ZodIssue[]): string {
  const detalles = issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return `Configuracion de la base de datos invalida o ausente. Define las variables de entorno requeridas. Detalle: ${detalles}`;
}
