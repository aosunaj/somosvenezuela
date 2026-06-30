import type { ConsentRepo, NotificationRepo } from "db";

// Servicio de auto-notify: abre una consent_session y encola notificaciones
// bilaterales al buscador y al registrante.
//
// PRIVACIDAD (guardrail #1): NUNCA incluye PII en los mensajes.
// El consent_id viaja en el mensaje para que la parte pueda responder (/aceptar o /rechazar).
// El channel_id del OTRO lado NUNCA se expone en el payload de notificacion.
//
// Las notificaciones se encolan via NotificationRepo.create (tabla notifications);
// el poller de cada bot las recoge y las envía.

/** Datos del match necesarios para abrir la sesion de consentimiento. */
export interface MatchForAutoNotify {
  readonly matchId: string;
  readonly searchId: string;
  readonly personId: string;
  /** UUID interno del canal del buscador (nunca el chat_id real). */
  readonly searcherChannelId: string;
  /** UUID interno del canal del registrante. */
  readonly registrantChannelId: string;
  readonly score: number;
}

/** Dependencias inyectadas al servicio. */
export interface AutoNotifyDeps {
  readonly consentRepo: Pick<
    ConsentRepo,
    "openConsentSession" | "acceptConsent" | "closeRelaysAndDeleteContact" | "anonymizeAuditContact"
  >;
  readonly notificationRepo: Pick<NotificationRepo, "create">;
}

/** Resultado de la apertura de la sesion. */
export interface AutoNotifyResult {
  readonly consentSessionId: string;
}

/**
 * Abre una consent_session y encola notificaciones bilaterales.
 * Lanza si la creacion de la sesion falla (es un error no recuperable en el flujo auto).
 * Las notificaciones son best-effort (un fallo de notificacion no bloquea el flujo).
 */
export async function openConsentAndNotify(
  deps: AutoNotifyDeps,
  match: MatchForAutoNotify,
): Promise<AutoNotifyResult> {
  // Crear la sesion de consentimiento
  const consentSessionId = await deps.consentRepo.openConsentSession({
    matchId: match.matchId,
    searcherChannelId: match.searcherChannelId,
    registrantChannelId: match.registrantChannelId,
  });

  // Mensajes sin PII: el consent_id permite responder; el score (redondeado) da contexto.
  const scoreDisplay = Math.round(match.score * 100);

  const searcherMsg = [
    `Encontramos una posible coincidencia (${scoreDisplay}% de similitud).`,
    `Si querés conectarte con la familia del posible registro, respondé /aceptar.`,
    `Si no querés continuar, respondé /rechazar.`,
    `Código de consulta: ${consentSessionId}`,
  ].join("\n");

  const registrantMsg = [
    `Hay alguien buscando a una persona que podría coincidir con tu registro.`,
    `Si aceptás el contacto, el buscador recibirá tu información de contacto.`,
    `Respondé /aceptar para conectarte o /rechazar para declinar.`,
    `Código de consulta: ${consentSessionId}`,
  ].join("\n");

  // Notificaciones bilaterales — best-effort (errores individuales no deben bloquear)
  await Promise.allSettled([
    deps.notificationRepo.create({
      channel_id: match.searcherChannelId,
      tipo: "info",
      prioridad: "normal",
      payload: { mensaje: searcherMsg },
    }),
    deps.notificationRepo.create({
      channel_id: match.registrantChannelId,
      tipo: "info",
      prioridad: "normal",
      payload: { mensaje: registrantMsg },
    }),
  ]);

  return { consentSessionId };
}
