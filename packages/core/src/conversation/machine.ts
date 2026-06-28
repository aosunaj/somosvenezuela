import { edadSchema, idSchema, personCreateSchema } from "../schemas.js";
import type { PersonCreate } from "../schemas.js";
import { DEFAULT_FUENTE } from "../enums.js";
import * as M from "./messages.js";
import {
  initialState,
  type ConversationInput,
  type ConversationState,
  type Effect,
  type RegisterDraft,
  type Reply,
  type StepResult,
} from "./state.js";

// Maquina de conversacion COMPARTIDA como REDUCER PURO.
//   step(state, input) -> { state, replies, effect? }
//
// Sin efectos secundarios: no toca red, BD ni Telegram. Es 100% testeable.
// Toda entrada del usuario se valida con los schemas de core antes de aceptarla;
// ante un dato invalido, la maquina RE-PIDE el dato (no avanza, no lanza).

// Comandos universales que el adaptador normaliza (en minusculas, con barra).
const CMD_START = "/start";
const CMD_HELP = "/ayuda";
const CMD_CANCEL = "/cancelar";

// Etiquetas de menu que, como texto, equivalen a elegir una opcion. Permite que
// el adaptador mande el texto del boton sin tener que mapearlo a un comando.
const MENU_TEXT: Record<string, "register" | "search" | "delete" | "help"> = {
  [M.BUTTON.registrar.toLowerCase()]: "register",
  [M.BUTTON.buscar.toLowerCase()]: "search",
  [M.BUTTON.borrar.toLowerCase()]: "delete",
  [M.BUTTON.ayuda.toLowerCase()]: "help",
};

const SKIP_TOKEN = M.BUTTON.omitir.toLowerCase();
const CONFIRM_TOKEN = M.BUTTON.confirmar.toLowerCase();

// ── Helpers de construccion de salida ────────────────────────────────────────

function reply(text: string, buttons?: readonly (readonly string[])[]): Reply {
  return buttons ? { text, buttons } : { text };
}

function result(
  state: ConversationState,
  replies: readonly Reply[],
  effect?: Effect,
): StepResult {
  return effect ? { state, replies, effect } : { state, replies };
}

/** Vuelve a idle mostrando el menu principal. */
function toMenu(text: string): StepResult {
  return result(initialState, [reply(text, M.menuButtons())]);
}

// ── Entradas globales (comandos que aplican en cualquier estado) ─────────────

function handleGlobalCommand(command: string): StepResult | null {
  switch (command) {
    case CMD_START:
      return toMenu(M.WELCOME);
    case CMD_HELP:
      return result(initialState, [reply(M.HELP), reply(M.WELCOME, M.menuButtons())]);
    case CMD_CANCEL:
      // /cancelar limpia cualquier draft y vuelve a idle (requisito MVP).
      return toMenu(M.CANCELLED);
    default:
      return null;
  }
}

/** Detecta si un texto del menu inicia un flujo; devuelve el arranque o null. */
function startFlowFromText(text: string): StepResult | null {
  const choice = MENU_TEXT[text.trim().toLowerCase()];
  if (!choice) return null;
  return startFlow(choice);
}

function startFlow(choice: "register" | "search" | "delete" | "help"): StepResult {
  switch (choice) {
    case "register":
      return result(
        { flow: "register", step: "nombre", draft: {} },
        [reply(M.REGISTER_ASK_NOMBRE)],
      );
    case "search":
      return result({ flow: "search", step: "query" }, [reply(M.SEARCH_ASK_QUERY)]);
    case "delete":
      return result({ flow: "delete", step: "id" }, [reply(M.DELETE_ASK_ID)]);
    case "help":
      return result(initialState, [reply(M.HELP), reply(M.WELCOME, M.menuButtons())]);
  }
}

// ── Reducer principal ────────────────────────────────────────────────────────

/**
 * Funcion pura: dado un estado y una entrada, produce el nuevo estado, las
 * respuestas y, como mucho, un efecto para que el adaptador lo ejecute.
 */
export function step(state: ConversationState, input: ConversationInput): StepResult {
  // 1) Comandos globales tienen prioridad en cualquier estado.
  if (input.kind === "command") {
    const handled = handleGlobalCommand(input.command);
    if (handled) return handled;
    // Comando desconocido: no rompe el flujo; avisa y mantiene el estado.
    return result(state, [reply(M.UNKNOWN_COMMAND)]);
  }

  // 2) Despacho por flujo activo. Aqui `input` ya esta acotado a texto/resultado
  //    (los comandos retornaron arriba).
  switch (state.flow) {
    case "idle":
      return stepIdle(input);
    case "register":
      return stepRegister(state, input);
    case "search":
      return stepSearch(state, input);
    case "delete":
      return stepDelete(state, input);
  }
}

/** Entrada acotada que reciben los handlers de flujo (sin comandos). */
type FlowInput = Extract<ConversationInput, { kind: "text" | "effect_result" }>;

// ── Flujo: idle / menu ───────────────────────────────────────────────────────

