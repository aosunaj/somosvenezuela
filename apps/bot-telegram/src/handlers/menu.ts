// Handler del menu inline del bot Telegram (Slice M, spec-delta nucleo-ux).
//
// Procesa callback_query de Telegram cuando el usuario toca un boton del menu
// inline M-1 (8 entradas). Despacha al flujo correcto usando la maquina de
// conversacion existente o iniciando el flujo unificado U-1.
//
// Retorna true si manejos el callback_query; false si no le corresponde al menu.
// El llamador (handle-update.ts) debe comprobar el resultado y seguir con el
// flujo normal si es false.

import { step, initialState, type ConversationState } from "core";
import {
  resolveMenuCallbackData,
  MENU_ENTRY_IDS,
  type MenuEntryId,
} from "core/menu";
import { initialUnifiedEntryState, type UnifiedEntryState } from "core/unified-entry";
import type { TelegramTransport } from "../ports.js";

/** Prefijo de callbackData para entradas del menu inline. */
export const MENU_CALLBACK_PREFIX = "menu:" as const;

/** Tipo de estado que el handler puede persistir en el session store. */
type PersistableState = ConversationState | UnifiedEntryState;

/** Dependencias inyectables del handler del menu. */
export interface MenuCallbackDeps {
  /** Transporte de Telegram para enviar mensajes. */
  readonly transport: TelegramTransport & {
    answerCallbackQuery?: (callbackQueryId: string) => Promise<void>;
  };
  /** Store de sesion del bot. */
  readonly sessions: {
    get(chatId: number): PersistableState | undefined;
    set(chatId: number, state: PersistableState): void;
  };
}

/** Forma del callback_query de Telegram que este handler espera. */
interface TelegramCallbackQuery {
  readonly id: string;
  readonly message: { readonly chat: { readonly id: number } } | undefined;
  readonly data: string;
}

/**
 * Analiza un update de Telegram buscando un callback_query del menu inline.
 * Devuelve null si el update no tiene la forma esperada.
 */
function parseCallbackQuery(rawUpdate: unknown): TelegramCallbackQuery | null {
  if (typeof rawUpdate !== "object" || rawUpdate === null) return null;
  const cq = (rawUpdate as Record<string, unknown>)["callback_query"];
  if (typeof cq !== "object" || cq === null) return null;
  const id = (cq as Record<string, unknown>)["id"];
  if (typeof id !== "string") return null;
  const message = (cq as Record<string, unknown>)["message"];
  const data = (cq as Record<string, unknown>)["data"];
  if (typeof data !== "string") return null;
  const chatId =
    typeof message === "object" && message !== null
      ? ((message as Record<string, unknown>)["chat"] as Record<string, unknown>)?.["id"]
      : undefined;
  return {
    id,
    message: typeof chatId === "number" ? { chat: { id: chatId } } : undefined,
    data,
  };
}

/**
 * Procesa un update de Telegram buscando un callback_query del menu inline M-1.
 *
 * Retorna true si el update era un callback_query del menu y fue manejado.
 * Retorna false si el update no era para este handler (el llamador debe seguir).
 *
 * No lanza: los errores del transporte se ignoran (el update ya fue procesado).
 */
export async function handleMenuCallbackQuery(
  rawUpdate: unknown,
  deps: MenuCallbackDeps,
): Promise<boolean> {
  const cq = parseCallbackQuery(rawUpdate);
  if (cq === null) return false;

  const { data } = cq;
  if (!data.startsWith(MENU_CALLBACK_PREFIX)) return false;

  const entryId = resolveMenuCallbackData(data);
  if (entryId === null) return false;

  const chatId = cq.message?.chat.id;
  if (chatId === undefined) return false;

  // Acknowledge el callback_query si el transporte lo soporta.
  try {
    await deps.transport.answerCallbackQuery?.(cq.id);
  } catch {
    // No fatal: si Telegram no recibe el ack, el icono de carga desaparece solo.
  }

  // Despacha al flujo correspondiente.
  await dispatchMenuEntry(chatId, entryId, deps);
  return true;
}

