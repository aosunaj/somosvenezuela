import type { ConsentRepo, NotificationRepo, PersonRepo, SearchRepo } from "db";

// Servicio de reporte de persona rescatada (Slice D).
//
// Flujo principal:
//   1. Guard de menores: si el registrante es menor (isMinorById) o la busqueda
//      fue de menor (isMinorByContactId), → human_review. Sin notificacion directa.
//   2. Guard de fallecida: si registrantEstado='fallecida' → human_review.
//   3. Guard de registrante no localizable: sin registrantChannelId → operator_queue.
//   4. Guard de carrera con consent pendiente: si existingConsentId → consent_pending
//      (no abre otro consent_session).
//   5. Flujo normal: abre consent_session (Slice C reutilizado), notifica al
//      REGISTRANTE (quien tiene el registro) solicitando confirmacion del reencuentro.
//      El buscador activo NO recibe notificacion directa del rescatado — eso lo
//      gestiona el operador o el flujo de consent.
//      Devuelve outcome='queued'.
//
// GUARDRAIL #4: a_salvo NUNCA se fija automaticamente. El servicio solo encola.
//   assertEstadoASalvoValido es el gate de dominio; si alguien intentara usarlo
//   incorrectamente, lanzaria GuardrailError. Este servicio NUNCA llama a setEstado.
//
// PRIVACIDAD (guardrail #1): ningun mensaje expone PII (telefono, chat_id real).
//   channel_id son UUIDs internos. Los mensajes son genericos y seguros.

export type RescatadoOutcome =
  | "queued"
  | "human_review"
  | "consent_pending"
  | "operator_queue";

export interface RescatadoResult {
  readonly outcome: RescatadoOutcome;
  /** Presente solo cuando outcome='queued': ID de la consent_session abierta. */
  readonly consentSessionId?: string;
}

/** Datos necesarios para reportar un rescatado. */
export interface RescatadoInput {
  /** ID de la persona registrada (el que fue encontrado). */
  readonly personId: string;
  /**
   * ID de la busqueda activa (referencia de reunion para openConsentSession).
   * Opcional: el reporte desde el bot no porta searchId. Sin searchId el flujo
   * normal (queued) no puede abrir consent_session → operator_queue.
   */
  readonly searchId?: string;
  /**
   * Canal interno del registrante (quien tiene el registro de la persona).
   * Puede ser undefined si el registrante no es localizable.
   */
  readonly registrantChannelId?: string;
  /** Canal interno del buscador activo (quien reporta el rescatado). */
  readonly searcherChannelId: string;
  /**
   * Contact-id real del buscador activo (no el channel UUID).
   *
   * FIX (PR 6, judgment-r3): el chequeo isMinorByContactId DEBE recibir el
   * contact_id real del buscador, no el searcherChannelId (un channel UUID no es
   * un contact_id — usar el canal como proxy era un bug de seguridad silencioso).
   *
   * FIX (A1, judgment-r3): si es undefined, el servicio NO omite el chequeo: aplica
   * el branch conservador (design R2-4(c) paso 2: buscador_contact_id no resuelto a
   * adulto positivo → human_review). El caller (la ruta) debe intentar resolver el
   * contact_id real del buscador desde su canal; si no lo logra, el servicio gatea
   * a human_review en vez de dejar pasar a queued.
   */
  readonly searcherContactId?: string;
  /**
   * Estado actual del registrante (persona o mascota encontrada).
   * Si es 'fallecida', va a revision humana.
   */
  readonly registrantEstado?: string;
  /**
   * Si ya existe una consent_session abierta para este match, se pasa aqui
   * para evitar abrir una segunda (guard de carrera).
   */
  readonly existingConsentId?: string;
}

/** Dependencias inyectadas al servicio. */
export interface RescatadoDeps {
  readonly personRepo: Pick<PersonRepo, "isMinorById">;
  readonly searchRepo: Pick<SearchRepo, "isMinorByContactId">;
  readonly consentRepo: Pick<
    ConsentRepo,
    | "openConsentSession"
    | "acceptConsent"
    | "closeRelaysAndDeleteContact"
    | "anonymizeAuditContact"
  >;
  readonly notificationRepo: Pick<NotificationRepo, "create">;
}