function stepIdle(
  input: Extract<ConversationInput, { kind: "text" | "effect_result" }>,
): StepResult {
  if (input.kind === "effect_result") {
    // No esperabamos un resultado en idle; lo ignoramos y reofrecemos el menu.
    return toMenu(M.WELCOME);
  }
  const started = startFlowFromText(input.text);
  if (started) return started;
  // Texto libre en idle: guiamos con el menu.
  return toMenu(M.WELCOME);
}

// ── Flujo: registrar persona ─────────────────────────────────────────────────

type RegisterState = Extract<ConversationState, { flow: "register" }>;

function stepRegister(state: RegisterState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    if (state.step !== "submitting" || input.result.type !== "create_person") {
      // Resultado inesperado: reofrecemos confirmar sin perder el draft.
      return result(state, [reply(M.registerSummary(requireNombre(state.draft)), M.confirmButtons())]);
    }
    return input.result.ok
      ? toMenu(M.REGISTER_DONE)
      : result(state, [reply(M.REGISTER_FAILED, M.confirmButtons())]);
  }

  // input.kind === 'text'
  const text = input.text;
  switch (state.step) {
    case "nombre":
      return registerSetNombre(state.draft, text);
    case "apellidos":
      return registerSetOptionalTexto(state, text, "apellidos", "edad", M.REGISTER_ASK_EDAD, M.skipButtons());
    case "edad":
      return registerSetEdad(state, text);
    case "zona":
      return registerSetOptionalTexto(state, text, "zona", "descripcion", M.REGISTER_ASK_DESCRIPCION, M.skipButtons());
    case "descripcion":
      return registerSetDescripcion(state, text);
    case "confirm":
      return registerConfirm(state, text);
    case "submitting":
      // Esperando el effect_result; ignoramos el texto sin emitir respuesta.
      return result(state, []);
  }
}

/** El nombre es obligatorio: si queda vacio, re-pide sin avanzar. */
function registerSetNombre(draft: RegisterDraft, text: string): StepResult {
  const parsed = personCreateSchema.shape.nombre.safeParse(text);
  if (!parsed.success) {
    return result(
      { flow: "register", step: "nombre", draft },
      [reply(M.REGISTER_INVALID_NOMBRE)],
    );
  }
  return result(
    { flow: "register", step: "apellidos", draft: { ...draft, nombre: parsed.data } },
    [reply(M.REGISTER_ASK_APELLIDOS, M.skipButtons())],
  );
}

/** Edad opcional: vacio/Omitir => null; numero invalido => re-pide. */
function registerSetEdad(state: RegisterState, text: string): StepResult {
  if (isSkip(text)) {
    return advanceRegister(state, { edad: null }, "zona", M.REGISTER_ASK_ZONA, M.skipButtons());
  }
  const n = Number(text.trim());
  // Number("") es 0; exigimos que el texto sea realmente numerico.
  const looksNumeric = text.trim() !== "" && Number.isFinite(n);
  const parsed = looksNumeric ? edadSchema.safeParse(n) : { success: false as const };
  if (!parsed.success) {
    return result(
      { flow: "register", step: "edad", draft: state.draft },
      [reply(M.REGISTER_INVALID_EDAD, M.skipButtons())],
    );
  }
  return advanceRegister(state, { edad: parsed.data }, "zona", M.REGISTER_ASK_ZONA, M.skipButtons());
}

/**
 * Paso de texto opcional generico (apellidos, zona): Omitir => null; texto no
 * vacio => se valida con el schema correspondiente; vacio sin omitir => re-pide.
 */
function registerSetOptionalTexto(
  state: RegisterState,
  text: string,
  field: "apellidos" | "zona",
  nextStep: "edad" | "descripcion",
  nextPrompt: string,
  nextButtons: readonly (readonly string[])[],
): StepResult {
  if (isSkip(text)) {
    return advanceRegister(state, { [field]: null }, nextStep, nextPrompt, nextButtons);
  }
  const parsed = personCreateSchema.shape[field].safeParse(text);
  if (!parsed.success || parsed.data == null) {
    return result(
      { flow: "register", step: field, draft: state.draft },
      [reply(M.REGISTER_INVALID_TEXTO, M.skipButtons())],
    );
  }
  return advanceRegister(state, { [field]: parsed.data }, nextStep, nextPrompt, nextButtons);
}

/** Ultimo paso opcional (descripcion): tras el va el resumen + confirmacion. */
function registerSetDescripcion(state: RegisterState, text: string): StepResult {
  let value: string | null;
  if (isSkip(text)) {
    value = null;
  } else {
    const parsed = personCreateSchema.shape.descripcion.safeParse(text);
    if (!parsed.success || parsed.data == null) {
      return result(
        { flow: "register", step: "descripcion", draft: state.draft },
        [reply(M.REGISTER_INVALID_TEXTO, M.skipButtons())],
      );
    }
    value = parsed.data;
  }
  const draft: RegisterDraft = { ...state.draft, descripcion: value };
  return result(
    { flow: "register", step: "confirm", draft },
    [reply(M.registerSummary(requireNombre(draft)), M.confirmButtons())],
  );
}

