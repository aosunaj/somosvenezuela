import {
  initialState,
  step,
  type ConversationInput,
  type ConversationState,
  type Effect,
  type EffectResult,
  type Reply,
  type StepResult,
} from "core";
import { scanRelayContent } from "core/utils/scanRelayContent";
import { telegramUpdateSchema } from "./telegram-types.js";
import type {
  BackendClient,
  ChannelIdentity,
  RescatadoStatus,
  ReunionConsentStatus,
  SessionStore,
  TelegramTransport,
} from "./ports.js";
import { handleMenuCallbackQuery } from "./handlers/menu.js";
import { handleUnifiedEntryUpdate } from "./handlers/unified-entry.js";

/** Plataforma fija de este adaptador (el backend la usa para el vinculo del canal). */
const PLATAFORMA = "telegram" as const;

// Orquestador del adaptador: pega la maquina de `core` con Telegram y el backend.
//
// Responsabilidad UNICA (sin reglas de negocio):
//   1. Sanear el update de Telegram y mapearlo a ConversationInput.
//   2. Correr la maquina (step) y enviar sus `replies` por el transporte.
//   3. Si la maquina pide un `effect`, ejecutarlo contra el backend y re-inyectar
//      el resultado como `effect_result`, enviando luego la respuesta final.
//   4. Persistir el ConversationState entre mensajes del mismo chat.
//
// RELAY INTERCEPT (F4, design v3) — ANTES de la maquina, solo para kind:'text':
//   Si hay relay activo, escanear con scanRelayContent (guardrail #1: bloqueo de
//   telefonos) y, si pasa, reenviar por la cola del backend (NUNCA Telegram API).
//   Si el scan detecta un numero: bloquear y avisar al emisor.
//   Comandos van SIEMPRE a la maquina (F4 bypass). /cancelar con relay activo:
//   cierra el relay y notifica a ambas partes antes de pasar a la maquina.
//
// Toda la logica de dialogo (que pedir, como validar, cuando confirmar) vive en
// la maquina; aqui solo hay transporte, formato y ejecucion de efectos.

/** Dependencias inyectables del orquestador (todo el I/O detras de interfaces). */
export interface UpdateDeps {
  readonly transport: TelegramTransport;
  readonly backend: BackendClient;
  readonly sessions: SessionStore;
}

// Mensaje amable ante un fallo de busqueda (no filtra detalles internos).
const SEARCH_FAILED =
  "No pudimos completar la busqueda ahora mismo. Por favor, intentalo de nuevo en un momento.";

// Guia cuando llega contenido SIN texto utilizable (foto sola, sticker, ubicacion...).
// No lo descartamos en silencio: dejariamos a la persona colgada sin respuesta. Las
// fotos aun no se guardan; pedimos la descripcion en texto para poder continuar.
const NO_TEXT_CONTENT =
  "Por ahora solo puedo leer mensajes de texto. Si querias enviar una foto, escribe la " +
  "descripcion en un mensaje y seguimos. (Pronto podras adjuntar fotos.)";

/** Comandos universales que la maquina entiende, normalizados por el adaptador. */
const COMMANDS: Record<string, string> = {
  "/start": "/start",
  "/ayuda": "/ayuda",
  "/help": "/ayuda",
  "/cancelar": "/cancelar",
  "/cancel": "/cancelar",
};

// REENCUENTRO — comandos GLOBALES del REGISTRANTE. Responden a una notificacion PUSH
// ("alguien busca a quien registraste; /conectar o /rechazar"). Se manejan FUERA de la
// maquina de conversacion: la notificacion es push y la sesion del bot es in-memory por
// chat, asi que NO hay un estado de sesion que correlacione. El backend correlaciona la
// solicitud pendiente por la PROPIEDAD del canal (plataforma + chatId). Por eso estos
// comandos no pasan por `step`: van directos al backend con el canal.
const REUNION_ACCEPT_COMMANDS: ReadonlySet<string> = new Set(["/conectar", "/aceptar"]);
const REUNION_REJECT_COMMANDS: ReadonlySet<string> = new Set(["/rechazar", "/rechazo"]);

