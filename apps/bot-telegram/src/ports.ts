import type {
  ConversationState,
  OwnedPerson,
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
 * Estado de la solicitud de reencuentro que el backend devuelve al BUSCADOR. Espeja el
 * `request_reunion` de la maquina de `core`. NO transporta contacto (guardrail #1):
 *   - 'requested' : se aviso a la otra parte; se espera su respuesta.
 *   - 'minor'     : la persona es menor; requiere entidad verificada (guardrail #2).
 *   - 'failed'    : no se pudo iniciar. Generico, sin revelar si el registro existe.
 */
export type ReunionRequestStatus = "requested" | "minor" | "failed";

/** Decision del REGISTRANTE ante la solicitud de reencuentro (/conectar | /rechazar). */
export type ReunionDecision = "aceptado" | "rechazado";

/**
 * Estado que el backend devuelve al REGISTRANTE tras su respuesta. Sin contacto:
 *   - 'not_found'        : no habia una solicitud pendiente para este canal.
 *   - 'rejected'         : rechazo registrado; nada se compartio.
 *   - 'exchanged'        : ambos aceptaron; el contacto se entregara por notificacion.
 *   - 'accepted_waiting' : acepto pero el intercambio aun no procede (caso anomalo).
 */
export type ReunionConsentStatus =
  | "not_found"
  | "rejected"
  | "exchanged"
  | "accepted_waiting";

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

// ── Relay (F4 selective pre-machine intercept, design v3) ────────────────────

/**
 * Info del relay activo para el canal. Retornado por `getActiveRelay`.
 * Nunca transporta datos de contacto (guardrail #1): solo IDs internos
 * que permiten enrutar la notificacion del mensaje por la cola del backend.
 */
export interface ActiveRelayInfo {
  /** ID de la relay_session activa. */
  readonly relayId: string;
  /** channel_id de la OTRA parte (hacia quien se reenvía el mensaje). */
  readonly otherChannelId: string;
}

/**
 * Datos de una llamada a `forwardRelayMessage` (exportado para tests).
 * El relay forward siempre va a traves de la cola de notifications del backend
 * (NUNCA por Telegram API directo), conforme al contrato del poller.
 */
export interface ForwardRelayCall {
  readonly relayId: string;
  readonly text: string;
  readonly channel: ChannelIdentity;
}

/**
 * Cliente del backend HTTP. Expone solo las operaciones que el adaptador necesita
 * para los flujos de registrar, buscar, borrar y relay de mensajes.
 *
 * JAMAS pide ni procesa `contact_id` de terceros: el vinculo usuario<->canal viaja
 * en `channel` (que el backend persiste en la tabla `channels`), y las vistas
 * publicas que devuelve no traen contacto.
 *
 * RELAY METHODS (F4, design v3):
 * - `getActiveRelay`: comprueba si este canal tiene un relay activo (GET /relay/active).
 *   Devuelve `ActiveRelayInfo | null`. Solo devuelve null si no hay relay, nunca lanza.
 * - `forwardRelayMessage`: envía un mensaje a traves del relay escribiendo en la cola
 *   de notifications del backend (POST /relay/:id/forward). El backend lo entrega al
 *   otro partido por el poller. NUNCA llama a Telegram API directamente.
 * - `closeRelay`: cierra el relay activo para ambas partes (POST /relay/:id/close).
 *   El backend notifica a la otra parte (por la cola) y cierra la relay_session.
 * - `respondConsent`: el canal responde a una solicitud de consentimiento de contacto
 *   (POST /consent/:id/respond). Usado en el flujo de verificacion de identidad.
 * - `requestRelayReveal`: solicita la revelacion bilateral del contacto en un relay
 *   activo (POST /relay/:id/reveal).
 * - `sweepConsent`: tarea de mantenimiento: expira los consent_sessions vencidos
 *   (POST /consent/sweep). Pensado para llamarse desde el ciclo del poller.
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
  markFoundByChannel(personId: string, channel: ChannelIdentity): Promise<void>;
  /**
   * Lista los registros que el DUENO creo desde su canal, para que elija cual
   * marcar/borrar SIN pegar codigos (POST /persons/mine-by-channel). Devuelve la
   * vista del dueno (`OwnedPerson`): SIN contacto (guardrail #1). Canal desconocido o
   * sin registros => lista vacia.
   */
  listMyPersons(channel: ChannelIdentity): Promise<readonly OwnedPerson[]>;
  /**
   * Busca personas en el backend (POST /searches).
   * `es_menor` se incluye cuando la maquina recibio una respuesta explicita del
   * usuario (paso 'menor', R2-4a). El backend lo confirma server-side de forma
   * conservadora (judgment-r3 item 5).
   */
  searchPersons(
    query: string,
    zona?: string,
    channel?: ChannelIdentity,
    descripcion?: string,
    es_menor?: boolean,
  ): Promise<readonly PublicPersonResult[]>;
  searchPets(
    query: string,
    zona?: string,
  ): Promise<readonly PublicPetResult[]>;
  /**
   * REENCUENTRO: el BUSCADOR (por su canal) inicia la conexion con una persona elegida
   * (POST /reunion/request). El backend pide el consentimiento de la otra parte. NO se
   * comparte contacto aqui: devuelve solo el estado para que la maquina lo traduzca.
   */
  requestReunion(
    personId: string,
    channel: ChannelIdentity,
  ): Promise<ReunionRequestStatus>;
  /**
   * REENCUENTRO: el REGISTRANTE (por su canal) acepta o rechaza la solicitud pendiente
   * (POST /reunion/consent). El backend correlaciona por el contacto del canal. El
   * contacto, si ambos aceptan, llega despues por notificacion (nunca en esta respuesta).
   */
  reunionConsent(
    decision: ReunionDecision,
    channel: ChannelIdentity,
  ): Promise<ReunionConsentStatus>;
  listZones(): Promise<readonly PublicZone[]>;
  listNeeds(): Promise<readonly PublicNeed[]>;
  // ── Relay methods (F4, design v3) ─────────────────────────────────────────
  /** Consulta si el canal tiene un relay activo. Nunca lanza; null = sin relay. */
  getActiveRelay(channel: ChannelIdentity): Promise<ActiveRelayInfo | null>;
  /**
   * Reenvía un mensaje de texto a traves del relay. Escribe en la cola de
   * notifications del backend; el poller lo entrega. NUNCA llama a Telegram API.
   * guardrail #1: el `text` ya fue escaneado por `scanRelayContent` antes de llegar.
   */
  forwardRelayMessage(
    relayId: string,
    text: string,
    channel: ChannelIdentity,
  ): Promise<void>;
  /** Cierra el relay para ambas partes. El backend notifica a la otra. */
  closeRelay(relayId: string, channel: ChannelIdentity): Promise<void>;
  /** Acepta o rechaza un consent_session pendiente (flujo de verificacion). */
  respondConsent(
    consentId: string,
    decision: "aceptado" | "rechazado",
    channel: ChannelIdentity,
  ): Promise<void>;
  /** Solicita la revelacion bilateral del contacto en el relay activo. */
  requestRelayReveal(relayId: string, channel: ChannelIdentity): Promise<void>;
  /** Sweep de consent_sessions vencidos (tarea de mantenimiento del poller). */
  sweepConsent(): Promise<void>;
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
