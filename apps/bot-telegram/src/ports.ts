import type {
  ConversationState,
  PublicNeed,
  PublicPerson,
  PublicPet,
  PublicZone,
} from "core";

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

/** Resultado publico de una busqueda de personas: vista publica + score opcional 0..1. */
export type PublicPersonResult = PublicPerson & { readonly score?: number };

/** Resultado publico de una busqueda de mascotas: vista publica + score opcional 0..1. */
export type PublicPetResult = PublicPet & { readonly score?: number };

/**
 * Identidad del canal del usuario, tal como la conoce el adaptador (NO la maquina):
 * la plataforma del bot y el id del chat. El backend usa este vinculo para autorizar
 * el borrado y para entregar notificaciones por el canal correcto.
 *
 * `chatId` viaja SIEMPRE como cadena hacia el backend (Telegram es numerico, WhatsApp
 * es cadena; el contrato unifica a `string`). `telefono` es OPCIONAL y SENSIBLE: solo
 * se usa internamente para notificar, nunca se expone en respuestas publicas.
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
 * - `registerPet` envia el `PetCreate` que arma la maquina MAS la identidad del canal
 *   (POST /pets con `channel`), para que la mascota quede vinculada al usuario.
 * - `deleteByChannel` borra un registro solo si el canal que lo pide es su dueno
 *   (DELETE /persons/:id/by-channel); el backend autoriza, el adaptador no decide.
 * - `searchPersons`/`searchPets` devuelven la vista publica (sin contacto) con score.
 * - `listZones`/`listNeeds` son LECTURA PUBLICA del mapa (GET): puntos de encuentro y
 *   necesidades por zona. Sin contacto ni PII; el bot solo las muestra (paridad web).
 * - `createPerson` se conserva por compatibilidad con tests del slice anterior; el
 *   flujo real de registro usa `registerPerson`.
 */
export interface BackendClient {
  createPerson(data: unknown): Promise<{ readonly id: string }>;
  registerPerson(
    person: unknown,
    channel: ChannelIdentity,
  ): Promise<{ readonly id: string }>;
  registerPet(
    pet: unknown,
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
  listZones(): Promise<readonly PublicZone[]>;
  listNeeds(): Promise<readonly PublicNeed[]>;
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