// Mensajes de cara al usuario para la respuesta del registrante (espanol calido).
const REUNION_ACCEPT_REQUESTED =
  "Gracias. Si la otra parte tambien acepta, les pondremos en contacto para reunirse. " +
  "Nadie comparte su contacto sin el si de ambos.";
const REUNION_ACCEPT_EXCHANGED =
  "Gracias. Ambas partes aceptaron: te enviaremos el contacto en un momento para que se reunan.";
const REUNION_REJECTED =
  "Entendido. No compartiremos tu contacto. Gracias por avisarnos.";
const REUNION_NOTHING_PENDING =
  "No tienes ninguna solicitud de conexion pendiente ahora mismo. Si necesitas algo mas, escribe /ayuda.";
const REUNION_CONSENT_FAILED =
  "No pudimos registrar tu respuesta ahora mismo. Por favor, intentalo de nuevo en un momento.";

// RESCATADO: /reportar_rescatado <personId> — el BUSCADOR reporta haber encontrado a alguien.
const RESCATADO_QUEUED =
  "Gracias. Notificamos a quien registro a esa persona para que confirme el reencuentro. " +
  "Si aceptan, les pondremos en contacto.";
const RESCATADO_HUMAN_REVIEW =
  "El caso requiere revision de nuestro equipo. Nos pondremos en contacto pronto. Gracias.";
const RESCATADO_CONSENT_PENDING =
  "Ya hay una solicitud de reencuentro en curso para esa persona. Espera la respuesta.";
const RESCATADO_OPERATOR_QUEUE =
  "El caso fue derivado a nuestro equipo. Nos pondremos en contacto pronto.";
const RESCATADO_FAILED =
  "No pudimos procesar el reporte ahora mismo. Por favor, intentalo de nuevo en un momento.";
const RESCATADO_NO_PERSON_ID =
  "Por favor, indicame el codigo de la persona. Ejemplo: /reportar_rescatado <codigo>";

// Mensajes del relay (espanol neutral, guardrail #1: sin datos de la otra parte).
const RELAY_FORWARDED = "Mensaje enviado.";
const RELAY_CLOSED_SELF =
  "Conversacion cerrada. Si quieres conectar de nuevo, inicia una nueva busqueda.";
const RELAY_CLOSE_FAILED =
  "No pudimos cerrar la conversacion ahora mismo. Por favor, intentalo de nuevo.";

// REVEAL BILATERAL: /compartir_contacto — solicita compartir el contacto con la otra parte.
// El intercambio solo ocurre cuando AMBAS partes lo pidieron (guardrail #1).
const RELAY_REVEAL_REQUESTED =
  "Solicitud enviada. Compartiremos el contacto cuando la otra persona tambien lo acepte.";
const RELAY_REVEAL_NO_RELAY =
  "No tienes ninguna conexion activa ahora mismo. Si necesitas ayuda, escribe /ayuda.";
const RELAY_REVEAL_FAILED =
  "No pudimos procesar tu solicitud ahora mismo. Por favor, intentalo de nuevo en un momento.";

/**
 * Procesa un update crudo de Telegram de principio a fin. No lanza ante updates
 * raros (los ignora) ni ante fallos del backend (responde un mensaje amable).
 */
