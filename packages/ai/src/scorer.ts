// Interfaz de la capa de IA (Claude) para el matching difuso "dudoso".
//
// GUARDRAIL #5 (docs/guardrails.md): "La IA asiste, no decide."
//   - Esta capa SOLO devuelve SUGERENCIAS con score. NUNCA confirma nada.
//   - Es OPCIONAL: el motor de matching funciona al 100% sin ella (degradacion
//     segura). Si esta interfaz no se inyecta o falla, el ranking sigue con la
//     similitud local (exacto + trigram).
//
// En ESTE slice (Fase 3 · T3.1 + capa determinista de T3.2) NO se implementa
// ningun proveedor real ni se hacen llamadas de red. Solo se define el contrato
// y un proveedor nulo (`NullAiScorer`) para tests y degradacion.

import type { PublicPerson } from "core";

/**
 * Peticion minima que el motor le pasaria a la IA para puntuar un candidato.
 *
 * MINIMIZACION DE DATOS (guardrail #5): se envia SOLO el texto necesario para
 * comparar (nombres/zona/descripcion ya normalizados). NUNCA datos de contacto
 * (telefono, email) ni `contact_id`. Por eso el candidato es `PublicPerson`,
 * que por construccion (core/schemas.ts) no incluye `contact_id`.
 */
export interface AiScoreRequest {
  /** Texto de busqueda ya normalizado (sin tildes, minusculas). */
  readonly queryName: string;
  /** Zona buscada ya normalizada, si la hay. */
  readonly queryZone?: string;
  /** Descripcion libre de la busqueda ya normalizada, si la hay. */
  readonly queryDescription?: string;
  /** Candidato a puntuar. Vista publica: jamas lleva datos de contacto. */
  readonly candidate: PublicPerson;
}

/**
 * Respuesta de la IA: SIEMPRE una sugerencia con score en [0, 1].
 * No existe campo "confirmado" ni equivalente: confirmar es decision HUMANA.
 */
export interface AiScoreResult {
  /** Score sugerido en [0, 1]. */
  readonly score: number;
  /** Justificacion breve y opcional (sin PII), util para revision humana. */
  readonly rationale?: string;
}

/**
 * Contrato de la capa de IA. Implementaciones futuras (p.ej. un
 * `ClaudeAiScorer`) viven detras de esta interfaz y se INYECTAN en el motor.
 *
 * Como se enchufaria Claude despues (sin tocar el motor):
 *   1. Implementar `AiScorer.score(...)` llamando a la Claude API.
 *   2. Enviar SOLO el texto minimo del `AiScoreRequest` (nunca contacto).
 *   3. Devolver `{ score, rationale }` como SUGERENCIA; nada se confirma aqui.
 *   4. Inyectarlo via `rankCandidates(query, candidates, { aiScorer })`.
 * Si la llamada falla, el motor IGNORA la IA y conserva el score local
 * (degradacion segura). El proveedor real debe gestionar sus errores y, ante
 * fallo, devolver el control al motor (lanzar o resolver con el score local).
 */
export interface AiScorer {
  /**
   * Puntua un candidato. Asincrono porque el proveedor real hace E/S de red.
   * Devuelve SIEMPRE una sugerencia con score; nunca una confirmacion.
   */
  score(request: AiScoreRequest): Promise<AiScoreResult>;
}

/**
 * Proveedor nulo de IA: no hace nada y no esta disponible.
 *
 * Sirve para tests y para documentar la degradacion segura: con este scorer
 * (o sin scorer alguno) el motor produce resultados validos usando solo la
 * similitud local. NO realiza llamadas de red.
 */
export const NullAiScorer: AiScorer = Object.freeze({
  score(_request: AiScoreRequest): Promise<AiScoreResult> {
    // No decide ni sugiere: deja el control al motor local.
    return Promise.reject(
      new Error("NullAiScorer: capa de IA no disponible (degradacion local)"),
    );
  },
});
