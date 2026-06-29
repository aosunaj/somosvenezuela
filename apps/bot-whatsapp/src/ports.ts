import type { ConversationState, PublicPerson, PublicPet } from "core";

// Puertos (interfaces inyectables) del adaptador de WhatsApp.
//
// Espejo del adaptador de Telegram: TODO el I/O del bot pasa por estas interfaces
// (red de WhatsApp Cloud API, llamadas al backend y persistencia de sesion). Asi el
// orquestador (handleUpdate) se prueba con dobles en memoria, sin red ni token, y la
// implementacion real vive aparte.
//
// El adaptador NO tiene reglas de negocio: solo transporte, formato y ejecucion de
// efectos. La logica de dialogo entera esta en la maquina de `core` (la MISMA que usa
// Telegram). Unica diferencia de forma: WhatsApp identifica al usuario por su numero
// (`wa_id`, una cadena), no por un id numerico de chat.

// ── Transporte hacia WhatsApp ────────────────────────────────────────────────

/**
 * Transporte de salida hacia WhatsApp Cloud API. Una sola operacion: enviar un
 * mensaje a un destinatario (`to` = `wa_id`, el numero en formato internacional sin
 * `+`), opcionalmente con un teclado de botones (matriz de filas de etiquetas, tal
 * como la entrega la maquina en `Reply.buttons`).
 *
 * NUNCA debe transportar dato de contacto (telefono, contact_id) de otra persona:
 * el `text` proviene de la maquina, que solo formatea la vista publica.
 */
export interface WhatsAppTransport {
  sendMessage(
    to: string,
    text: string,
    buttons?: readonly (readonly string[])[],
  ): Promise<void>;
}

// ── Cliente del backend (spec 01) ────────────────────────────────────────────

/** Resultado publico de una busqueda de personas: vista publica + score opcional 0..1. */
export type PublicPersonResult = PublicPerson & { readonly score?: number };

/** Resultado publico de una busqueda de mascotas: vista publica + score opcional 0..1. */
export type PublicPetResult = PublicPet & { readonly score?: number };

/**
 * Identidad del canal del usuario, tal como la conoce el adaptador (NO la maquina):
 * la plataforma del bot y el id del chat. El backend usa este vinculo para autorizar
 * el borrado y para entregar notificaciones por el canal correcto.
 *
 * `chatId` viaja SIEMPRE como cadena hacia el backend (en WhatsApp ya es el `wa_id`,
 * una cadena; el contrato lo unifica a `string` con Telegram). `telefono` es OPCIONAL
 * y SENSIBLE: solo se usa internamente para notificar, nunca en respuestas publicas.
 */
export interface ChannelIdentity {
  readonly plataforma: "telegram" | "whatsapp";
  readonly chatId: string;
  readonly telefono?: string;
}

/**
 * Error que lanza `deleteByChannel` cuando el backend responde 403: el canal que pide
 * el borrado NO es el dueno del registro. Es un fallo ESPERADO (no un error interno),
 * y el adaptador lo distingue para dar un mensaje claro sin filtrar detalles.
 */
export class NotOwnerError extends Error {
  constructor(message = "El canal no es dueno del registro.") {
    super(message);
    this.name = "NotOwnerError";
  }
}

/**
 * Cliente del backend HTTP. Expone solo las operaciones que el adaptador necesita
 * para los flujos de registrar, buscar y borrar. JAMAS pide ni procesa `contact_id`
 * de terceros: el vinculo usuario<->canal viaja en `channel` (que el backend persiste
 * en la tabla `channels`), y las vistas publicas que devuelve no traen contacto.
 *
 * - `registerPerson` envia el `PersonCreate` que arma la maquina MAS la identidad del
 *   canal (POST /register-person), para que el registro quede vinculado al usuario.
 * - `deleteByChannel` borra un registro solo si el canal que lo pide es su dueno
 *   (DELETE /persons/:id/by-channel); el backend autoriza, el adaptador no decide.
 * - `searchPersons`/`searchPets` devuelven la vista publica (sin contacto) con score.
 * - `createPerson` se conserva por compatibilidad con tests del slice anterior; el
 *   flujo real de registro usa `registerPerson`.
 */
export interface BackendClient {
  createPerson(data: unknown): Promise<{ readonly id: string }>;
  registerPerson(
    person: unknown,
    channel: ChannelIdentity,
  ): Promise<{ readonly id: string }>;
  deleteByChannel(personId: string, channel: ChannelIdentity): Promise<void>;
  searchPersons(
    query: string,
    zona?: string,
    channel?: ChannelIdentity,
  ): Promise<readonly PublicPersonResult[]>;
  searchPets(
    query: string,
    zona?: string,
  ): Promise<readonly PublicPetResult[]>;
}

// ── Almacen de sesiones ──────────────────────────────────────────────────────

/**
 * Persistencia del `ConversationState` (serializable) entre mensajes del mismo
 * usuario. La maquina es pura: el estado del dialogo lo guarda el adaptador aqui,
 * indexado por `wa_id`. Usuarios distintos no comparten estado.
 */
export interface SessionStore {
  get(waId: string): ConversationState | undefined;
  set(waId: string, state: ConversationState): void;
}