export async function handleUpdate(rawUpdate: unknown, deps: UpdateDeps): Promise<void> {
  // 0) Menu inline (callback_query): intercept ANTES de parsear mensaje.
  //    handleMenuCallbackQuery retorna true si lo manejo; false si no aplica.
  //
  // MenuCallbackDeps.sessions uses a wider PersistableState union that includes
  // UnifiedEntryState in addition to ConversationState. We bridge via an adapter
  // that satisfies the wider type. The cast in get() is safe: ConversationState
  // is always a valid PersistableState. The set() cast is also safe because the
  // menu handler only ever writes back a state that originated from the machine.
  if (
    await handleMenuCallbackQuery(rawUpdate, {
      transport: deps.transport,
      sessions: {
        get: (chatId: number) => deps.sessions.get(chatId) as ReturnType<
          Parameters<typeof handleMenuCallbackQuery>[1]["sessions"]["get"]
        >,
        set: (chatId: number, state: ReturnType<
          Parameters<typeof handleMenuCallbackQuery>[1]["sessions"]["get"]
        >) => {
          deps.sessions.set(chatId, state as Parameters<typeof deps.sessions.set>[1]);
        },
      },
    })
  )
    return;

  // 1) Sanear: lo que no sea un mensaje de un chat se ignora con seguridad.
  const parsed = telegramUpdateSchema.safeParse(rawUpdate);
  if (!parsed.success) return;

  const message = parsed.data.message;
  if (message === undefined) return;

  const chatId = message.chat.id;
  // Telegram pone el texto al pie de una foto en `caption`, no en `text`. Tomamos lo
  // primero disponible para no perder lo que la persona escribio al mandar una foto.
  const content = message.text ?? message.caption;
  if (content === undefined) {
    // Contenido sin texto (foto sola, sticker, ubicacion...): guiamos en vez de
    // descartar en silencio, para no dejar a la persona colgada sin respuesta.
    await deps.transport.sendMessage(chatId, NO_TEXT_CONTENT);
    return;
  }

  // REENCUENTRO: /conectar | /rechazar del REGISTRANTE se atienden ANTES de la maquina
  // (comandos globales, sin estado de sesion). Si lo manejamos aqui, terminamos.
  if (await handleReunionConsent(chatId, content, deps)) return;

  // RESCATADO (Slice D): /reportar_rescatado <personId> — el BUSCADOR reporta encontrar alguien.
  // Manejado FUERA de la maquina (como reunionConsent): comando global sin estado de sesion.
  if (await handleReportarRescatado(chatId, content, deps)) return;

  // REVEAL BILATERAL (PR7): /compartir_contacto — solicitar reveal de contacto en relay activo.
  // Comando global fuera de la maquina: requiere relay activo. El intercambio solo ocurre
  // cuando AMBAS partes lo pidieron (guardrail #1: el telefono nunca viaja hasta entonces).
  if (await handleCompartirContacto(chatId, content, deps)) return;

  // Flujo unificado U-1: si la sesion esta en ese flujo, el handler lo maneja.
  if (
    await handleUnifiedEntryUpdate(rawUpdate, {
      transport: deps.transport,
      sessions: deps.sessions as {
        get(chatId: number): unknown;
        set(chatId: number, state: unknown): void;
      },
      backend: {
        searchPersonsUnified: async (query: string) => {
          try {
            return await deps.backend.searchPersons(query);
          } catch {
            return [];
          }
        },
        searchPetsUnified: async (query: string) => {
          try {
            return await deps.backend.searchPets(query);
          } catch {
            return [];
          }
        },
        subscribeToCase: async (_caseId: string, _domain: string) => ({ ok: true }),
      },
    })
  )
    return;

  const input = toInput(content);
  const channel: ChannelIdentity = { plataforma: PLATAFORMA, chatId: String(chatId) };

  // F4 RELAY INTERCEPT — solo para kind:'text'; comandos van siempre a la maquina.
  if (input.kind === "text") {
    if (await handleRelayIntercept(chatId, channel, input.text, deps)) return;
  } else {
    // Comando /cancelar: verificar si hay relay activo para cerrarlo antes de maquina.
    const verb = parseCommandVerb(content);
    if (verb === "/cancelar") {
      if (await handleCancelarRelay(chatId, channel, deps)) return;
    }
  }

  await runConversation(chatId, input, deps);
}

// ── Relay intercept (F4, design v3) ─────────────────────────────────────────

