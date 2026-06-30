import type { NotificationRepo } from "db";

// Servicio de alertas de riesgo por fan-out (Slice E).
//
// Heuristica: si un buscador ha abierto N consents en las ultimas 24h (configurable
// via AUTO_FANOUT_THRESHOLD env, default 3), se envia una notificacion 'alerta' al
// canal del operador para revision humana.
//
// CRITICO (privacidad): el payload de la alerta contiene SOLO:
//   - searcherId: UUID interno del buscador (no phone, no nombre, no ubicacion)
//   - count: numero de consents en la ventana
//   - windowHours: ventana en horas
// Ningun dato de contacto real aparece en el payload.
//
// La alerta es ADVISORY: nunca interrumpe relays existentes ni gatea el flujo.
// Si no hay canal de operador configurado (operatorChannelId=null), no envia nada
// y no lanza.

/** Resultado de la evaluacion de alerta de fan-out. */
export interface CheckRiskAlertResult {
  readonly alertSent: boolean;
}

/** Input para la verificacion de alerta. */
export interface CheckRiskAlertInput {
  /** UUID interno del buscador (nunca el chat_id real). */
  readonly searcherId: string;
  /** Numero de consent_sessions abiertas por este buscador en la ventana. */
  readonly consentCountLast24h: number;
  /** Ventana en horas que se esta evaluando. */
  readonly windowHours: number;
}

/** Dependencias del servicio. */
export interface CheckRiskAlertDeps {
  readonly notificationRepo: Pick<NotificationRepo, "create">;
  /**
   * UUID del canal del operador al que se envian alertas.
   * Si es null, el servicio no envia alertas y devuelve alertSent=false.
   */
  readonly operatorChannelId: string | null;
  /**
   * Umbral de consents por ventana que dispara la alerta.
   * Por defecto 3 (valor de AUTO_FANOUT_THRESHOLD env).
   */
  readonly autoFanoutThreshold: number;
}

/**
 * Evalua la heuristica de fan-out y envia una alerta al operador si corresponde.
 *
 * Advisory: nunca lanza, nunca interrumpe relays ni gatea flujos.
 * Si el operatorChannelId es null o el count esta bajo el umbral, no hace nada.
 */
export async function checkRiskAlert(
  deps: CheckRiskAlertDeps,
  input: CheckRiskAlertInput,
): Promise<CheckRiskAlertResult> {
  // Sin canal de operador → no hay donde enviar la alerta
  if (deps.operatorChannelId === null) {
    return { alertSent: false };
  }

  // Si el count no alcanza el umbral → sin alerta
  if (input.consentCountLast24h < deps.autoFanoutThreshold) {
    return { alertSent: false };
  }

  // Enviar alerta al operador — best-effort (no lanza)
  try {
    await deps.notificationRepo.create({
      channel_id: deps.operatorChannelId,
      tipo: "alerta",
      prioridad: "normal",
      payload: {
        // PRIVACIDAD: SOLO IDs internos + metricas. Nunca phone/nombre/ubicacion.
        searcherId: input.searcherId,
        count: input.consentCountLast24h,
        windowHours: input.windowHours,
      },
    });
  } catch {
    // Advisory: si falla la notificacion, no bloqueamos nada
    return { alertSent: false };
  }

  return { alertSent: true };
}
