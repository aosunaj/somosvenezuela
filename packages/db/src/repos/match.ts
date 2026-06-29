import { z } from "zod";
import type { PublicPerson } from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import { publicRowToPublicPerson } from "../mappers.js";
import {
  PERSON_PUBLIC_COLUMNS,
  type MatchEstadoRevision,
  type MatchMetodo,
  type MatchRow,
  type PersonPublicRow,
} from "../types.js";

// Repositorio de coincidencias (matches). INTERNO (tabla `matches`, RLS: solo
// service_role). Espeja migrations/0001_init.sql.
//
// GUARDRAILS:
//   - #4 (la IA sugiere, los humanos confirman): los matches nacen
//     estado_revision='propuesto'. El cambio a 'confirmado'/'descartado' es una
//     accion HUMANA explicita (rutas /matches/:id/confirm|discard).
//   - #1 (privacidad): un match NO contiene PII. El contexto de revision se
//     construye con la vista persons_public (sin contact_id, sin menores) y los
//     campos publicos de la search. buscador_contact_id solo se expone al
//     backend via getConfirmContext, jamas en listados de revision.
//   - #2 (menores): el contexto de candidato se lee de persons_public, que ya
//     excluye menores; nunca de la tabla base persons.

const metodoSchema = z.enum(["exacto", "trigram", "ia"]);
const estadoRevisionSchema = z.enum(["propuesto", "confirmado", "descartado"]);

/**
 * Entrada de creacion de un match. estado_revision lo fija el DEFAULT del esquema
 * ('propuesto'): un match nace SIEMPRE como propuesta para revision humana.
 * `score` en [0,1]; `metodo` espeja el CHECK del esquema.
 */
export const matchCreateSchema = z.object({
  search_id: z.uuid(),
  person_id: z.uuid().nullable().optional(),
  pet_id: z.uuid().nullable().optional(),
  score: z.number().min(0).max(1),
  metodo: metodoSchema,
});
export type MatchCreate = z.infer<typeof matchCreateSchema>;

/** Tipo de dominio de un match (interno, sin PII). */
export interface Match {
  id: string;
  search_id: string | null;
  person_id: string | null;
  pet_id: string | null;
  score: number;
  metodo: MatchMetodo;
  estado_revision: MatchEstadoRevision;
  revisado_por: string | null;
  created_at: string;
}

/** Contexto publico de una busqueda para la revision (sin buscador_contact_id). */
export interface MatchSearchContext {
  target_nombre: string | null;
  zona: string | null;
}

/**
 * Match PROPUESTO con contexto suficiente para que un humano decida: datos
 * publicos de la busqueda + el candidato (vista publica, sin contact_id). NO
 * incluye dato de contacto de ninguna de las partes (guardrail #1).
 */
export interface MatchWithContext {
  id: string;
  score: number;
  metodo: MatchMetodo;
  created_at: string;
  search: MatchSearchContext;
  candidate: PublicPerson | null;
}

/**
 * Lo necesario para crear la notificacion al confirmar un match: a quien notificar
 * (buscador_contact_id, SENSIBLE) y por que canal (channel_id, si se resuelve).
 * Uso EXCLUSIVO del backend; nunca sale por la API.
 */
export interface MatchConfirmContext {
  matchId: string;
  searchId: string | null;
  personId: string | null;
  /** SENSIBLE: contacto del buscador, para dirigir la notificacion. */
  buscadorContactId: string | null;
  /** Canal preferente (opt_in) del buscador, si existe. */
  channelId: string | null;
}

function rowToMatch(row: MatchRow): Match {
  return {
    id: row.id,
    search_id: row.search_id,
    person_id: row.person_id,
    pet_id: row.pet_id,
    // numeric llega como number o string segun el driver: normalizamos a number.
    score: typeof row.score === "string" ? Number(row.score) : row.score,
    metodo: row.metodo,
    estado_revision: row.estado_revision,
    revisado_por: row.revisado_por,
    created_at: row.created_at,
  };
}

export interface MatchRepo {
  /**
   * ESCRITURA INTERNA. Persiste una coincidencia PROPUESTA (estado_revision lo fija
   * el DEFAULT del esquema = 'propuesto'). Solo backend.
   */
  create(input: MatchCreate): Promise<Match>;
  /**
   * LECTURA INTERNA. Lista matches 'propuesto' con contexto publico (busqueda +
   * candidato de persons_public) para la cola de revision humana. SIN PII.
   */
  listPendingWithContext(limit?: number): Promise<MatchWithContext[]>;
  /** LECTURA INTERNA. Obtiene un match por id (null si no existe). */
  getById(id: string): Promise<Match | null>;
  /**
   * ESCRITURA INTERNA. Cambia el estado de revision (confirmado/descartado) y, si
   * se indica, guarda quien lo reviso. Accion HUMANA (guardrail #4).
   */
  setEstadoRevision(
    id: string,
    estado: MatchEstadoRevision,
    revisadoPor?: string,
  ): Promise<void>;
  /**
   * LECTURA INTERNA. Resuelve a quien notificar al confirmar el match: el contacto
   * del buscador de la search y, si se puede, su canal preferente. SENSIBLE.
   */
  getConfirmContext(id: string): Promise<MatchConfirmContext | null>;
}

