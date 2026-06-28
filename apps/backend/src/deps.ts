import type { PersonRepo, SearchRepo } from "db";

// Dependencias que necesita la API para funcionar.
//
// Se inyectan en buildApp por el contrato (no se importan dentro de los handlers)
// para poder testear la API con repos FALSOS, sin red ni Supabase. El cableado
// real (cliente service_role + repos) vive solo en src/index.ts.

/** Repositorios y configuracion que consume la capa de adaptadores (Fastify). */
export interface AppDeps {
  /** Repositorio de personas (escritura en tabla base, lectura por vista publica). */
  personRepo: PersonRepo;
  /** Repositorio de busquedas (flujo interno; nunca expone buscador_contact_id). */
  searchRepo: SearchRepo;
  /**
   * Secreto de servicio para operaciones privilegiadas (p. ej. DELETE).
   * Si esta vacio o indefinido, esas operaciones quedan deshabilitadas (responden 401).
   * En Fase 2, el borrado por el dueno via canal usara el token del bot.
   */
  serviceToken: string | undefined;
}