/**
 * Maneja un mensaje de texto cuando hay un relay activo.
 * Retorna true si el mensaje fue procesado por el relay (reenvio o bloqueo).
 * Retorna false si no hay relay activo (el flujo normal de la maquina continua).
 *
 * guardrail #1: el scan de telefono es BLOQUEANTE. Si se detecta un numero:
 *   - NO se reenvía nada.
 *   - Se avisa al emisor con el mensaje de seguridad del scanRelayContent.
 */
async function handleRelayIntercept(
  chatId: number,
  channel: ChannelIdentity,
  text: string,
  deps: UpdateDeps,
): Promise<boolean> {
  let relay;
  try {
    relay = await deps.backend.getActiveRelay(channel);
  } catch {
    relay = null;
  }
  if (relay === null) return false;

  // Scan BLOQUEANTE de contenido (judgment-r3 item 12).
  const scan = scanRelayContent(text);
  if (!scan.ok) {
    await deps.transport.sendMessage(chatId, scan.reason);
    return true;
  }

  // Reenviar el mensaje por la cola del backend (NUNCA Telegram API directa).
  try {
    await deps.backend.forwardRelayMessage(relay.relayId, text, channel);
    await deps.transport.sendMessage(chatId, RELAY_FORWARDED);
  } catch {
    await deps.transport.sendMessage(
      chatId,
      "No pudimos enviar el mensaje ahora mismo. Por favor, intentalo de nuevo.",
    );
  }
  return true;
}

/**
 * Maneja /cancelar cuando hay un relay activo para este canal.
 * Retorna true si el relay fue cerrado (y el comando fue manejado por el relay).
 * Retorna false si no hay relay activo (la maquina debe manejar /cancelar normalmente).
 */
async function handleCancelarRelay(
  chatId: number,
  channel: ChannelIdentity,
  deps: UpdateDeps,
): Promise<boolean> {
  let relay;
  try {
    relay = await deps.backend.getActiveRelay(channel);
  } catch {
    relay = null;
  }
  if (relay === null) return false;

  try {
    await deps.backend.closeRelay(relay.relayId, channel);
    await deps.transport.sendMessage(chatId, RELAY_CLOSED_SELF);
  } catch {
    await deps.transport.sendMessage(chatId, RELAY_CLOSE_FAILED);
  }
  return true;
}

/**
 * Atiende el comando /compartir_contacto: solicita el reveal bilateral del contacto
 * en el relay activo de este canal. Retorna true si el comando fue atendido.
 *
 * Solo funciona si hay un relay activo. El intercambio de contacto solo ocurre cuando
 * AMBAS partes lo piden (guardrail #1): aqui solo se registra la solicitud del canal
 * que llama; el backend notifica al otro lado y entrega el teléfono si ambos acordaron.
 */
async function handleCompartirContacto(
  chatId: number,
  content: string,
  deps: UpdateDeps,
): Promise<boolean> {
  const verb = parseCommandVerb(content);
  if (verb !== "/compartir_contacto") return false;

  const channel: ChannelIdentity = { plataforma: PLATAFORMA, chatId: String(chatId) };

  // Verificar que hay un relay activo para este canal.
  let relay;
  try {
    relay = await deps.backend.getActiveRelay(channel);
  } catch {
    relay = null;
  }

  if (relay === null) {
    await deps.transport.sendMessage(chatId, RELAY_REVEAL_NO_RELAY);
    return true;
  }

  // Solicitar el reveal bilateral al backend.
  try {
    await deps.backend.requestRelayReveal(relay.relayId, channel);
    await deps.transport.sendMessage(chatId, RELAY_REVEAL_REQUESTED);
  } catch {
    await deps.transport.sendMessage(chatId, RELAY_REVEAL_FAILED);
  }
  return true;
}

/** Extrae el verbo de un comando del texto (ej. '/cancelar @bot args' -> '/cancelar'). */
function parseCommandVerb(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return "";
  return trimmed.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";
}

