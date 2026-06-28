import type { ConversationState, PublicPerson } from "core";

// Puertos (interfaces inyectables) del adaptador de Telegram.
//
// TODO el I/O del bot pasa por estas interfaces: red de Telegram, llamadas al
// backend y persistencia de sesion. Asi el orquestador (handleUpdate) se prueba
// con dobles en memoria, sin red ni token, y la implementacion real vive aparte.
//
// El adaptador NO tiene reglas de negocio: solo transporte, formato y ejecucion
// de efectos. La logica de dialogo entera esta en la maquina de `core`.

// ── Transporte hacia Telegram ────────────────────────────────────────────────

/**
 * Transporte de salida hacia Telegram. Una sola operacion: enviar un mensaje a
 * un chat, opcionalmente con un teclado de botones (matriz de filas de etiquetas,
 * tal como la entrega la maquina en `Reply.buttons`).
 *
 * NUNCA debe transportar dato de contacto (telefono, contact_id) de otra persona:
 * el `text` proviene de la maquina, que solo formatea la vista publica.
 */
export interface TelegramTransport {
  sendMessage(
    chatId: number,
    text: string,
    buttons?: readonly (readonly string[])[],
  ): Promise<void>;
}

// ── Cliente del backend (spec 01) ────────────────────────────────────────────

/** Resultado publico de una busqueda: vista publica + score opcional 0..1. */
export type PublicPersonResult = PublicPerson & { readonly score?: number };

/**
 * Cliente del backend HTTP. Expone solo las operaciones que el adaptador necesita
 * para los flujos de registrar y buscar. JAMAS pide ni procesa `contact_id`:
 * - `createPerson` envia el `PersonCreate` que arma la maquina (sin contacto) y
 *   devuelve unicamente el id del registro creado.
 * - `searchPersons` devuelve la vista publica (sin contacto) con score.
 */
export interface BackendClient {
  createPerson(data: unknown): Promise<{ readonly id: string }>;
  searchPersons(
    query: string,
    zona?: string,
  ): Promise<readonly PublicPersonResult[]>;
}

// ── Almacen de sesiones ──────────────────────────────────────────────────────

/**
 * Persistencia del `ConversationState` (serializable) entre mensajes del mismo
 * chat. La maquina es pura: el estado del dialogo lo guarda el adaptador aqui,
 * indexado por `chatId`. Chats distintos no comparten estado.
 */
export interface SessionStore {
  get(chatId: number): ConversationState | undefined;
  set(chatId: number, state: ConversationState): void;
}