/**
 * Despacha la entrada del menu seleccionada al flujo correcto.
 * Usa la maquina existente para las entradas que ya entiende, e inicia el
 * flujo unificado U-1 para las nuevas entradas del menu M-1.
 */
async function dispatchMenuEntry(
  chatId: number,
  entryId: MenuEntryId,
  deps: MenuCallbackDeps,
): Promise<void> {
  const current = (deps.sessions.get(chatId) as ConversationState | undefined) ?? initialState;

  switch (entryId) {
    case MENU_ENTRY_IDS.SEARCH_REGISTER_PERSON: {
      // Inicia el flujo unificado U-1 para personas.
      const unifiedState = initialUnifiedEntryState("person");
      deps.sessions.set(chatId, unifiedState as unknown as ConversationState);
      await deps.transport.sendMessage(
        chatId,
        "Cuentanos sobre la persona que buscas: nombre, apellidos, edad, zona o senas. " +
        "Con cualquier dato que conozcas podemos buscar.",
      );
      break;
    }

    case MENU_ENTRY_IDS.SEARCH_REGISTER_PET: {
      // Inicia el flujo unificado U-1 para mascotas.
      const unifiedState = initialUnifiedEntryState("pet");
      deps.sessions.set(chatId, unifiedState as unknown as ConversationState);
      await deps.transport.sendMessage(
        chatId,
        "Cuentanos sobre la mascota que buscas: nombre, tipo (perro/gato...), raza, zona o senas. " +
        "Con cualquier dato que conozcas podemos buscar.",
      );
      break;
    }

    case MENU_ENTRY_IDS.PERSON_RESCUED: {
      // Rescatada persona: usa el flujo mark_found existente de la maquina.
      const result = step(current, { kind: "command", command: "/rescatado" });
      await sendReplies(chatId, result.replies, deps.transport);
      deps.sessions.set(chatId, result.state);
      break;
    }

    case MENU_ENTRY_IDS.PET_RESCUED: {
      // Rescatada mascota: por ahora redirige al flujo mark_found (PR3+ lo diferenciara).
      const result = step(current, { kind: "command", command: "/rescatado" });
      await sendReplies(chatId, result.replies, deps.transport);
      deps.sessions.set(chatId, result.state);
      break;
    }

    case MENU_ENTRY_IDS.MEETING_POINTS: {
      // Puntos de encuentro: usa el flujo browse_zones existente.
      const result = step(current, { kind: "command", command: "/puntos" });
      await sendReplies(chatId, result.replies, deps.transport);
      deps.sessions.set(chatId, result.state);
      break;
    }

    case MENU_ENTRY_IDS.NEEDS: {
      // Necesidades: usa el flujo browse_needs existente.
      const result = step(current, { kind: "command", command: "/necesidades" });
      await sendReplies(chatId, result.replies, deps.transport);
      deps.sessions.set(chatId, result.state);
      break;
    }

    case MENU_ENTRY_IDS.DELETE_RECORD: {
      // Borrar mi registro: usa el flujo delete existente.
      const result = step(current, { kind: "command", command: "/borrar" });
      await sendReplies(chatId, result.replies, deps.transport);
      deps.sessions.set(chatId, result.state);
      break;
    }

    case MENU_ENTRY_IDS.HELP: {
      // Ayuda: usa el flujo help existente.
      const result = step(current, { kind: "command", command: "/ayuda" });
      await sendReplies(chatId, result.replies, deps.transport);
      deps.sessions.set(chatId, result.state);
      break;
    }
  }
}

/** Envia en orden todas las respuestas de un paso por el transporte. */
async function sendReplies(
  chatId: number,
  replies: readonly { text: string; buttons?: readonly (readonly string[])[] }[],
  transport: TelegramTransport,
): Promise<void> {
  for (const r of replies) {
    await transport.sendMessage(chatId, r.text, r.buttons);
  }
}