// ── Reunion consent (commands /conectar | /rechazar) ─────────────────────────

/**
 * Atiende los comandos GLOBALES de reencuentro del registrante (/conectar | /rechazar).
 * Devuelve `true` si el contenido era uno de esos comandos (y ya se respondio), o
 * `false` si no lo era (para que siga el flujo normal de la maquina).
 *
 * No usa la sesion: el backend correlaciona la solicitud pendiente por la PROPIEDAD del
 * canal. El contacto, si ambos aceptan, llega despues por notificacion (nunca aqui).
 */
async function handleReunionConsent(
  chatId: number,
  content: string,
  deps: UpdateDeps,
): Promise<boolean> {
  const verb = content.trim().split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";
  const isAccept = REUNION_ACCEPT_COMMANDS.has(verb);
  const isReject = REUNION_REJECT_COMMANDS.has(verb);
  if (!isAccept && !isReject) return false;

  const channel: ChannelIdentity = { plataforma: PLATAFORMA, chatId: String(chatId) };
  const decision = isAccept ? "aceptado" : "rechazado";
  try {
    const status = await deps.backend.reunionConsent(decision, channel);
    await deps.transport.sendMessage(chatId, reunionConsentMessage(status));
  } catch {
    // Fallo del backend: mensaje generico, sin filtrar detalles internos (guardrail #1/#6).
    await deps.transport.sendMessage(chatId, REUNION_CONSENT_FAILED);
  }
  return true;
}

/**
 * Atiende el comando /reportar_rescatado <personId> del BUSCADOR.
 * Devuelve `true` si el contenido era ese comando (ya se respondio), o `false`.
 *
 * El personId llega como segundo token del comando; si falta, pedimos que lo indique.
 * No usa sesion: es un comando global, similar a /conectar.
 */