/** En confirm: Confirmar => emite el efecto create_person; otro => re-pide resumen. */
function registerConfirm(state: RegisterState, text: string): StepResult {
  if (!isConfirm(text)) {
    return result(state, [reply(M.registerSummary(requireNombre(state.draft)), M.confirmButtons())]);
  }
  const data = buildPersonCreate(state.draft);
  return result(
    { flow: "register", step: "submitting", draft: state.draft },
    [], // sin respuesta aun: la final llega tras el effect_result
    { type: "create_person", data },
  );
}

/** Construye el `PersonCreate` validado a partir del draft acumulado. */
function buildPersonCreate(draft: RegisterDraft): PersonCreate {
  // El registro nace propio/sin_verificar/desaparecida por los defaults del dominio;
  // aqui solo fijamos la fuente. NO incluimos contact_id (guardrail #1).
  return personCreateSchema.parse({
    nombre: draft.nombre,
    apellidos: draft.apellidos ?? undefined,
    edad: draft.edad ?? undefined,
    zona: draft.zona ?? undefined,
    descripcion: draft.descripcion ?? undefined,
    fuente: DEFAULT_FUENTE,
  });
}

/** Avanza el registro fusionando el draft y pasando al siguiente paso. */
function advanceRegister(
  state: RegisterState,
  patch: Partial<RegisterDraft>,
  nextStep: RegisterState["step"],
  prompt: string,
  buttons?: readonly (readonly string[])[],
): StepResult {
  const draft: RegisterDraft = { ...state.draft, ...patch };
  return result({ flow: "register", step: nextStep, draft }, [reply(prompt, buttons)]);
}

/** Garantiza que el resumen siempre recibe un nombre (ya validado antes). */
function requireNombre(draft: RegisterDraft): RegisterDraft & { nombre: string } {
  return { ...draft, nombre: draft.nombre ?? "" };
}

// ── Flujo: buscar ────────────────────────────────────────────────────────────

type SearchState = Extract<ConversationState, { flow: "search" }>;

function stepSearch(state: SearchState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    if (state.step !== "searching" || input.result.type !== "search_persons") {
      return result({ flow: "search", step: "query" }, [reply(M.SEARCH_ASK_QUERY)]);
    }
    const { results } = input.result;
    const text = results.length === 0 ? M.SEARCH_NO_RESULTS : M.searchResults(results);
    // Tras mostrar resultados volvemos a idle con el menu.
    return result(initialState, [reply(text), reply(M.WELCOME, M.menuButtons())]);
  }

  // input.kind === 'text'
  if (state.step === "searching") {
    // Esperando resultados; ignoramos texto.
    return result(state, []);
  }
  const query = input.text.trim();
  if (query.length === 0) {
    return result({ flow: "search", step: "query" }, [reply(M.SEARCH_INVALID_QUERY)]);
  }
  // Emite el efecto; el adaptador buscara y re-inyectara los resultados.
  // No incluimos contacto: la busqueda usa la vista publica (guardrail #1).
  return result(
    { flow: "search", step: "searching", query },
    [],
    { type: "search_persons", query },
  );
}

// ── Flujo: borrar ────────────────────────────────────────────────────────────

type DeleteState = Extract<ConversationState, { flow: "delete" }>;

function stepDelete(state: DeleteState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    if (state.step !== "deleting" || input.result.type !== "delete_person") {
      return result({ flow: "delete", step: "id" }, [reply(M.DELETE_ASK_ID)]);
    }
    return input.result.ok
      ? toMenu(M.DELETE_DONE)
      : result(
          { flow: "delete", step: "id" },
          [reply(M.DELETE_FAILED)],
        );
  }

  // input.kind === 'text'
  switch (state.step) {
    case "id": {
      const id = input.text.trim();
      const parsed = idSchema.safeParse(id);
      if (!parsed.success) {
        return result({ flow: "delete", step: "id" }, [reply(M.DELETE_INVALID_ID)]);
      }
      return result(
        { flow: "delete", step: "confirm", personId: parsed.data },
        [reply(M.deleteConfirm(parsed.data), M.confirmButtons())],
      );
    }
    case "confirm": {
      if (!isConfirm(input.text)) {
        // Cualquier respuesta que no sea confirmar re-pide la confirmacion.
        const pid = state.personId ?? "";
        return result(state, [reply(M.deleteConfirm(pid), M.confirmButtons())]);
      }
      const personId = state.personId ?? "";
      // La autorizacion real (que sea el dueno) la hace el adaptador/backend.
      return result(
        { flow: "delete", step: "deleting", personId },
        [],
        { type: "delete_person", personId },
      );
    }
    case "deleting":
      // Esperando el effect_result; ignoramos texto.
      return result(state, []);
  }
}

// ── Tokens de entrada ────────────────────────────────────────────────────────

function isSkip(text: string): boolean {
  return text.trim().toLowerCase() === SKIP_TOKEN;
}

function isConfirm(text: string): boolean {
  return text.trim().toLowerCase() === CONFIRM_TOKEN;
}
