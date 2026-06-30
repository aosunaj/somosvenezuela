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
import { whatsappWebhookSchema } from "./whatsapp-types.js";
import type {
  BackendClient,
  ChannelIdentity,
  ReunionConsentStatus,
  SessionStore,
  WhatsAppTransport,
} from "./ports.js";

/** Plataforma fija de este adaptador (el backend la usa para el vinculo del canal). */
const PLATAFORMA = "whatsapp" as const;

// Orquestador del adaptador: pega la maquina de `core` con WhatsApp y el backend.
// Espejo del orquestador de Telegram; reutiliza la MISMA maquina compartida.
//
// Responsabilidad UNICA (sin reglas de negocio):
//   1. Sanear el webhook de WhatsApp y mapear cada mensaje de texto a ConversationInput.
//   2. Correr la maquina (step) y enviar sus `replies` por el transporte.
//   3. Si la maquina pide un `effect`, ejecutarlo contra el backend y re-inyectar el
//      resultado como `effect_result`, enviando luego la respuesta final.
//   4. Persistir el ConversationState entre mensajes del mismo usuario (wa_id).
//
// Toda la logica de dialogo (que pedir, como validar, cuando confirmar) vive en la
// maquina; aqui solo hay transporte, formato y ejecucion de efectos.

/** Dependencias inyectables del orquestador (todo el I/O detras de interfaces). */
export interface UpdateDeps {
  readonly transport: WhatsAppTransport;
  readonly backend: BackendClient;
  readonly sessions: SessionStore;
}

// Mensaje amable ante un fallo de busqueda (no filtra detalles internos).
const SEARCH_FAILED =
  "No pudimos completar la busqueda ahora mismo. Por favor, intentalo de nuevo en un momento.";

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
// usuario, asi que NO hay un estado de sesion que correlacione. El backend correlaciona
// la solicitud pendiente por la PROPIEDAD del canal (plataforma + wa_id). Por eso estos
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

/**
 * Procesa un payload crudo del webhook de WhatsApp de principio a fin. No lanza ante
 * payloads raros (los ignora) ni ante fallos del backend (responde un mensaje amable).
 * Un mismo webhook puede traer varios mensajes; se procesan en orden.
 */
export async function handleUpdate(rawUpdate: unknown, deps: UpdateDeps): Promise<void> {
  // 1) Sanear: cualquier cosa que no encaje con el esquema del webhook se ignora.
  const parsed = whatsappWebhookSchema.safeParse(rawUpdate);
  if (!parsed.success) return;

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages;
      if (messages === undefined) continue; // p. ej. eventos de estado (statuses).
      for (const message of messages) {
        const text = message.text?.body;
        // Mensajes sin texto (foto, audio, ubicacion, interactivos...) no se procesan
        // en este slice. `from` es el wa_id del remitente.
        if (text === undefined) continue;
        // REENCUENTRO: /conectar | /rechazar del REGISTRANTE se atienden ANTES de la
        // maquina (comandos globales, sin estado de sesion). Si lo manejamos, seguimos.
        if (await handleReunionConsent(message.from, text, deps)) continue;
        const input = toInput(text);
        await runConversation(message.from, input, deps);
      }
    }
  }
}

/**
 * Atiende los comandos GLOBALES de reencuentro del registrante (/conectar | /rechazar).
 * Devuelve `true` si el texto era uno de esos comandos (y ya se respondio), o `false`
 * si no lo era (para que siga el flujo normal de la maquina).
 *
 * No usa la sesion: el backend correlaciona la solicitud pendiente por la PROPIEDAD del
 * canal. El contacto, si ambos aceptan, llega despues por notificacion (nunca aqui).
 */
async function handleReunionConsent(
  waId: string,
  content: string,
  deps: UpdateDeps,
): Promise<boolean> {
  const verb = content.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const isAccept = REUNION_ACCEPT_COMMANDS.has(verb);
  const isReject = REUNION_REJECT_COMMANDS.has(verb);
  if (!isAccept && !isReject) return false;

  const channel: ChannelIdentity = { plataforma: PLATAFORMA, chatId: waId };
  const decision = isAccept ? "aceptado" : "rechazado";
  try {
    const status = await deps.backend.reunionConsent(decision, channel);
    await deps.transport.sendMessage(waId, reunionConsentMessage(status));
  } catch {
    // Fallo del backend: mensaje generico, sin filtrar detalles internos (guardrail #1/#6).
    await deps.transport.sendMessage(waId, REUNION_CONSENT_FAILED);
  }
  return true;
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
    // El comando puede venir con argumentos; tomamos el verbo en minusculas.
    const verb = trimmed.split(/\s+/)[0]?.toLowerCase() ?? trimmed;
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
  waId: string,
  input: ConversationInput,
  deps: UpdateDeps,
): Promise<void> {
  const current = deps.sessions.get(waId) ?? initialState;
  const result = step(current, input);

  await sendReplies(waId, result.replies, deps.transport);

  if (result.effect === undefined) {
    deps.sessions.set(waId, result.state);
    return;
  }

  // Hay un efecto: lo ejecutamos y re-inyectamos su resultado en la maquina.
  // La identidad del canal (plataforma + wa_id, que ya es cadena) viaja al backend
  // para vincular registros/busquedas al usuario y autorizar su borrado.
  const channel: ChannelIdentity = { plataforma: PLATAFORMA, chatId: waId };
  await runEffect(waId, channel, result, deps);
}

/**
 * Ejecuta el efecto pedido por la maquina contra el backend y re-inyecta el
 * `effect_result`. La maquina emite entonces la respuesta final, que enviamos.
 */
async function runEffect(
  waId: string,
  channel: ChannelIdentity,
  pending: StepResult,
  deps: UpdateDeps,
): Promise<void> {
  const effect = pending.effect;
  if (effect === undefined) {
    deps.sessions.set(waId, pending.state);
    return;
  }

  const effectResult = await executeEffect(effect, channel, deps.backend);
  if (effectResult === null) {
    // Fallo del backend ya comunicado al usuario; volvemos a idle sin re-inyectar.
    await deps.transport.sendMessage(waId, SEARCH_FAILED);
    deps.sessions.set(waId, initialState);
    return;
  }

  // Re-inyectamos el resultado: la maquina produce ahora la respuesta final.
  const finalResult = step(pending.state, {
    kind: "effect_result",
    result: effectResult,
  });
  await sendReplies(waId, finalResult.replies, deps.transport);
  deps.sessions.set(waId, finalResult.state);
}

/**
 * Llama al backend segun el efecto y devuelve el `EffectResult` a re-inyectar.
 * Devuelve `null` SOLO cuando el fallo no se puede representar como resultado de la
 * maquina (p. ej. la busqueda lanza); en ese caso el llamador responde amable.
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
        const results = await backend.searchPersons(
          effect.query,
          effect.zona,
          channel,
          effect.descripcion,
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
  waId: string,
  replies: readonly Reply[],
  transport: WhatsAppTransport,
): Promise<void> {
  for (const r of replies) {
    await transport.sendMessage(waId, r.text, r.buttons);
  }
}

export type { ConversationState };
