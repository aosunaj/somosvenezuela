import type { NotificationRepo } from "db";

// Tarea standalone de sweep de consent_sessions expiradas (judgment-r3 item 11).
//
// DECISION (judgment-r3 item 11): sweepExpiredConsents es una tarea STANDALONE del
// backend, registrada via setInterval en el boot de Fastify. NO depende del poller
// de Telegram ni de ninguna otra plataforma.
//
// Comportamiento:
//   1. Obtiene las consent_sessions con state = 'pending' y
//      expires_at < now() (via getExpiredPendingConsents). 'pending' es el unico
//      estado no terminal (judgment-r3 item 8: no pending_a/pending_b).
//   2. Para cada sesion expirada:
//      a. Marca la sesion como 'expired' (markConsentExpired).
//      b. Encola avisos de expiracion a ambas partes (searcher y registrant)
//         via notificationRepo.create.
//   3. Es IDEMPOTENTE: si no hay sesiones expiradas, devuelve swept=0.
//      Correr dos veces en el mismo estado produce el mismo resultado.
//   4. Es BEST-EFFORT: si una sesion falla al marcar/notificar, continua con las
//      demas. No lanza al caller.
//   5. No hay auto-connect tras expiracion (F8 del design).

/** Sesion expirada minima para el sweep. */
export interface ExpiredConsentSession {
  readonly id: string;
  readonly searcherChannelId: string;
  readonly registrantChannelId: string;
}

/** Dependencias del servicio de sweep. */
export interface SweepExpiredConsentsDeps {
  readonly notificationRepo: Pick<NotificationRepo, "create">;
  /**
   * Obtiene las consent_sessions expiradas y pendientes.
   * En produccion, ejecuta:
   *   SELECT id, searcher_channel_id, registrant_channel_id
   *   FROM consent_sessions
   *   WHERE state = 'pending' AND expires_at < now()
   */
  getExpiredPendingConsents(): Promise<ExpiredConsentSession[]>;
  /**
   * Marca una consent_session como 'expired'.
   * En produccion: UPDATE consent_sessions SET state='expired' WHERE id=...
   */
  markConsentExpired(consentId: string): Promise<void>;
}

/** Resultado del sweep. */
export interface SweepResult {
  /** Numero de sesiones barridas (marcadas como expiradas + notificadas). */
  readonly swept: number;
}

/**
 * Barre las consent_sessions expiradas, las marca y encola avisos de expiracion.
 *
 * Idempotente: si no hay sesiones expiradas, swept=0.
 * Best-effort: un error en una sesion no bloquea las demas.
 * Standalone: no depende del poller de Telegram.
 */
export async function sweepExpiredConsents(
  deps: SweepExpiredConsentsDeps,
): Promise<SweepResult> {
  const expiredSessions = await deps.getExpiredPendingConsents();

  let swept = 0;

  for (const session of expiredSessions) {
    try {
      // 1. Marcar como expirada
      await deps.markConsentExpired(session.id);

      // 2. Encolar avisos de expiracion a ambas partes
      // Mensajes seguros: sin PII, sin datos de contacto del otro lado
      const expiryMsg = [
        "La sesion de contacto ha expirado por inactividad.",
        "Si queres intentarlo de nuevo, podes iniciar una nueva busqueda.",
      ].join("\n");

      await Promise.allSettled([
        deps.notificationRepo.create({
          channel_id: session.searcherChannelId,
          tipo: "info",
          prioridad: "normal",
          payload: { mensaje: expiryMsg },
        }),
        deps.notificationRepo.create({
          channel_id: session.registrantChannelId,
          tipo: "info",
          prioridad: "normal",
          payload: { mensaje: expiryMsg },
        }),
      ]);

      swept++;
    } catch {
      // Best-effort: si falla una sesion, continuamos con las demas
      // TODO: emit monitoring metric here
    }
  }

  return { swept };
}
