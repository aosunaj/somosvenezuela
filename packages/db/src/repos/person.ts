import {
  assertEstadoFallecidoValido,
  DEFAULT_ESTADO,
  DEFAULT_FUENTE,
  DEFAULT_VERIFICACION,
  personCreateSchema,
  type Person,
  type PersonCreate,
  type PublicPerson,
} from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import {
  publicRowToPublicPerson,
  rowToPerson,
} from "../mappers.js";
import {
  PERSON_PUBLIC_COLUMNS,
  type PersonPublicRow,
  type PersonRow,
} from "../types.js";

// Repositorio de personas.
//
// REGLAS DURAS (docs/sdd/02-design.md, guardrails #1):
//   - ESCRITURA  -> tabla base `persons` (service_role salta RLS).
//   - LECTURA PUBLICA -> SOLO la vista `persons_public` (excluye menores y
//     contact_id). Los metodos publicos JAMAS devuelven contact_id.
//   - Antes de persistir 'fallecida' se llama assertEstadoFallecidoValido (core)
//     como defensa en profundidad sobre la constraint SQL.

/** Datos de busqueda publica de personas (resultado con score). */
export interface PublicPersonResult extends PublicPerson {
  /** Similitud trigram [0..1]; mayor = mas probable. */
  score: number;
}

/** Fila devuelta por la RPC search_persons_public (vista publica + score). */
interface PersonSearchRow extends PersonPublicRow {
  score: number;
}

export interface PersonRepo {
  /** ESCRITURA. Crea una persona en la tabla base. Devuelve el registro completo (interno). */
  create(input: PersonCreate): Promise<Person>;
  /** LECTURA PUBLICA. Lista personas desde la vista persons_public (sin contacto, sin menores). */
  listPublic(limit?: number): Promise<PublicPerson[]>;
  /** LECTURA PUBLICA. Obtiene una persona publica por id (null si no esta en la vista). */
  getPublic(id: string): Promise<PublicPerson | null>;
  /** LECTURA PUBLICA. Busqueda difusa (pg_trgm) por nombre/zona/descripcion, ordenada por score. */
  searchPersonsPublic(query: string, zona?: string): Promise<PublicPersonResult[]>;
  /** BORRADO (derecho al olvido). Elimina la persona de la tabla base por id. */
  remove(id: string): Promise<void>;
}

/** Construye el repositorio de personas sobre un cliente Supabase de servicio. */
export function createPersonRepo(client: DbClient): PersonRepo {
  return {
    async create(input: PersonCreate): Promise<Person> {
      // Validacion de entrada externa (zod) antes de tocar la BD.
      const data = personCreateSchema.parse(input);

      // Defensa en profundidad: el alta nace 'desaparecida'/'sin_verificar', por lo
      // que el guardrail de fallecidos no puede violarse aqui; aun asi lo afirmamos.
      assertEstadoFallecidoValido({
        estado: DEFAULT_ESTADO,
        verificacion: DEFAULT_VERIFICACION,
      });

      const insert = {
        nombre: data.nombre,
        apellidos: data.apellidos ?? null,
        edad: data.edad ?? null,
        zona: data.zona ?? null,
        descripcion: data.descripcion ?? null,
        foto_url: data.foto_url ?? null,
        fuente: data.fuente ?? DEFAULT_FUENTE,
        contact_id: data.contact_id ?? null,
        // estado/verificacion los fija el DEFAULT del esquema (guardrail #3/#4).
      };

      const { data: row, error } = await client
        .from("persons")
        .insert(insert)
        .select("*")
        .single<PersonRow>();

      if (error) throw new DbError(`No se pudo crear la persona: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de persona no devolvio fila.");
      return rowToPerson(row);
    },

    async listPublic(limit = 50): Promise<PublicPerson[]> {
      // SOLO la vista publica: nunca la tabla base.
      const { data, error } = await client
        .from("persons_public")
        .select(PERSON_PUBLIC_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<PersonPublicRow[]>();

      if (error) throw new DbError(`No se pudo listar personas publicas: ${error.message}`, error.code);
      return (data ?? []).map(publicRowToPublicPerson);
    },

    async getPublic(id: string): Promise<PublicPerson | null> {
      const { data, error } = await client
        .from("persons_public")
        .select(PERSON_PUBLIC_COLUMNS)
        .eq("id", id)
        .maybeSingle<PersonPublicRow>();

      if (error) throw new DbError(`No se pudo obtener persona publica: ${error.message}`, error.code);
      return data ? publicRowToPublicPerson(data) : null;
    },

    async searchPersonsPublic(query: string, zona?: string): Promise<PublicPersonResult[]> {
      // Busqueda difusa via RPC search_persons_public (lee la vista, ordena por score).
      const { data, error } = await client.rpc("search_persons_public", {
        q: query,
        zona_filtro: zona ?? null,
      });

      if (error) throw new DbError(`No se pudo buscar personas: ${error.message}`, error.code);

      // El cliente no usa tipos generados de la BD en T0.3; la RPC devuelve filas de
      // la vista persons_public + score. Se tipa explicitamente el shape conocido.
      const rows = (data ?? []) as PersonSearchRow[];
      return rows.map((row) => {
        const { score, ...publicRow } = row;
        return { ...publicRowToPublicPerson(publicRow), score };
      });
    },

    async remove(id: string): Promise<void> {
      const { error } = await client.from("persons").delete().eq("id", id);
      if (error) throw new DbError(`No se pudo borrar la persona: ${error.message}`, error.code);
    },
  };
}
