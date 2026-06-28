import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadDbEnv } from "./env.js";

// Cliente Supabase con la clave service_role (BYPASSRLS).
// CRITICO: este cliente SALTA RLS, por lo que SOLO debe vivir en el backend.
// Nunca se expone a la web ni a los bots con la clave de servicio.
//
// El cliente se encapsula aqui (unico punto de creacion). Los repositorios lo
// reciben por inyeccion; no llaman a createClient por su cuenta. Asi el acceso a
// datos queda centralizado (docs/sdd/02-design.md) y es testeable sin red.

/**
 * Tipo del cliente Supabase usado por la capa de datos.
 * Se mantiene sin tipos generados de la BD en esta fase (T0.3); los repositorios
 * tipan sus filas explicitamente sobre los tipos del dominio (`core`).
 */
export type DbClient = SupabaseClient;

/**
 * Crea un cliente Supabase con la clave service_role leida de process.env.
 *
 * Configuracion endurecida para uso de servidor:
 * - `persistSession: false` y `autoRefreshToken: false`: no hay sesion de usuario;
 *   la autenticacion es la propia clave de servicio.
 *
 * Lanza DbConfigError (via loadDbEnv) si falta configuracion.
 */
export function createServiceClient(): DbClient {
  const env = loadDbEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Singleton perezoso: se crea la primera vez que se pide y se reutiliza.
let cached: DbClient | undefined;

/**
 * Devuelve el cliente Supabase de servicio compartido, creandolo la primera vez.
 * Centraliza el acceso para no dispersar conexiones por el codigo.
 */
export function getServiceClient(): DbClient {
  if (cached === undefined) {
    cached = createServiceClient();
  }
  return cached;
}
