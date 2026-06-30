import type { ConsentRepo, NotificationRepo, AuditRepo, RelayRepo } from "db";

// Servicio de respuesta a consent (accept/decline).
//
// Flujos:
//   accept:
//     - Llama a rpc accept_consent_and_open_relay.
//     - Si both_accepted: consulta getActiveRelay para confirmar que el relay
//       existe (puede ser no_op si el relay ya existía de una accept concurrente).
//       SOLO si hay relay confirmado → notificar apertura de relay (judgment-r3 item 2).
//     - Si accepted_one: confirmar al que aceptó (opcional), nada más.
//     - Si no_op: nada (idempotencia).
//   decline:
//     - NO llama a acceptConsent.
//     - Notifica al otro lado que fue declinado.
//     - Escribe audit de consent_state_change.
//
// PRIVACIDAD: ningún mensaje expone teléfonos, nombres o datos de contacto del OTRO lado.

/** Parte que responde al consent. */
export type ConsentPartyAction = "accept" | "decline";

/** Input para responder a una sesion de consentimiento. */
export interface RespondConsentInput {
  readonly consentId: string;
  readonly party: "searcher" | "registrant";
  readonly action: ConsentPartyAction;
  /** UUID del canal del buscador (para routing de notificaciones). */
  readonly searcherChannelId: string;
  /** UUID del canal del registrante. */
  readonly registrantChannelId: string;
}

/** Dependencias del servicio. */
export interface RespondConsentDeps {
  readonly consentRepo: Pick<ConsentRepo, "acceptConsent">;
  readonly notificationRepo: Pick<NotificationRepo, "create">;
  readonly auditRepo: Pick<AuditRepo, "writeConsentStateChange">;
  readonly relayRepo: Pick<RelayRepo, "getActiveRelay">;
}

/**
 * Procesa la respuesta (accept/decline) de una parte a una consent_session.
 * No lanza si hay no_op (idempotente). Lanza si el rpc falla.
 */
export async function respondConsent(
  deps: RespondConsentDeps,
  input: RespondConsentInput,
): Promise<void> {
  const { consentId, party, action, searcherChannelId, registrantChannelId } = input;
  const otherChannelId = party === "searcher" ? registrantChannelId : searcherChannelId;

  if (action === "decline") {
    // El que declina → notificar al otro que ya no sigue
    await deps.notificationRepo.create({
      channel_id: otherChannelId,
      tipo: "info",
      prioridad: "normal",
      payload: {
        mensaje: [
          "La otra parte ha declinado la conexión.",
          "Si encontrás más información, podés intentarlo de nuevo.",
        ].join("\n"),
      },
    });

    // Audit best-effort. Estado previo unificado 'pending' (judgment-r3 item 8:
    // no pending_a/pending_b; el doble opt-in lo modelan los booleans).
    await deps.auditRepo.writeConsentStateChange({
      consentId,
      previousState: "pending",
      newState: "declined",
      party,
    }).catch(() => undefined);

    return;
  }

  // action === "accept"
  const rpcResult = await deps.consentRepo.acceptConsent(consentId, party);

  if (rpcResult === "no_op") {
    // Idempotente: sesion ya resuelta, expirada, o segunda accept concurrente tardía.
    return;
  }

  if (rpcResult === "accepted_one") {
    // Solo una parte ha aceptado; el otro aún no. No hay relay. Sin notificación de relay.
    // Audit best-effort. El estado de la fila NO cambia: sigue 'pending'; solo se
    // marcó el boolean de esta parte (judgment-r3 item 8: no pending_a/pending_b).
    await deps.auditRepo.writeConsentStateChange({
      consentId,
      previousState: "pending",
      newState: "pending",
      party,
    }).catch(() => undefined);
    return;
  }

  // rpcResult === "both_accepted"
  // CRITICAL (judgment-r3 item 2): verificar que el relay realmente fue creado.
  // La función plpgsql usa ON CONFLICT DO NOTHING — el segundo accept concurrente
  // devuelve both_accepted pero NO crea el relay. Comprobar antes de notificar.
  const relay = await deps.relayRepo.getActiveRelay(searcherChannelId);

  if (!relay) {
    // both_accepted pero sin relay confirmado → no notificar apertura de relay.
    // El otro hilo que SÍ tiene el relay ya enviará la notificación.
    return;
  }

  // Relay confirmado → notificar apertura de relay a AMBAS partes.
  const relayMsg = [
    "¡Estás conectado! Podés escribirte directamente con la otra parte.",
    "Todo lo que escribas aquí se reenviará de forma segura.",
    "Para terminar la conexión, usá /cancelar.",
  ].join("\n");

  await Promise.allSettled([
    deps.notificationRepo.create({
      channel_id: searcherChannelId,
      tipo: "info",
      prioridad: "alta",
      payload: { mensaje: relayMsg },
    }),
    deps.notificationRepo.create({
      channel_id: registrantChannelId,
      tipo: "info",
      prioridad: "alta",
      payload: { mensaje: relayMsg },
    }),
  ]);

  // Audit best-effort. Estado previo unificado 'pending' (judgment-r3 item 8).
  await deps.auditRepo.writeConsentStateChange({
    consentId,
    previousState: "pending",
    newState: "both_accepted",
    party,
  }).catch(() => undefined);
}
