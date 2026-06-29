import { z } from "zod";
import type { PublicPerson } from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import { publicRowToPublicPerson } from "../mappers.js";
import {
  PERSON_PUBLIC_COLUMNS,
  type ConsentimientoEstado,
  type MatchEstadoRevision,
  type MatchMetodo,
  type MatchRow,
  type PersonPublicRow,
  type ReunionEstado,
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
const consentimientoEstadoSchema = z.enum([
  "sin_solicitar",
  "solicitado",
  "aceptado",
  "rechazado",
]);

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
  /** Consentimiento de quien busca (reencuentro bilateral, migrations/0006). */
  consentimiento_buscador: ConsentimientoEstado;
  /** Consentimiento de quien registro a la persona (migrations/0006). */
  consentimiento_registrante: ConsentimientoEstado;
  /** Estado del reencuentro del match (migrations/0006). */
  reunion_estado: ReunionEstado;
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

// ── Reencuentro: consentimiento bilateral (migrations/0006) ──────────────────
//
// El flujo de reencuentro NO comparte contacto hasta que AMBAS partes aceptan. Estos
// tipos modelan el resultado de cada paso SIN exponer PII de contacto: los telefonos
// solo aparecen en `ReunionExchange`, que la ruta usa SOLO dentro del intercambio
// final (doble aceptado) para armar la notificacion punto a punto.

/** Direccion de transporte de una parte: a quien notificar y por que canal. SENSIBLE. */
export interface ReunionParteContacto {
  /** Contacto (contacts.id) de la parte. SENSIBLE. */
  contactId: string;
  /** Canal preferente (opt_in) de la parte, si se resuelve. */
  channelId: string | null;
  /** Telefono en claro de la parte. SENSIBLE: SOLO para el intercambio final. */
  telefono: string | null;
}

/**
 * Resultado de iniciar un reencuentro (consentimiento del buscador). Discrimina por
 * `outcome` para que la ruta no tenga que interpretar estados sueltos:
 *   - 'not_found'      : no hay un match del buscador con esa persona.
 *   - 'minor_blocked'  : la persona es menor; el caso no se conecta automaticamente
 *                        (guardrail #2 antitrata). NO se solicita nada.
 *   - 'requested'      : se registro el consentimiento del buscador y se solicito al
 *                        registrante. `registrante` dice a quien avisar (sin telefono).
 */
export type RequestReunionResult =
  | { readonly outcome: "not_found" }
  | { readonly outcome: "minor_blocked" }
  // El reencuentro ya estaba gestionado (cerrado por rechazo/intercambio o ya en
  // curso): NO se reabre ni se re-notifica. Un "no" del registrante queda firme.
  | { readonly outcome: "already_handled" }
  | {
      readonly outcome: "requested";
      readonly matchId: string;
      /** Direccion de transporte del registrante (SIN telefono: aun no se comparte). */
      readonly registrante: { readonly contactId: string; readonly channelId: string | null };
    };

/**
 * Resultado de la respuesta del registrante (/conectar | /rechazar). Discrimina por
 * `outcome`:
 *   - 'not_found' : no hay una solicitud pendiente para ese registrante.
 *   - 'rejected'  : el registrante rechazo; se cierra sin compartir. `buscador` dice
 *                   a quien avisar amablemente (SIN telefono).
 *   - 'exchanged' : AMBOS aceptaron; `exchange` lleva el contacto de cada parte para
 *                   la notificacion punto a punto. UNICO punto donde viaja el telefono.
 *   - 'accepted_waiting' : el registrante acepto pero (caso anomalo) el buscador ya no
 *                   figura como aceptado; no se intercambia. Defensa en profundidad.
 */
export type ReunionConsentResult =
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "rejected";
      readonly matchId: string;
      readonly buscador: { readonly contactId: string | null; readonly channelId: string | null };
    }
  | {
      readonly outcome: "exchanged";
      readonly matchId: string;
      readonly buscador: ReunionParteContacto;
      readonly registrante: ReunionParteContacto;
    }
  | { readonly outcome: "accepted_waiting"; readonly matchId: string };

