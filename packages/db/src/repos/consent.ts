import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de consentimiento bilateral y relay de contacto.
//
// Todas las operaciones atómicas sensibles (abrir relay, cerrar relay + borrar
// contacto, anonimizar auditoría) se ejecutan via plpgsql functions (`rpc()`) para
// garantizar atomicidad real en una sola transacción de BD (R2-1). El cliente
// supabase-js no puede abrir transacciones multi-sentencia directamente.
//
// PRIVACIDAD (guardrail #1): este repositorio NUNCA expone números de teléfono
// ni PII. Los channel_id son UUIDs internos; el contacto en claro solo viaja
// en la notificación punto a punto tras el doble consentimiento.

// ── Tipos públicos ──────────────────────────────────────────────────────────

/** Resultado de la llamada a accept_consent_and_open_relay. */
export type ConsentRpcResult = "both_accepted" | "accepted_one" | "no_op";

/** Fila devuelta por close_relays_and_delete_contact (RETURNS TABLE). */
export interface CloseRelayRow {
  relay_id: string;
  other_channel_id: string;
}

/** Parte que está aceptando el consentimiento. */
export type ConsentParty = "searcher" | "registrant";

// ── Interfaz del repositorio ────────────────────────────────────────────────

/** Input para crear una consent_session. */
export interface OpenConsentSessionInput {
  readonly matchId: string;
  readonly searcherChannelId: string;
  readonly registrantChannelId: string;
  /** Expiry in hours. Defaults to 72 if not provided. */
  readonly ttlHours?: number;
}

/**
 * Minimum expired consent session shape returned by getExpiredPendingConsents.
 * Used by sweepExpiredConsents (judgment-r3 item 11).
 */
export interface ExpiredConsentSession {
  readonly id: string;
  readonly searcherChannelId: string;
  readonly registrantChannelId: string;
}

export interface ConsentRepo {
  /**
   * Crea una nueva consent_session para el match dado.
   * Retorna el id de la sesion creada.
   * Esto NO usa plpgsql: la creacion es una escritura simple INSERT
   * (la atomicidad del doble opt-in la gestiona accept_consent_and_open_relay).
   */
  openConsentSession(input: OpenConsentSessionInput): Promise<string>;

  /**
   * Llama a accept_consent_and_open_relay(p_consent_id, p_party).
   *
   * La función plpgsql ejecuta en una sola transacción:
   *   - Marca la parte como aceptada (searcher_accepted / registrant_accepted).
   *   - Si ambas aceptaron: crea el relay con ON CONFLICT DO NOTHING.
   *   - Si la sesión expiró, ya está resuelta, o el segundo accept concurrente
   *     llega tarde: devuelve 'no_op'.
   *
   * judgment-r3 items 6 y 8: SQL dinámico usa %I; estado = 'pending' + booleans.
   *
   * @returns ConsentRpcResult — el backend notifica solo si 'both_accepted'.
   */
  acceptConsent(consentId: string, party: ConsentParty): Promise<ConsentRpcResult>;

  /**
   * Llama a close_relays_and_delete_contact(p_contact_id).
   *
   * La función plpgsql (R2-1b) atomically:
   *   1. Busca relays activos del contacto.
   *   2. Para cada relay: cierra (state='closed') e inserta notificación al otro lado.
   *   3. Anonimiza las filas de auditoría (NULL en contact_id columns).
   *   4. Borra el contacto (cascade: channels, consent_sessions, relay_sessions).
   *
   * Returns the closed relay rows so the caller knows whom was notified
   * (judgment-r3 item 7: RETURNS TABLE(relay_id uuid, other_channel_id uuid)).
   *
   * NOTE: deletePersonAndOwner in secure-delete.ts must call this AFTER deleting
   * the person row (persons.contact_id is SET NULL, not CASCADE).
   */
  closeRelaysAndDeleteContact(contactId: string): Promise<CloseRelayRow[]>;

  /**
   * Anonymizes the contact_id columns of an auto_connection_audit row.
   * Allowed by the partial immutability trigger (R2-3): only contact_id nulling
   * is permitted; any structural update is blocked by the trigger.
   *
   * In normal operations this is called INSIDE close_relays_and_delete_contact
   * (atomically). This app-layer method is exposed for edge-case manual erasure.
   */
  anonymizeAuditContact(auditRowId: string): Promise<void>;

  /**
   * Returns consent_sessions where state IN ('pending_a','pending_b') AND
   * expires_at < now(). Used by sweepExpiredConsents (judgment-r3 item 11).
   *
   * Returns only the fields needed by the sweep: id, searcher_channel_id,
   * registrant_channel_id (both camelCase in the return type).
   */
  getExpiredPendingConsents(): Promise<ExpiredConsentSession[]>;

