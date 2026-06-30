import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de relay_sessions.
//
// Un relay es un puente temporal de mensajes entre dos canales TRAS el doble
// consentimiento. No contiene datos de contacto en claro — solo channel_id
// (UUIDs internos). El relay se crea vía accept_consent_and_open_relay (plpgsql),
// este repo solo gestiona lecturas y cierres (guardrail #1).
//
// REVEAL BILATERAL (PR7): el revelado de contacto es un paso aparte y explícito.
// relay_sessions tiene columnas reveal_requested_a / reveal_requested_b (bool).
// El teléfono SOLO se intercambia cuando AMBAS partes lo solicitaron. Nunca antes.

/** Canal activo del relay para un canal dado. */
export interface ActiveRelay {
  /** UUID de la sesión de relay. */
  relayId: string;
  /** channel_id del otro participante (el que NO hizo la consulta). */
  otherChannelId: string;
}

/**
 * Partes del relay con sus flags de reveal y contact_id.
 * SENSIBLE: solo se lee al momento del intercambio bilateral — nunca antes.
 * Los contact_id se usan únicamente para leer el teléfono del contacto en
 * el momento exacto del reveal bilateral (guardrail #1).
 */
export interface RelayParties {
  relayId: string;
  partyAChannelId: string;
  partyBChannelId: string;
  revealRequestedA: boolean;
  revealRequestedB: boolean;
  /** contact_id de party_a (para leer su teléfono solo en el reveal bilateral). */
  partyAContactId: string;
  /** contact_id de party_b (para leer su teléfono solo en el reveal bilateral). */
  partyBContactId: string;
}

/** La parte del relay que está actuando: 'a' o 'b'. */
export type RelayPartyLabel = "a" | "b";

/** Fila mínima de relay_sessions para resolver el relay activo. */
interface RelayRow {
  id: string;
  party_a_channel_id: string;
  party_b_channel_id: string;
  state: string;
}

/** Fila de relay con flags de reveal; los contact_id se traen vía join con channels. */
interface RelayPartiesDbRow {
  id: string;
  party_a_channel_id: string;
  party_b_channel_id: string;
  reveal_requested_a: boolean;
  reveal_requested_b: boolean;
  // Supabase foreign-table join returns an array; we read [0].
  channel_a: Array<{ contact_id: string }>;
  channel_b: Array<{ contact_id: string }>;
}

export interface RelayRepo {
  /**
   * Obtiene el relay activo para un canal dado, o null si no existe.
   * Devuelve el otherChannelId para que el forwarding sepa a quién reenviar.
   * (design getActiveRelay contract: { relayId, otherChannelId } | null)
   */
  getActiveRelay(channelId: string): Promise<ActiveRelay | null>;

  /**
   * Cierra un relay (state='closed'). Llamado por /cancelar en relay o por
   * la RPC close_relays_and_delete_contact. No notifica al otro lado — eso
   * lo hace la RPC atómica o el route handler.
   */
  closeRelay(relayId: string): Promise<void>;

  /**
   * Lee las partes del relay (channel_id de cada parte, flags de reveal y
   * contact_id de cada canal) dado un relay_id. Devuelve null si no existe.
   *
   * SENSIBLE: los contact_id se leen ÚNICAMENTE para el reveal bilateral.
   * Nunca deben aparecer en payloads públicos ni antes del doble reveal.
   */
  getRelayParties(relayId: string): Promise<RelayParties | null>;

  /**
   * Marca reveal_requested_a=true o reveal_requested_b=true para un relay dado.
   * Idempotente: si ya era true, el UPDATE no tiene efecto adicional.
   * Cuando ambas son true el route handler actualiza state='contact_revealed'.
   */
  markRevealRequested(relayId: string, party: RelayPartyLabel): Promise<void>;
}

/** Crea el repositorio de relay_sessions sobre un cliente Supabase de servicio. */
export function createRelayRepo(client: DbClient): RelayRepo {
  return {
    async getActiveRelay(channelId: string): Promise<ActiveRelay | null> {
      // Busca un relay activo donde el canal sea party_a o party_b.
      // Usamos OR via filter para cubrir ambas columnas de forma legible.
      // La constraint CHECK(party_a <> party_b) garantiza que nunca ambos son iguales.
      const { data, error } = await client
        .from("relay_sessions")
        .select("id, party_a_channel_id, party_b_channel_id, state")
        .eq("state", "active")
        .or(`party_a_channel_id.eq.${channelId},party_b_channel_id.eq.${channelId}`)
        .limit(1)
        .maybeSingle<RelayRow>();

      if (error) {
        throw new DbError(`getActiveRelay falló: ${error.message}`, error.code);
      }
      if (!data) return null;

      const otherChannelId =
        data.party_a_channel_id === channelId
          ? data.party_b_channel_id
          : data.party_a_channel_id;

      return { relayId: data.id, otherChannelId };
    },

    async closeRelay(relayId: string): Promise<void> {
      const { error } = await client
        .from("relay_sessions")
        .update({ state: "closed" })
        .eq("id", relayId);

      if (error) {
        throw new DbError(`closeRelay falló: ${error.message}`, error.code);
      }
    },

    async getRelayParties(relayId: string): Promise<RelayParties | null> {
      // Lee la fila del relay con un join sobre channels para obtener los contact_id
      // de cada parte. Los contact_id son SENSIBLES y solo se usan para el reveal.
      // Supabase foreign-key join: party_a_channel_id -> channels(id).
      // Nota: el join usa el alias de FK que Supabase infiere por el nombre de columna.
      const { data, error } = await (client
        .from("relay_sessions")
        .select(`
          id,
          party_a_channel_id,
          party_b_channel_id,
          reveal_requested_a,
          reveal_requested_b,
          channel_a:party_a_channel_id(contact_id),
          channel_b:party_b_channel_id(contact_id)
        `)
        .eq("id", relayId)
        .maybeSingle() as unknown as Promise<{
        data: RelayPartiesDbRow | null;
        error: { message: string; code?: string } | null;
      }>);

      if (error) {
        throw new DbError(`getRelayParties falló: ${error.message}`, error.code);
      }
      if (!data) return null;

      const contactA = data.channel_a?.[0]?.contact_id;
      const contactB = data.channel_b?.[0]?.contact_id;

      if (!contactA || !contactB) {
        throw new DbError(
          `getRelayParties: no se pudo resolver contact_id para relay ${relayId}`,
        );
      }

      return {
        relayId: data.id,
        partyAChannelId: data.party_a_channel_id,
        partyBChannelId: data.party_b_channel_id,
        revealRequestedA: data.reveal_requested_a,
        revealRequestedB: data.reveal_requested_b,
        partyAContactId: contactA,
        partyBContactId: contactB,
      };
    },

    async markRevealRequested(
      relayId: string,
      party: RelayPartyLabel,
    ): Promise<void> {
      const column =
        party === "a" ? "reveal_requested_a" : "reveal_requested_b";

      const { error } = await client
        .from("relay_sessions")
        .update({ [column]: true })
        .eq("id", relayId);

      if (error) {
        throw new DbError(
          `markRevealRequested falló: ${error.message}`,
          error.code,
        );
      }
    },
  };
}
