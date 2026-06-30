import {
  esMenor,
  searchCreateSchema,
  type Search,
  type SearchCreate,
} from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import { rowToSearch } from "../mappers.js";
import type { SearchRow } from "../types.js";

// Repositorio de busquedas (quien busca a quien).
//
// `searches` NO tiene vista publica: contiene buscador_contact_id (SENSIBLE) y es
// flujo INTERNO (genera notificaciones a la familia). Solo lo usa el backend con
// service_role. No hay metodos "publicos" aqui.

/** Referencia de búsqueda abierta para el motor de matching (sin buscador_contact_id). */
export interface OpenMatchingReport {
  readonly id: string;
  readonly tipo: string;
  readonly target_nombre: string | null;
  readonly target_descripcion: string | null;
  readonly zona: string | null;
  readonly es_menor: boolean;
  readonly created_at: string;
}

export interface SearchRepo {
  /** ESCRITURA. Registra una busqueda. Devuelve el registro completo (uso interno). */
  create(input: SearchCreate): Promise<Search>;
  /** LECTURA INTERNA. Obtiene una busqueda por id (solo backend). */
  getById(id: string): Promise<Search | null>;
  /**
   * LECTURA INTERNA (routing). Determina si el buscador de una búsqueda es menor.
   * Un contact_id puede tener múltiples personas ligadas (many-to-one). Regla
   * conservadora (design R2-4 / F2 extended):
   *   - 0 personas ligadas al contacto → true (conservative).
   *   - Al menos UNA persona menor o edad null o fila en minors → true.
   *   - TODAS las personas positivamente adultas → false.
   */
  isMinorByContactId(contactId: string): Promise<boolean>;
  /**
   * LECTURA INTERNA. Lista las búsquedas abiertas que necesitan matching.
   * NO expone buscador_contact_id en la respuesta.
   */
  listOpenMatchingReport(limit?: number): Promise<OpenMatchingReport[]>;
}

/** Construye el repositorio de busquedas sobre un cliente Supabase de servicio. */
export function createSearchRepo(client: DbClient): SearchRepo {
  return {
    async create(input: SearchCreate): Promise<Search> {
      const data = searchCreateSchema.parse(input);

      const insert = {
        tipo: data.tipo,
        target_nombre: data.target_nombre ?? null,
        target_descripcion: data.target_descripcion ?? null,
        zona: data.zona ?? null,
        buscador_contact_id: data.buscador_contact_id ?? null,
      };

      const { data: row, error } = await client
        .from("searches")
        .insert(insert)
        .select("*")
        .single<SearchRow>();

      if (error) throw new DbError(`No se pudo crear la busqueda: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de busqueda no devolvio fila.");
      return rowToSearch(row);
    },

    async getById(id: string): Promise<Search | null> {
      const { data, error } = await client
        .from("searches")
        .select("*")
        .eq("id", id)
        .maybeSingle<SearchRow>();

      if (error) throw new DbError(`No se pudo obtener la busqueda: ${error.message}`, error.code);
      return data ? rowToSearch(data) : null;
    },

    async isMinorByContactId(contactId: string): Promise<boolean> {
      // Recupera todas las personas ligadas a este contacto desde la tabla base.
      // NUNCA desde persons_public (excluye menores — sería inútil para routing).
      const { data, error } = await client
        .from("persons")
        .select("id, edad, minors_row:minors(id)")
        .eq("contact_id", contactId)
        .returns<Array<{ id: string; edad: number | null; minors_row: { id: string } | null }>>();

      if (error) {
        throw new DbError(`isMinorByContactId falló: ${error.message}`, error.code);
      }

      const persons = data ?? [];

      // 0 personas → conservative (contacto sin personas = no se puede afirmar adultez)
      if (persons.length === 0) return true;

      // Si ANY persona es menor → true (multi-persona conservative).
      // Solo si ALL son positivamente adultas → false.
      return persons.some((p) =>
        esMenor({ edad: p.edad, tieneRefuerzoMinors: p.minors_row != null }),
      );
    },

    async listOpenMatchingReport(limit = 100): Promise<OpenMatchingReport[]> {
      // Lista búsquedas de personas activas para el motor de matching.
      // Proyecta solo los campos necesarios — NUNCA buscador_contact_id.
      const { data, error } = await client
        .from("searches")
        .select("id, tipo, target_nombre, target_descripcion, zona, es_menor, created_at")
        .eq("tipo", "persona")
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<OpenMatchingReport[]>();

      if (error) {
        throw new DbError(`listOpenMatchingReport falló: ${error.message}`, error.code);
      }

      return (data ?? []).map((row) => ({
        id: row.id,
        tipo: row.tipo,
        target_nombre: row.target_nombre,
        target_descripcion: row.target_descripcion,
        zona: row.zona,
        es_menor: row.es_menor ?? false,
        created_at: row.created_at,
      }));
    },
  };
}
