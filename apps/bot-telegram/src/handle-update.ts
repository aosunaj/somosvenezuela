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
import { telegramUpdateSchema } from "./telegram-types.js";
import type {
  BackendClient,
  ChannelIdentity,
  SessionStore,
  TelegramTransport,
} from "./ports.js";

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

/**
 * Procesa un update crudo de Telegram de principio a fin. No lanza ante updates
 * raros (los ignora) ni ante fallos del backend (responde un mensaje amable).
 */
export async function handleUpdate(rawUpdate: unknown, deps: UpdateDeps): Promise<void> {
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

  const input = toInput(content);
  await runConversation(chatId, input, deps);
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
        const results = await backend.searchPersons(effect.query, effect.zona, channel);
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