/** Decision del registrante ante la solicitud de reencuentro. */
export type ReunionDecision = "aceptado" | "rechazado";

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
    // Consentimiento bilateral (0006). Tolerante a filas previas a la migracion:
    // si el campo no viene, asumimos el DEFAULT del esquema.
    consentimiento_buscador: row.consentimiento_buscador ?? "sin_solicitar",
    consentimiento_registrante: row.consentimiento_registrante ?? "sin_solicitar",
    reunion_estado: row.reunion_estado ?? "inactiva",
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
  /**
   * REENCUENTRO (0006). El BUSCADOR (identificado por su contacto) inicia el
   * reencuentro con una PERSONA candidata. Resuelve el match buscador<->persona, aplica
   * el GATE DE MENORES (si la persona es menor, no se conecta automaticamente) y, si
   * procede, registra el consentimiento del buscador ('aceptado') y solicita el del
   * registrante ('solicitado'), dejando reunion_estado='pendiente'. Devuelve a quien
   * avisar (el registrante) SIN telefono: el contacto solo se comparte tras el doble si.
   */
  requestReunion(input: RequestReunionInput): Promise<RequestReunionResult>;
  /**
   * REENCUENTRO (0006). El REGISTRANTE (identificado por su contacto) responde a la
   * solicitud PENDIENTE: 'aceptado' o 'rechazado'. Correlaciona por el contacto del
   * registrante (person.contact_id) sobre los matches con consentimiento_registrante=
   * 'solicitado'. Si AMBOS quedan 'aceptado', marca reunion_estado='intercambiado' y
   * devuelve el contacto de cada parte (con telefono) para la notificacion punto a
   * punto. Si rechaza, marca 'rechazada' y devuelve a quien avisar (sin telefono).
   */
  respondReunion(input: RespondReunionInput): Promise<ReunionConsentResult>;
}

/** Entrada de `requestReunion`: el buscador (por contacto) elige una persona. */
export interface RequestReunionInput {
  /** Contacto del buscador (resuelto desde su canal). SENSIBLE. */
  buscadorContactId: string;
  /** Persona candidata elegida por el buscador. */
  personId: string;
}

/** Entrada de `respondReunion`: el registrante (por contacto) acepta o rechaza. */
export interface RespondReunionInput {
  /** Contacto del registrante (resuelto desde su canal). SENSIBLE. */
  registranteContactId: string;
  /** Decision del registrante. */
  decision: ReunionDecision;
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

  // ── Helpers del reencuentro (0006) ─────────────────────────────────────────

  /** Datos minimos de una persona para el reencuentro: contacto + edad (gate menores). */
  interface PersonReunionRow {
    edad: number | null;
    contact_id: string | null;
  }

  /**
   * Lee de la TABLA BASE `persons` SOLO edad + contact_id de una persona. Se usa para
   * (a) el GATE DE MENORES por edad y (b) resolver al registrante (contact_id). Es el
   * unico acceso a la tabla base aqui y queda acotado a estas dos columnas; el resto
   * del repo usa persons_public. Devuelve null si la persona no existe.
   */
  async function readPersonReunion(personId: string): Promise<PersonReunionRow | null> {
    const { data, error } = await client
      .from("persons")
      .select("edad, contact_id")
      .eq("id", personId)
      .maybeSingle<PersonReunionRow>();
    if (error) {
      throw new DbError(`No se pudo leer la persona del reencuentro: ${error.message}`, error.code);
    }
    return data ?? null;
  }

  /**
   * GATE DE MENORES (guardrail #2 antitrata). Una persona es menor si edad<18 O tiene
   * fila en `minors` (marca de refuerzo). Defensa en profundidad sobre persons_public,
   * que ya los excluye: aqui leemos la tabla base, asi que verificamos AMBAS condiciones
   * explicitamente antes de iniciar cualquier intercambio.
   */
  async function isMinor(personId: string, edad: number | null): Promise<boolean> {
    if (edad !== null && edad < 18) return true;
    const { data, error } = await client
      .from("minors")
      .select("id")
      .eq("person_id", personId)
      .maybeSingle<{ id: string }>();
    if (error) {
      throw new DbError(`No se pudo comprobar refuerzo de menor: ${error.message}`, error.code);
    }
    return data !== null;
  }