/**
 * Procesa el reporte de una persona rescatada (encontrada).
 *
 * Nunca modifica el estado de la persona. Solo encola y notifica.
 * assertEstadoASalvoValido es el guardrail de dominio para cualquier setter
 * externo que intente fijar a_salvo sin confirmacion humana.
 */
export async function reportRescatado(
  deps: RescatadoDeps,
  input: RescatadoInput,
): Promise<RescatadoResult> {
  // ── Guard: menores (bidireccional) ─────────────────────────────────────────
  // ORDEN (M1, judgment-r3): el gate de menores va ANTES que el de fallecida, para
  // ser consistente con route-match.ts (minor antes que fallecida). Mismo outcome
  // humano, pero la razon prioritaria correcta es la proteccion de menores.

  // isMinorById del registrante
  const registrantIsMinor = await deps.personRepo.isMinorById(input.personId);
  if (registrantIsMinor) {
    return { outcome: "human_review" };
  }

  // Gate de menores del lado BUSCADOR (conservative: no PII, solo flags).
  //
  // FIX (PR 6, judgment-r3): usa searcherContactId real, NO searcherChannelId.
  // Un channel UUID no es un contact_id: usar el canal como proxy era incorrecto.
  //
  // FIX (A1, judgment-r3 item / route-match R2-4(c) paso 2): si NO se puede
  // resolver el lado buscador a un ADULTO positivo, el resultado es human_review
  // (NO se sigue a queued). Es decir:
  //   - searcherContactId ausente              → human_review (conservador)
  //   - searcherContactId presente pero menor  → human_review
  // Solo un adulto positivo resuelto continua. Antes, con searcherContactId
  // ausente el chequeo se OMITIA y seguia a queued: un agujero en el guardrail.
  if (input.searcherContactId === undefined) {
    return { outcome: "human_review" };
  }
  const searcherIsMinor = await deps.searchRepo.isMinorByContactId(input.searcherContactId);
  if (searcherIsMinor) {
    return { outcome: "human_review" };
  }

  // ── Guard: registrantEstado fallecida ──────────────────────────────────────
  if (input.registrantEstado === "fallecida") {
    return { outcome: "human_review" };
  }

  // ── Guard: registrante no localizable ──────────────────────────────────────
  if (!input.registrantChannelId) {
    return { outcome: "operator_queue" };
  }

  // ── Guard: consent_session existente (race condition) ─────────────────────
  if (input.existingConsentId) {
    return { outcome: "consent_pending" };
  }

  // ── Guard: sin searchId no hay referencia de reunion para abrir consent ─────
  // El flujo normal usa searchId como matchId de la consent_session. Si el caller
  // (p. ej. el bot) no lo aporta, no se puede abrir consent de forma segura → un
  // operador debe gestionarlo.
  if (!input.searchId) {
    return { outcome: "operator_queue" };
  }

  // ── Flujo normal: abrir consent_session y notificar al registrante ─────────
  //
  // GUARDRAIL #4: a_salvo NUNCA se fija aqui. Este servicio SOLO encola.
  // assertEstadoASalvoValido (en packages/core/src/rules.ts) es el gate de dominio
  // para cualquier setter externo que intente fijar a_salvo sin confirmacion humana.

  const consentSessionId = await deps.consentRepo.openConsentSession({
    matchId: input.searchId, // searchId actua como referencia de reunion en este contexto
    searcherChannelId: input.searcherChannelId,
    registrantChannelId: input.registrantChannelId,
  });

  // Notificar al REGISTRANTE (quien tiene el registro) — no al buscador activo.
  // El mensaje es seguro: no expone PII del buscador ni del rescatado.
  // El consent_session_id permite al registrante confirmar o declinar via /aceptar.
  const registrantMsg = [
    "Hay un reporte de que la persona que registraste podria haber sido encontrada.",
    "Para confirmar el reencuentro, respondi /aceptar.",
    "Si no corresponde, respondi /rechazar.",
    `Codigo de consulta: ${consentSessionId}`,
  ].join("\n");

  // Notificacion best-effort — no bloquea si falla
  await deps.notificationRepo.create({
    channel_id: input.registrantChannelId,
    tipo: "info",
    prioridad: "alta",
    payload: { mensaje: registrantMsg },
  }).catch(() => undefined);

  return { outcome: "queued", consentSessionId };
}