  /**
   * Sets state='expired' for the given consent_session id.
   * Called by sweepExpiredConsents after collecting expired sessions.
   * Best-effort: the sweep catches per-session errors and continues.
   */
  markConsentExpired(consentId: string): Promise<void>;
}

// ── Implementación ──────────────────────────────────────────────────────────

/** Creates the consent/relay repository bound to a Supabase service client. */
export function createConsentRepo(client: DbClient): ConsentRepo {
  return {
    async openConsentSession(input: OpenConsentSessionInput): Promise<string> {
      const ttlHours = input.ttlHours ?? 72;
      const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();

      const { data, error } = await client
        .from("consent_sessions")
        .insert({
          match_id: input.matchId,
          searcher_channel_id: input.searcherChannelId,
          registrant_channel_id: input.registrantChannelId,
          state: "pending_a",
          searcher_accepted: false,
          registrant_accepted: false,
          expires_at: expiresAt,
        })
        .select("id")
        .single<{ id: string }>();

      if (error) {
        throw new DbError(`openConsentSession falló: ${error.message}`, error.code);
      }
      if (!data) {
        throw new DbError("openConsentSession: INSERT no devolvió fila.");
      }
      return data.id;
    },

    async acceptConsent(
      consentId: string,
      party: ConsentParty,
    ): Promise<ConsentRpcResult> {
      const { data, error } = await (client
        .rpc("accept_consent_and_open_relay", {
          p_consent_id: consentId,
          p_party: party,
        })
        .select() as unknown as Promise<{ data: Array<{ result: string }>; error: { message: string; code?: string } | null }>);

      if (error) {
        throw new DbError(`accept_consent_and_open_relay falló: ${error.message}`, error.code);
      }

      const result = data?.[0]?.result as ConsentRpcResult | undefined;
      if (!result) {
        throw new DbError("accept_consent_and_open_relay: respuesta vacía de la BD");
      }

      return result;
    },

    async closeRelaysAndDeleteContact(contactId: string): Promise<CloseRelayRow[]> {
      const { data, error } = await (client
        .rpc("close_relays_and_delete_contact", {
          p_contact_id: contactId,
        })
        .select() as unknown as Promise<{ data: CloseRelayRow[] | null; error: { message: string; code?: string } | null }>);

      if (error) {
        throw new DbError(
          `close_relays_and_delete_contact falló: ${error.message}`,
          error.code,
        );
      }

      return data ?? [];
    },

    async anonymizeAuditContact(auditRowId: string): Promise<void> {
      // Partial-trigger-safe update: ONLY nulls the two contact_id columns.
      // Any other column change would be rejected by auto_connection_audit_guard().
      const { error } = await client
        .from("auto_connection_audit")
        .update({
          searcher_contact_id: null,
          registrant_contact_id: null,
        })
        .eq("id", auditRowId);

      if (error) {
        throw new DbError(`anonymizeAuditContact falló: ${error.message}`, error.code);
      }
    },

    async getExpiredPendingConsents(): Promise<ExpiredConsentSession[]> {
      // SELECT id, searcher_channel_id, registrant_channel_id
      // FROM consent_sessions
      // WHERE state IN ('pending_a','pending_b') AND expires_at < now()
      //
      // NOTE: we pass now() as a string because supabase-js's .lt() takes a value
      // comparable to the column type; ISO timestamp works for timestamptz.
      const now = new Date().toISOString();
      const { data, error } = await (client
        .from("consent_sessions")
        .select("id, searcher_channel_id, registrant_channel_id")
        .in("state", ["pending_a", "pending_b"])
        .lt("expires_at", now) as unknown as Promise<{
        data: Array<{
          id: string;
          searcher_channel_id: string;
          registrant_channel_id: string;
        }> | null;
        error: { message: string; code?: string } | null;
      }>);

      if (error) {
        throw new DbError(`getExpiredPendingConsents falló: ${error.message}`, error.code);
      }

      return (data ?? []).map((row) => ({
        id: row.id,
        searcherChannelId: row.searcher_channel_id,
        registrantChannelId: row.registrant_channel_id,
      }));
    },

    async markConsentExpired(consentId: string): Promise<void> {
      // UPDATE consent_sessions SET state='expired' WHERE id=consentId
      const { error } = await (client
        .from("consent_sessions")
        .update({ state: "expired" })
        .eq("id", consentId) as unknown as Promise<{
        data: null;
        error: { message: string; code?: string } | null;
      }>);

      if (error) {
        throw new DbError(`markConsentExpired falló: ${error.message}`, error.code);
      }
    },
  };
}
