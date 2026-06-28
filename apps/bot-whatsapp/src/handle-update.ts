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
import type { BackendClient, SessionStore, WhatsAppTransport } from "./ports.js";

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

// Mensaje amable cuando el borrado todavia no esta disponible (slice siguiente).
const DELETE_NOT_AVAILABLE =
  "El borrado estara disponible muy pronto. Por ahora puedo ayudarte a registrar o buscar.";

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
        const input = toInput(text);
        await runConversation(message.from, input, deps);
      }
    }
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
  await runEffect(waId, result, deps);
}

/**
 * Ejecuta el efecto pedido por la maquina contra el backend y re-inyecta el
 * `effect_result`. La maquina emite entonces la respuesta final, que enviamos.
 */
async function runEffect(
  waId: string,
  pending: StepResult,
  deps: UpdateDeps,
): Promise<void> {
  const effect = pending.effect;
  if (effect === undefined) {
    deps.sessions.set(waId, pending.state);
    return;
  }

  // El borrado seguro es el slice siguiente: requiere el vinculo usuario<->canal
  // (tabla `channels` + opt_in) para autorizar que el dueno borre su registro.
  // Hasta entonces NO ejecutamos delete_person: respondemos amable y volvemos a
  // idle, descartando el estado de borrado pendiente.
  if (effect.type === "delete_person") {
    await deps.transport.sendMessage(waId, DELETE_NOT_AVAILABLE);
    deps.sessions.set(waId, initialState);
    return;
  }

  const effectResult = await executeEffect(effect, deps.backend);
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
 * NUNCA pide ni procesa `contact_id`: create_person manda lo que arma la maquina (sin
 * contacto) y search_persons recibe la vista publica.
 */
async function executeEffect(
  effect: Exclude<Effect, { type: "delete_person" }>,
  backend: BackendClient,
): Promise<EffectResult | null> {
  switch (effect.type) {
    case "create_person": {
      try {
        await backend.createPerson(effect.data);
        return { type: "create_person", ok: true };
      } catch {
        // Fallo de alta: la maquina sabe re-pedir confirmacion con REGISTER_FAILED.
        // No propagamos el detalle interno del error (guardrail #1/#6).
        return { type: "create_person", ok: false };
      }
    }
    case "search_persons": {
      try {
        const results = await backend.searchPersons(effect.query, effect.zona);
        return { type: "search_persons", results };
      } catch {
        // La maquina no modela "busqueda fallida"; lo gestiona el adaptador (null).
        return null;
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
