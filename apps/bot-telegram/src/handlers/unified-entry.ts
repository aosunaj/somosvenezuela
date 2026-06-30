// Handler del flujo unificado buscar/registrar en el adaptador de Telegram (Slice U).
//
// Intercepta updates de texto cuando la sesion activa es un UnifiedEntryState,
// delega al reducer puro `stepUnifiedEntry`, ejecuta los efectos (busqueda,
// suscripcion al caso), y persiste el nuevo estado.
//
// Contrato de privacidad (guardrail #1):
//   - El candidato se presenta via `safeCandidateSummary` en core: nunca expone
//     contact_id, channel_id ni numeros de telefono del registrante.
//   - B-1 dedup: la suscripcion llama SOLO a subscribeToCase; NUNCA abre relay.
//
// Retorna true si el update fue manejado; false si el llamador debe seguir.

import {
  stepUnifiedEntry,
  type UnifiedEntryState,
  type SearchCandidate,
} from "core/unified-entry";
import type { TelegramTransport } from "../ports.js";

// ── Tipos del handler ─────────────────────────────────────────────────────────

/**
 * Subconjunto del BackendClient que este handler necesita.
 * Los metodos son mas estrechos que el full BackendClient para evitar acoplar
 * el handler a metodos que no usa.
 */
export interface UnifiedEntryBackendPort {
  /** Busca personas por texto libre. Devuelve candidatos publicos (sin PII). */
  searchPersonsUnified(query: string): Promise<readonly SearchCandidate[]>;
  /** Busca mascotas por texto libre. Devuelve candidatos publicos (sin PII). */
  searchPetsUnified(query: string): Promise<readonly SearchCandidate[]>;
  /** Suscribe el canal al caso (interes, sin relay ni consentimiento). */
  subscribeToCase(caseId: string, domain: string): Promise<{ readonly ok: boolean }>;
}

/** Dependencias inyectables del handler del flujo unificado. */
export interface UnifiedEntryHandlerDeps {
  readonly transport: TelegramTransport;
  readonly backend: UnifiedEntryBackendPort;
  readonly sessions: {
    get(chatId: number): unknown;
    set(chatId: number, state: unknown): void;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Extrae chatId y texto de un update de Telegram de tipo mensaje. */
function parseTextMessage(
  rawUpdate: unknown,
): { chatId: number; text: string } | null {
  if (typeof rawUpdate !== "object" || rawUpdate === null) return null;
  const message = (rawUpdate as Record<string, unknown>)["message"];
  if (typeof message !== "object" || message === null) return null;
  const chat = (message as Record<string, unknown>)["chat"];
  const text = (message as Record<string, unknown>)["text"];
  if (typeof text !== "string") return null;
  const chatId = (chat as Record<string, unknown> | null | undefined)?.["id"];
  if (typeof chatId !== "number") return null;
  return { chatId, text };
}

/** Comprueba si un estado es un UnifiedEntryState. */
function isUnifiedEntryState(state: unknown): state is UnifiedEntryState {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)["flow"] === "unified_entry"
  );
}

// ── Handler principal ─────────────────────────────────────────────────────────

/**
 * Procesa un update de Telegram cuando la sesion esta en flujo `unified_entry`.
 *
 * Devuelve true si el update fue manejado; false si la sesion no esta en el
 * flujo unificado (el llamador debe seguir con el handler de la maquina normal).
 */
export async function handleUnifiedEntryUpdate(
  rawUpdate: unknown,
  deps: UnifiedEntryHandlerDeps,
): Promise<boolean> {
  // Solo procesa mensajes de texto.
  const parsed = parseTextMessage(rawUpdate);
  if (parsed === null) return false;

  const { chatId, text } = parsed;
  const session = deps.sessions.get(chatId);

  // Solo actua si la sesion esta en el flujo unificado.
  if (!isUnifiedEntryState(session)) return false;

  // ── Paso 1: reduccion pura ────────────────────────────────────────────────
  const input: { kind: "text"; text: string } = { kind: "text", text };
  const { state: nextState, replies, effect } = stepUnifiedEntry(session, input);

  // Persiste el nuevo estado.
  deps.sessions.set(chatId, nextState);

  // Envia las replies previas al efecto.
  for (const r of replies) {
    await deps.transport.sendMessage(chatId, r.text, r.buttons);
  }

  // ── Paso 2: ejecucion del efecto (si lo hay) ──────────────────────────────
  if (effect === undefined) return true;

  if (effect.type === "search_unified") {
    // Ejecutar la busqueda en el backend.
    let results: readonly SearchCandidate[] = [];
    try {
      results =
        effect.domain === "pet"
          ? await deps.backend.searchPetsUnified(effect.query)
          : await deps.backend.searchPersonsUnified(effect.query);
    } catch {
      // Si la busqueda falla, informamos al usuario y volvemos al inicio.
      await deps.transport.sendMessage(
        chatId,
        "No pudimos buscar en este momento. Por favor, intentalo de nuevo en un rato.",
      );
      const currentState = deps.sessions.get(chatId);
      if (isUnifiedEntryState(currentState)) {
        // Re-feed el resultado vacio para que la maquina transite limpiamente.
        const errorResult = stepUnifiedEntry(currentState as UnifiedEntryState, {
          kind: "effect_result",
          result: { type: "search_result", results: [] },
        });
        deps.sessions.set(chatId, errorResult.state);
        for (const r of errorResult.replies) {
          await deps.transport.sendMessage(chatId, r.text, r.buttons);
        }
      }
      return true;
    }

    // Re-inject el resultado en la maquina.
    const currentState = deps.sessions.get(chatId);
    if (!isUnifiedEntryState(currentState)) return true;

    const { state: afterSearch, replies: searchReplies } = stepUnifiedEntry(
      currentState as UnifiedEntryState,
      { kind: "effect_result", result: { type: "search_result", results } },
    );
    deps.sessions.set(chatId, afterSearch);
    for (const r of searchReplies) {
      await deps.transport.sendMessage(chatId, r.text, r.buttons);
    }
    return true;
  }

  if (effect.type === "subscribe_to_case") {
    // Suscribir al canal al caso (B-1 dedup: nunca relay).
    let ok = false;
    try {
      const result = await deps.backend.subscribeToCase(effect.caseId, effect.domain);
      ok = result.ok;
    } catch {
      ok = false;
    }

    // Re-inject el resultado en la maquina.
    const currentState = deps.sessions.get(chatId);
    if (!isUnifiedEntryState(currentState)) return true;

    const { state: afterSubscribe, replies: subReplies } = stepUnifiedEntry(
      currentState as UnifiedEntryState,
      { kind: "effect_result", result: { type: "subscribe_to_case", ok } },
    );
    deps.sessions.set(chatId, afterSubscribe);
    for (const r of subReplies) {
      await deps.transport.sendMessage(chatId, r.text, r.buttons);
    }
    return true;
  }

  if (effect.type === "start_register") {
    // La transicion al flujo register ya la hace el reducer pure (no-match + si).
    // El adaptador no necesita hacer nada extra aqui: el nuevo estado (register/register_pet)
    // ya fue persistido arriba. Las replies ya se enviaron.
    return true;
  }

  return true;
}
