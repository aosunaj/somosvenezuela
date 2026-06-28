import type { ConversationState } from "core";
import type { SessionStore } from "./ports.js";

// Implementacion en memoria del almacen de sesiones (un Map por wa_id).
//
// Suficiente para Fase 4 (un solo proceso, webhook). En un despliegue con varias
// instancias habria que mover esto a un store compartido (Redis/Supabase); la
// INTERFAZ no cambia, solo la implementacion. Por eso el orquestador depende de
// `SessionStore`, no de este Map.

export class InMemorySessionStore implements SessionStore {
  readonly #states = new Map<string, ConversationState>();

  get(waId: string): ConversationState | undefined {
    return this.#states.get(waId);
  }

  set(waId: string, state: ConversationState): void {
    this.#states.set(waId, state);
  }
}
