import type { ConversationState } from "core";
import type { SessionStore } from "./ports.js";

// Implementacion en memoria del almacen de sesiones (un Map por chatId).
//
// Suficiente para Fase 2 (un solo proceso, long polling). En un despliegue con
// varias instancias habria que mover esto a un store compartido (Redis/Supabase);
// la INTERFAZ no cambia, solo la implementacion. Por eso el orquestador depende
// de `SessionStore`, no de este Map.

export class InMemorySessionStore implements SessionStore {
  readonly #states = new Map<number, ConversationState>();

  get(chatId: number): ConversationState | undefined {
    return this.#states.get(chatId);
  }

  set(chatId: number, state: ConversationState): void {
    this.#states.set(chatId, state);
  }
}
