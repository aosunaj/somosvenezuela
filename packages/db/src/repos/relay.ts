import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de relay_sessions.
//
// Un relay es un puente temporal de mensajes entre dos canales TRAS el doble
// consentimiento. No contiene datos de contacto en claro — solo channel_id
// (UUIDs internos). El relay se crea vía accept_consent_and_open_relay (plpgsql),
// este repo solo gestiona lecturas y cierres (guardrail #1).

/** Canal activo del relay para un canal dado. */
export interface ActiveRelay {
  /** UUID de la sesión de relay. */
  relayId: string;
  /** channel_id del otro participante (el que NO hizo la consulta). */
  otherChannelId: string;
}

/** Fila mínima de relay_sessions para resolver el relay activo. */
interface RelayRow {
  id: string;
  party_a_channel_id: string;
  party_b_channel_id: string;
  state: string;
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
  };
}