/** Construye el repositorio de matches sobre un cliente Supabase de servicio. */
export function createMatchRepo(client: DbClient): MatchRepo {
  /** Lee el contexto publico de una busqueda (sin buscador_contact_id). */
  async function readSearchContext(
    searchId: string,
  ): Promise<MatchSearchContext | null> {
    const { data, error } = await client
      .from("searches")
      .select("target_nombre, zona")
      .eq("id", searchId)
      .maybeSingle<MatchSearchContext>();
    if (error) {
      throw new DbError(`No se pudo leer la busqueda del match: ${error.message}`, error.code);
    }
    return data ?? null;
  }

  /** Lee el candidato como vista publica (sin contact_id, sin menores). */
  async function readPublicCandidate(
    personId: string,
  ): Promise<PublicPerson | null> {
    const { data, error } = await client
      .from("persons_public")
      .select(PERSON_PUBLIC_COLUMNS)
      .eq("id", personId)
      .maybeSingle<PersonPublicRow>();
    if (error) {
      throw new DbError(`No se pudo leer el candidato del match: ${error.message}`, error.code);
    }
    return data ? publicRowToPublicPerson(data) : null;
  }

  return {
    async create(input: MatchCreate): Promise<Match> {
      const data = matchCreateSchema.parse(input);
      const insert = {
        search_id: data.search_id,
        person_id: data.person_id ?? null,
        pet_id: data.pet_id ?? null,
        score: data.score,
        metodo: data.metodo,
        // estado_revision lo fija el DEFAULT del esquema ('propuesto', guardrail #4).
      };

      const { data: row, error } = await client
        .from("matches")
        .insert(insert)
        .select("*")
        .single<MatchRow>();

      if (error) throw new DbError(`No se pudo crear el match: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de match no devolvio fila.");
      return rowToMatch(row);
    },

    async listPendingWithContext(limit = 50): Promise<MatchWithContext[]> {
      const { data, error } = await client
        .from("matches")
        .select("*")
        .eq("estado_revision", "propuesto")
        // Mayor score primero (mas probable); a igualdad, los mas antiguos antes.
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(limit)
        .returns<MatchRow[]>();

      if (error) throw new DbError(`No se pudieron listar matches: ${error.message}`, error.code);

      const rows = (data ?? []).map(rowToMatch);
      // Enriquecemos cada match con contexto PUBLICO (busqueda + candidato). El
      // candidato sale de persons_public, asi que un menor nunca aparece aqui.
      const out: MatchWithContext[] = [];
      for (const match of rows) {
        const search = match.search_id !== null ? await readSearchContext(match.search_id) : null;
        const candidate = match.person_id !== null ? await readPublicCandidate(match.person_id) : null;
        out.push({
          id: match.id,
          score: match.score,
          metodo: match.metodo,
          created_at: match.created_at,
          search: search ?? { target_nombre: null, zona: null },
          candidate,
        });
      }
      return out;
    },

    async getById(id: string): Promise<Match | null> {
      const { data, error } = await client
        .from("matches")
        .select("*")
        .eq("id", id)
        .maybeSingle<MatchRow>();

      if (error) throw new DbError(`No se pudo obtener el match: ${error.message}`, error.code);
      return data ? rowToMatch(data) : null;
    },

    async setEstadoRevision(
      id: string,
      estado: MatchEstadoRevision,
      revisadoPor?: string,
    ): Promise<void> {
      const estadoValidado = estadoRevisionSchema.parse(estado);
      const update: { estado_revision: MatchEstadoRevision; revisado_por?: string } = {
        estado_revision: estadoValidado,
      };
      if (revisadoPor !== undefined) update.revisado_por = revisadoPor;

      const { error } = await client
        .from("matches")
        .update(update)
        .eq("id", id);
      if (error) throw new DbError(`No se pudo actualizar el match: ${error.message}`, error.code);
    },

    async getConfirmContext(id: string): Promise<MatchConfirmContext | null> {
      const match = await this.getById(id);
      if (match === null) return null;

      let buscadorContactId: string | null = null;
      if (match.search_id !== null) {
        // Lee el contacto SENSIBLE del buscador (solo backend) para dirigir el aviso.
        const { data, error } = await client
          .from("searches")
          .select("buscador_contact_id")
          .eq("id", match.search_id)
          .maybeSingle<{ buscador_contact_id: string | null }>();
        if (error) {
          throw new DbError(`No se pudo resolver el buscador del match: ${error.message}`, error.code);
        }
        buscadorContactId = data?.buscador_contact_id ?? null;
      }

      let channelId: string | null = null;
      if (buscadorContactId !== null) {
        // Canal preferente (opt_in) del buscador para entregar la notificacion.
        const { data, error } = await client
          .from("channels")
          .select("id")
          .eq("contact_id", buscadorContactId)
          .eq("opt_in", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle<{ id: string }>();
        if (error) {
          throw new DbError(`No se pudo resolver el canal del buscador: ${error.message}`, error.code);
        }
        channelId = data?.id ?? null;
      }

      return {
        matchId: match.id,
        searchId: match.search_id,
        personId: match.person_id,
        buscadorContactId,
        channelId,
      };
    },
  };
}