async function handleReportarRescatado(
  chatId: number,
  content: string,
  deps: UpdateDeps,
): Promise<boolean> {
  const tokens = content.trim().split(/\s+/);
  const verb = (tokens[0] ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (verb !== "/reportar_rescatado") return false;

  const personId = tokens[1];
  if (personId === undefined || personId.trim().length === 0) {
    await deps.transport.sendMessage(chatId, RESCATADO_NO_PERSON_ID);
    return true;
  }

  const channel: ChannelIdentity = { plataforma: PLATAFORMA, chatId: String(chatId) };
  try {
    const status = await deps.backend.reportRescatado(personId.trim(), channel);
    await deps.transport.sendMessage(chatId, rescatadoMessage(status));
  } catch {
    await deps.transport.sendMessage(chatId, RESCATADO_FAILED);
  }
  return true;
}

/** Traduce el outcome del rescatado a un mensaje calido y claro. Sin datos de contacto. */
function rescatadoMessage(status: RescatadoStatus): string {
  switch (status) {
    case "queued":
      return RESCATADO_QUEUED;
    case "human_review":
      return RESCATADO_HUMAN_REVIEW;
    case "consent_pending":
      return RESCATADO_CONSENT_PENDING;
    case "operator_queue":
      return RESCATADO_OPERATOR_QUEUE;
    case "failed":
      return RESCATADO_FAILED;
  }
}

/** Traduce el estado del consentimiento del registrante a un mensaje calido. */
function reunionConsentMessage(status: ReunionConsentStatus): string {
  switch (status) {
    case "exchanged":
      return REUNION_ACCEPT_EXCHANGED;
    case "accepted_waiting":
      return REUNION_ACCEPT_REQUESTED;
    case "rejected":
      return REUNION_REJECTED;
    case "not_found":
      return REUNION_NOTHING_PENDING;
  }
}

/** Mapea el texto del usuario a una entrada de la maquina (texto o comando). */
function toInput(text: string): ConversationInput {
  const trimmed = text.trim();
  if (trimmed.startsWith("/")) {
    // El comando puede venir con argumentos o con @nombrebot; tomamos el verbo.
    const verb = trimmed.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? trimmed;
    const command = COMMANDS[verb] ?? verb;
    return { kind: "command", command };
  }
  return { kind: "text", text };
}

/**
 * Corre la maquina con una entrada, envia las respuestas, y si hay un efecto lo
 * ejecuta y vuelve a correr la maquina con el `effect_result`. Persiste el estado
 * final una sola vez al terminar.
 */
async function runConversation(
  chatId: number,
  input: ConversationInput,
  deps: UpdateDeps,
): Promise<void> {
  const current = deps.sessions.get(chatId) ?? initialState;
  const result = step(current, input);

  await sendReplies(chatId, result.replies, deps.transport);

  if (result.effect === undefined) {
    deps.sessions.set(chatId, result.state);
    return;
  }

  // Hay un efecto: lo ejecutamos y re-inyectamos su resultado en la maquina.
  // La identidad del canal (plataforma + chatId como cadena) viaja al backend para
  // vincular registros/busquedas al usuario y autorizar su borrado.
  const channel: ChannelIdentity = { plataforma: PLATAFORMA, chatId: String(chatId) };
  await runEffect(chatId, channel, result, deps);
}

/**
 * Ejecuta el efecto pedido por la maquina contra el backend y re-inyecta el
 * `effect_result`. La maquina emite entonces la respuesta final, que enviamos.
 */
async function runEffect(
  chatId: number,
  channel: ChannelIdentity,
  pending: StepResult,
  deps: UpdateDeps,
): Promise<void> {
  const effect = pending.effect;
  if (effect === undefined) {
    deps.sessions.set(chatId, pending.state);
    return;
  }

  const effectResult = await executeEffect(effect, channel, deps.backend);
  if (effectResult === null) {
    // Fallo del backend ya comunicado al usuario; volvemos a idle sin re-inyectar.
    await deps.transport.sendMessage(chatId, SEARCH_FAILED);
    deps.sessions.set(chatId, initialState);
    return;
  }

  // Re-inyectamos el resultado: la maquina produce ahora la respuesta final.
  const finalResult = step(pending.state, {
    kind: "effect_result",
    result: effectResult,
  });
  await sendReplies(chatId, finalResult.replies, deps.transport);
  deps.sessions.set(chatId, finalResult.state);
}

/**
 * Llama al backend segun el efecto y devuelve el `EffectResult` a re-inyectar.
 * Devuelve `null` SOLO cuando el fallo no se puede representar como resultado de
 * la maquina (p. ej. la busqueda lanza); en ese caso el llamador responde amable.
 *
 * NUNCA pide ni procesa `contact_id`: registrar/buscar mandan lo que arma la maquina
 * (sin contacto de terceros) y las busquedas reciben la vista publica. El vinculo
 * usuario<->canal viaja en `channel` para que el backend autorice el borrado y pueda
 * notificar despues por el canal correcto.
 */
async function executeEffect(
  effect: Effect,
  channel: ChannelIdentity,
  backend: BackendClient,
): Promise<EffectResult | null> {
  switch (effect.type) {
    case "create_person": {
      try {
        // Registro VINCULADO al canal: el backend persiste channel + opt_in.
        // Devolvemos el id para que la maquina se lo entregue al usuario (derecho
        // al borrado, principio #5). El id NO es PII de contacto (guardrail #1).
        const { id } = await backend.registerPerson(effect.data, channel);
        return { type: "create_person", ok: true, id };
      } catch {
        // Fallo de alta: la maquina sabe re-pedir confirmacion con REGISTER_FAILED.
        // No propagamos el detalle interno del error (guardrail #1/#6).
        return { type: "create_person", ok: false };
      }
    }
    case "create_pet": {
      try {
        // Alta de mascota VINCULADA al canal: el backend persiste channel + opt_in.
        // Devolvemos el id de la mascota (no es PII de contacto) para el borrado.
        const { id } = await backend.registerPet(effect.data, channel);
        return { type: "create_pet", ok: true, id };
      } catch {
        // Fallo de alta: la maquina re-pide confirmacion con REGISTER_PET_FAILED.
        return { type: "create_pet", ok: false };
      }
    }
    case "search_persons": {
      try {
        // Pasamos el canal para vincular al buscador (lo notificaremos si hay match).
        // `zona` y `descripcion` son los campos estructurados que el matcher pondera.
        // `es_menor` es la respuesta EXPLICITA del usuario al paso 'menor' (R2-4a).
        const results = await backend.searchPersons(
          effect.query,
          effect.zona,
          channel,
          effect.descripcion,
          effect.es_menor,
        );
        return { type: "search_persons", results };
      } catch {
        // La maquina no modela "busqueda fallida"; lo gestiona el adaptador (null).
        return null;
      }
    }
    case "search_pets": {
      try {
        const results = await backend.searchPets(effect.query, effect.zona);
        return { type: "search_pets", results };
      } catch {
        // Igual que personas: el fallo de busqueda lo gestiona el adaptador (null).
        return null;
      }
    }
    case "list_my_persons": {
      try {
        // El dueno lista SUS registros para marcar/borrar (autoriza por canal). La
        // respuesta es la vista del dueno (sin contacto). El fallo lo gestiona el
        // adaptador (null -> mensaje generico, igual que las demas lecturas).
        const persons = await backend.listMyPersons(channel);
        return { type: "list_my_persons", persons };
      } catch {
        return null;
      }
    }
    case "list_zones": {
      try {
        // Lectura publica del mapa (sin contacto). El fallo lo gestiona el adaptador.
        const zones = await backend.listZones();
        return { type: "list_zones", zones };
      } catch {
        return null;
      }
    }
    case "list_needs": {
      try {
        const needs = await backend.listNeeds();
        return { type: "list_needs", needs };
      } catch {
        return null;
      }
    }
    case "delete_person": {
      try {
        // El backend autoriza con el vinculo del canal (solo el dueno puede borrar).
        await backend.deleteByChannel(effect.personId, channel);
        return { type: "delete_person", ok: true };
      } catch {
        // 403 (no es el dueno) y cualquier otro fallo se modelan IGUAL como ok:false:
        // la maquina muestra DELETE_FAILED sin revelar si el registro existe ni de
        // quien es (guardrail #1: no confirmar pertenencia a un tercero).
        return { type: "delete_person", ok: false };
      }
    }
    case "mark_found": {
      try {
        // El backend autoriza con el vinculo del canal (solo el dueno puede marcar).
        await backend.markFoundByChannel(effect.personId, channel);
        return { type: "mark_found", ok: true };
      } catch {
        // 403 (no es el dueno) y cualquier otro fallo se modelan IGUAL como ok:false:
        // la maquina muestra MARK_FOUND_FAILED sin revelar si el registro existe ni
        // de quien es (guardrail #1: no confirmar pertenencia a un tercero).
        return { type: "mark_found", ok: false };
      }
    }
    case "request_reunion": {
      try {
        // El BUSCADOR inicia el reencuentro con la persona elegida. El backend pide el
        // consentimiento de la otra parte; NO se comparte contacto. Pasamos el canal
        // para que el backend correlacione al buscador por su propiedad del canal.
        const status = await backend.requestReunion(effect.personId, channel);
        return { type: "request_reunion", status };
      } catch {
        // Cualquier fallo se modela como 'failed': mensaje generico, sin revelar si el
        // registro existe ni de quien es (guardrail #1).
        return { type: "request_reunion", status: "failed" };
      }
    }
  }
}

/** Envia en orden todas las respuestas de un paso por el transporte. */
async function sendReplies(
  chatId: number,
  replies: readonly Reply[],
  transport: TelegramTransport,
): Promise<void> {
  for (const r of replies) {
    await transport.sendMessage(chatId, r.text, r.buttons);
  }
}

export type { ConversationState };
