import {
  assertEstadoFallecidoValido,
  esMenor,
  DEFAULT_ESTADO,
  DEFAULT_FUENTE,
  DEFAULT_VERIFICACION,
  personCreateSchema,
  type OwnedPerson,
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

/** Columnas minimas para la vista del DUENO (sin contact_id ni datos de mas). */
type OwnedPersonRow = Pick<PersonRow, "id" | "nombre" | "apellidos" | "zona" | "estado">;

/** Tope de registros propios a listar (suficiente para un usuario; evita payloads enormes). */
const OWNED_LIST_LIMIT = 50;

export interface PersonRepo {
  /** ESCRITURA. Crea una persona en la tabla base. Devuelve el registro completo (interno). */
  create(input: PersonCreate): Promise<Person>;
  /** LECTURA PUBLICA. Lista personas desde la vista persons_public (sin contacto, sin menores). */
  listPublic(limit?: number): Promise<PublicPerson[]>;
  /** LECTURA PUBLICA. Obtiene una persona publica por id (null si no esta en la vista). */
  getPublic(id: string): Promise<PublicPerson | null>;
  /** LECTURA PUBLICA. Busqueda difusa (pg_trgm) por nombre/zona/descripcion, ordenada por score. */
  searchPersonsPublic(query: string, zona?: string): Promise<PublicPersonResult[]>;
  /**
   * LECTURA DEL DUENO. Lista los registros ligados a un contacto (sus propios
   * registros) para que el dueno elija cual marcar/borrar SIN pegar codigos. Lee la
   * tabla base filtrando por contact_id, pero devuelve SOLO la vista del dueno
   * (`OwnedPerson`): id + datos para reconocerlo + estado, NUNCA contact_id (guardrail
   * #1). A diferencia de la vista publica, SI incluye registros de menores: son del
   * propio dueno; nunca se expone contacto en ninguna respuesta.
   */
  listByContact(contactId: string): Promise<OwnedPerson[]>;
  /** BORRADO (derecho al olvido). Elimina la persona de la tabla base por id. */
  remove(id: string): Promise<void>;
  /**
   * RESCATADO (reporte del dueno). Marca la persona como encontrada con vida:
   * estado='encontrada_viva', verificacion='sin_verificar'. NUNCA fija 'verificada':
   * un reporte del dueno SUGIERE, no confirma (guardrail #4 / proteccion de menores).
   * La confirmacion oficial por entidad verificada es un paso aparte fuera de alcance.
   */
  markFound(id: string): Promise<void>;
  /**
   * LECTURA INTERNA (routing). Determina si una persona es menor de edad.
   * Lee la tabla base `persons` + join con `minors` (NUNCA persons_public).
   * Conservative: null edad o fila en minors → true.
   * Not-found persona → true (conservative gate).
   * (design F2 / R2-4)
   */
  isMinorById(personId: string): Promise<boolean>;
  /**
   * LECTURA INTERNA (consent). Estado de verificación de identidad de una persona.
   * Lee verification_question / verification_answer_hash de la tabla base.
   * NUNCA de persons_public (esas columnas están excluidas de la vista pública).
   * Returns null si la persona no existe.
   */
  getVerificationStatus(personId: string): Promise<VerificationStatus | null>;
}

/** Estado de verificación de identidad de una persona (para consent flow). */
export interface VerificationStatus {
  /** true si la persona tiene una pregunta de verificación configurada. */
  hasQuestion: boolean;
  /** Hash argon2id de la respuesta, o null si no hay pregunta. */
  answerHash: string | null;
}

/** Fila mínima para leer el estado de menores (tabla base + join minors). */
interface MinorCheckRow {
  id: string;
  edad: number | null;
  minors_row: { id: string } | null;
}

/** Fila mínima para leer el estado de verificación. */
interface VerificationRow {
  id: string;
  verification_question: string | null;
  verification_answer_hash: string | null;
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

    async listByContact(contactId: string): Promise<OwnedPerson[]> {
      // Tabla base filtrada por el contacto dueno, seleccionando SOLO las columnas de
      // la vista del dueno (jamas contact_id). Mas recientes primero.
      const { data, error } = await client
        .from("persons")
        .select("id, nombre, apellidos, zona, estado")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(OWNED_LIST_LIMIT)
        .returns<OwnedPersonRow[]>();

      if (error) {
        throw new DbError(`No se pudo listar los registros del dueno: ${error.message}`, error.code);
      }
      return (data ?? []).map((row) => ({
        id: row.id,
        nombre: row.nombre,
        apellidos: row.apellidos ?? null,
        zona: row.zona ?? null,
        estado: row.estado,
      }));
    },

    async remove(id: string): Promise<void> {
      const { error } = await client.from("persons").delete().eq("id", id);
      if (error) throw new DbError(`No se pudo borrar la persona: ${error.message}`, error.code);
    },

    async markFound(id: string): Promise<void> {
      // Reporte del dueno: encontrada con vida, SIN verificar. Nunca 'verificada'
      // (guardrail #4): un reporte del dueno sugiere, no confirma. No viola la
      // constraint fallecida_requiere_verificacion porque no marcamos 'fallecida'.
      // Registramos 'updated_at' para dejar rastro de CUANDO se marco (guardrail #8).
      const update: Pick<PersonRow, "estado" | "verificacion" | "updated_at"> = {
        estado: "encontrada_viva",
        verificacion: DEFAULT_VERIFICACION,
        updated_at: new Date().toISOString(),
      };
      // .select('id') nos devuelve las filas afectadas: si no matchea ninguna (la
      // persona se borro entre la autorizacion y el update, TOCTOU), data viene
      // vacio y NO debemos responder un 200 falso: lanzamos un DbError controlado.
      const { data, error } = await client
        .from("persons")
        .update(update)
        .eq("id", id)
        .select("id");
      if (error) {
        throw new DbError(`No se pudo marcar la persona como encontrada: ${error.message}`, error.code);
      }
      if (data === null || (Array.isArray(data) && data.length === 0)) {
        throw new DbError("Persona no encontrada al marcar como encontrada.");
      }
    },

    async isMinorById(personId: string): Promise<boolean> {
      // Lee la tabla BASE (nunca persons_public que excluye menores).
      // Join con minors para detectar refuerzo autoritativo.
      // Si no se encuentra la persona, retorna true (conservative gate).
      const { data, error } = await client
        .from("persons")
        .select("id, edad, minors_row:minors(id)")
        .eq("id", personId)
        .maybeSingle<MinorCheckRow>();

      if (error) {
        throw new DbError(`isMinorById falló: ${error.message}`, error.code);
      }
      if (!data) return true; // persona no encontrada → conservative

      return esMenor({
        edad: data.edad,
        tieneRefuerzoMinors: data.minors_row != null,
      });
    },

    async getVerificationStatus(personId: string): Promise<VerificationStatus | null> {
      // Lee tabla base: verification_question / verification_answer_hash.
      // Estas columnas NUNCA están en persons_public (guardrail privacy).
      const { data, error } = await client
        .from("persons")
        .select("id, verification_question, verification_answer_hash")
        .eq("id", personId)
        .maybeSingle<VerificationRow>();

      if (error) {
        throw new DbError(`getVerificationStatus falló: ${error.message}`, error.code);
      }
      if (!data) return null;

      return {
        hasQuestion: data.verification_question != null,
        answerHash: data.verification_answer_hash,
      };
    },
  };
}
