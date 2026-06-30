// Regla de dedup B-1: suscripcion sin conexion entre buscadores (Slice B, spec-delta).
//
// Cuando un usuario confirma que un candidato ya registrado por otro buscador
// "es la misma persona/mascota", el sistema DEBE permitir que el usuario
// reciba avisos futuros sobre ese caso.
//
// El sistema NUNCA:
//  - Revela que otro buscador existe ni su identidad.
//  - Conecta directamente a dos buscadores entre si.
//  - Abre un relay o consentimiento bilateral entre buscadores.
//
// El relay/consentimiento bilateral (Slices B/C) es exclusivo del eje
// buscador ↔ persona-registrada-desaparecida. NUNCA entre dos buscadores.

import type { UnifiedEntryDomain } from "./unified-entry.js";

// ── Tipos ─────────────────────────────────────────────────────────────────────

/** Entrada para la regla de suscripcion sin conexion. */
export interface SubscribeCaseInput {
  readonly caseId: string;
  readonly domain: UnifiedEntryDomain;
}

/**
 * Resultado de la regla de suscripcion.
 * action: siempre "subscribe_interest" — NUNCA "open_relay" ni similares.
 */
export interface SubscribeCaseResult {
  /** Accion que el adaptador ejecutara: marcar interes en el caso. */
  readonly action: "subscribe_interest";
  readonly caseId: string;
  readonly domain: UnifiedEntryDomain;
}

// ── Regla pura ────────────────────────────────────────────────────────────────

/**
 * Regla de dominio B-1: suscripcion al caso SIN conexion entre buscadores.
 *
 * Produce la accion "subscribe_interest" que el adaptador ejecutara contra
 * el backend para marcar el interes del canal en recibir avisos sobre el caso.
 *
 * Es una funcion PURA: sin efectos, sin red, sin BD. Idempotente.
 * El backend (PR3+) implementara la persistencia de la suscripcion.
 *
 * Guardrail Slice B: esta funcion jamas produce open_relay, open_consent
 * ni connect_searchers — el resultado solo puede ser subscribe_interest.
 */
export function subscribeToCaseWithoutConnection(
  input: SubscribeCaseInput,
): SubscribeCaseResult {
  return {
    action: "subscribe_interest",
    caseId: input.caseId,
    domain: input.domain,
  };
}