  /** Canal preferente (opt_in, mas antiguo) de un contacto, o null. */
  async function preferredChannelId(contactId: string): Promise<string | null> {
    const { data, error } = await client
      .from("channels")
      .select("id")
      .eq("contact_id", contactId)
      .eq("opt_in", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (error) {
      throw new DbError(`No se pudo resolver el canal del contacto: ${error.message}`, error.code);
    }
    return data?.id ?? null;
  }

  /** Telefono en claro de un contacto, o null. SENSIBLE: solo para el intercambio final. */
  async function readTelefono(contactId: string): Promise<string | null> {
    const { data, error } = await client
      .from("contacts")
      .select("telefono")
      .eq("id", contactId)
      .maybeSingle<{ telefono: string | null }>();
    if (error) {
      throw new DbError(`No se pudo leer el contacto del reencuentro: ${error.message}`, error.code);
    }
    return data?.telefono ?? null;
  }

  /** Resuelve la direccion de transporte + telefono de una parte (para el intercambio). */
  async function readParteContacto(contactId: string): Promise<ReunionParteContacto> {
    const [channelId, telefono] = await Promise.all([
      preferredChannelId(contactId),
      readTelefono(contactId),
    ]);
    return { contactId, channelId, telefono };
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

    async requestReunion(input: RequestReunionInput): Promise<RequestReunionResult> {
      const { buscadorContactId, personId } = input;

      // 1) GATE DE MENORES (guardrail #2) ANTES de tocar nada. Si la persona no existe
      //    tratamos como not_found; si es menor, no se conecta automaticamente.
      const persona = await readPersonReunion(personId);
      if (persona === null) return { outcome: "not_found" };
      if (await isMinor(personId, persona.edad)) return { outcome: "minor_blocked" };

      // 2) Resuelve el match que une a ESTE buscador con ESTA persona: el match cuya
      //    search pertenece al contacto del buscador. Un inner join via PostgREST con
      //    `searches!inner` filtra por buscador_contact_id sin traer ese campo a la
      //    aplicacion. Tomamos el mas reciente (la busqueda viva del buscador).
      const { data, error } = await client
        .from("matches")
        .select("id, searches!inner(buscador_contact_id)")
        .eq("person_id", personId)
        .eq("searches.buscador_contact_id", buscadorContactId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (error) {
        throw new DbError(`No se pudo resolver el match del reencuentro: ${error.message}`, error.code);
      }
      if (data === null) return { outcome: "not_found" };
      const matchId = data.id;

      // 3) Registra el consentimiento SINCRONO del buscador ('aceptado') y SOLICITA el
      //    del registrante ('solicitado'); el reencuentro queda 'pendiente'. El contacto
      //    NO se comparte aqui: solo dejamos a quien avisar (sin telefono).
      //
      //    GUARDA (un "NO" queda firme): la UPDATE SOLO dispara si el reencuentro esta
      //    en su estado inicial ('inactiva'). Asi re-pedir NUNCA reabre un match ya
      //    'rechazada', 'intercambiado' o 'pendiente': la condicion no matchea ninguna
      //    fila y .select('id') devuelve vacio. La decision del registrante (incluido
      //    su "no") es definitiva y no se sobrescribe con una nueva solicitud.
      const { data: updated, error: updError } = await client
        .from("matches")
        .update({
          consentimiento_buscador: "aceptado",
          consentimiento_registrante: "solicitado",
          reunion_estado: "pendiente",
        })
        .eq("id", matchId)
        .eq("reunion_estado", "inactiva")
        .select("id");
      if (updError) {
        throw new DbError(`No se pudo iniciar el reencuentro: ${updError.message}`, updError.code);
      }
      // 0 filas afectadas: el reencuentro NO estaba 'inactiva' (ya cerrado o en curso).
      // No reabrimos ni re-notificamos: devolvemos un resultado claro de "ya gestionado".
      if (updated === null || (Array.isArray(updated) && updated.length === 0)) {
        return { outcome: "already_handled" };
      }

      // 4) A quien avisar: el registrante (persons.contact_id de la persona elegida).
      //    Sin telefono: el contacto solo viaja tras el doble si.
      const registranteContactId = persona.contact_id;
      const channelId =
        registranteContactId !== null ? await preferredChannelId(registranteContactId) : null;

      return {
        outcome: "requested",
        matchId,
        registrante: { contactId: registranteContactId ?? "", channelId },
      };
    },

    async respondReunion(input: RespondReunionInput): Promise<ReunionConsentResult> {
      const decision = consentimientoEstadoSchema
        .extract(["aceptado", "rechazado"])
        .parse(input.decision);
      const { registranteContactId } = input;

      // 1) Correlaciona la solicitud PENDIENTE de este registrante: el match con
      //    consentimiento_registrante='solicitado' cuya persona pertenece a su contacto.
      //    `persons!inner` filtra por persons.contact_id sin traerlo a la aplicacion.
      //    Tomamos el mas reciente si hubiera varios.
      const { data, error } = await client
        .from("matches")
        .select("id, consentimiento_buscador, persons!inner(contact_id)")
        .eq("consentimiento_registrante", "solicitado")
        .eq("persons.contact_id", registranteContactId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; consentimiento_buscador: ConsentimientoEstado }>();
      if (error) {
        throw new DbError(`No se pudo resolver la solicitud de reencuentro: ${error.message}`, error.code);
      }
      if (data === null) return { outcome: "not_found" };
      const matchId = data.id;

      // 2) RECHAZO: cierra el reencuentro sin compartir NADA y avisa al buscador.
      //    GUARDA (idempotencia / carrera): la UPDATE SOLO actua sobre una solicitud aun
      //    'solicitado'. Si otra llamada ya la resolvio (acepto o rechazo), .select
      //    devuelve vacio y NO re-notificamos: la primera respuesta gana.
      if (decision === "rechazado") {
        const { data: rejected, error: rejError } = await client
          .from("matches")
          .update({ consentimiento_registrante: "rechazado", reunion_estado: "rechazada" })
          .eq("id", matchId)
          .eq("consentimiento_registrante", "solicitado")
          .select("id");
        if (rejError) {
          throw new DbError(`No se pudo registrar el rechazo: ${rejError.message}`, rejError.code);
        }
        if (rejected === null || (Array.isArray(rejected) && rejected.length === 0)) {
          // Otra llamada concurrente ya gestiono esta solicitud: no la re-procesamos.
          return { outcome: "not_found" };
        }
        const ctx = await this.getConfirmContext(matchId);
        return {
          outcome: "rejected",
          matchId,
          buscador: {
            contactId: ctx?.buscadorContactId ?? null,
            channelId: ctx?.channelId ?? null,
          },
        };
      }

      // 3) ACEPTACION del registrante. Marca su consentimiento de forma ATOMICA e
      //    IDEMPOTENTE: la UPDATE SOLO matchea si el registrante seguia en 'solicitado'.
      //    Dos /conectar concurrentes: solo el PRIMERO afecta una fila; el segundo
      //    obtiene 0 filas y para aqui (no avanza al intercambio). Asi el telefono se
      //    entrega UNA sola vez. Reusar la respuesta del primero seria 'exchanged', pero
      //    como ya se proceso, el segundo no debe re-entregar: devolvemos accepted_waiting.
      const { data: accepted, error: accError } = await client
        .from("matches")
        .update({ consentimiento_registrante: "aceptado" })
        .eq("id", matchId)
        .eq("consentimiento_registrante", "solicitado")
        .select("id");
      if (accError) {
        throw new DbError(`No se pudo registrar la aceptacion: ${accError.message}`, accError.code);
      }
      if (accepted === null || (Array.isArray(accepted) && accepted.length === 0)) {
        // Otra llamada ya tomo la solicitud: no avanzamos al intercambio (no re-entregar).
        return { outcome: "accepted_waiting", matchId };
      }

      // 4) DEFENSA EN PROFUNDIDAD: el intercambio EXIGE que el buscador tambien este
      //    'aceptado'. Si por cualquier anomalia no lo esta, NO compartimos contacto.
      if (data.consentimiento_buscador !== "aceptado") {
        return { outcome: "accepted_waiting", matchId };
      }

      // 5) DOBLE SI: marca 'intercambiado' y resuelve el contacto de cada parte. Este
      //    es el UNICO punto donde se leen los telefonos para compartirlos punto a punto.
      //    GUARDA (carrera): la transicion a 'intercambiado' SOLO ocurre desde
      //    'pendiente'. Si otra llamada ya intercambio, .select devuelve vacio y NO
      //    leemos telefonos ni los entregamos por segunda vez (entrega "exactamente una").
      const { data: exchangedRows, error: exError } = await client
        .from("matches")
        .update({ reunion_estado: "intercambiado" })
        .eq("id", matchId)
        .eq("reunion_estado", "pendiente")
        .select("id");
      if (exError) {
        throw new DbError(`No se pudo completar el intercambio: ${exError.message}`, exError.code);
      }
      if (exchangedRows === null || (Array.isArray(exchangedRows) && exchangedRows.length === 0)) {
        // El reencuentro ya no estaba 'pendiente' (otra llamada lo intercambio): NO
        // leemos ni entregamos contacto otra vez. El telefono se entrego una sola vez.
        return { outcome: "accepted_waiting", matchId };
      }

      const ctx = await this.getConfirmContext(matchId);
      const buscadorContactId = ctx?.buscadorContactId ?? null;
      // El registrante es quien acaba de responder: su contacto es el de entrada.
      const [buscador, registrante] = await Promise.all([
        buscadorContactId !== null
          ? readParteContacto(buscadorContactId)
          : Promise.resolve<ReunionParteContacto>({ contactId: "", channelId: null, telefono: null }),
        readParteContacto(registranteContactId),
      ]);

      return { outcome: "exchanged", matchId, buscador, registrante };
    },
  };
}
