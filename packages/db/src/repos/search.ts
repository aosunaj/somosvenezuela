import {
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

export interface SearchRepo {
  /** ESCRITURA. Registra una busqueda. Devuelve el registro completo (uso interno). */
  create(input: SearchCreate): Promise<Search>;
  /** LECTURA INTERNA. Obtiene una busqueda por id (solo backend). */
  getById(id: string): Promise<Search | null>;
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
  };
}
