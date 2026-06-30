import { edadSchema, personCreateSchema, petCreateSchema } from "../schemas.js";
import type { OwnedPerson, PersonCreate, PetCreate } from "../schemas.js";
import { DEFAULT_FUENTE } from "../enums.js";
import * as M from "./messages.js";
import {
  initialState,
  type ConversationInput,
  type ConversationState,
  type Effect,
  type PetDraft,
  type RegisterDraft,
  type Reply,
  type SearchDraft,
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
// Comandos con barra que INICIAN un flujo del menu. Incluye alias con y sin guion
// bajo para que coincidan con cualquier lista de comandos de BotFather (p. ej.
// /buscar_mascota y /buscarmascota apuntan al mismo flujo). /start, /ayuda y
// /cancelar se manejan aparte (no inician un flujo).
const CMD_TO_FLOW: Record<string, FlowChoice> = {
  "/registrar": "register",
  "/registrarpersona": "register",
  "/buscar": "search",
  "/buscarpersona": "search",
  "/mascota": "search_pets",
  "/buscarmascota": "search_pets",
  "/buscar_mascota": "search_pets",
  "/registrarmascota": "register_pet",
  "/registrar_mascota": "register_pet",
  "/borrar": "delete",
  "/rescatado": "mark_found",
  "/rescatada": "mark_found",
  "/zonas": "browse_zones",
  "/puntos": "browse_zones",
  "/necesidades": "browse_needs",
};

// Etiquetas de menu que, como texto, equivalen a elegir una opcion. Permite que
// el adaptador mande el texto del boton sin tener que mapearlo a un comando.
const MENU_TEXT: Record<
  string,
  | "register"
  | "register_pet"
  | "search"
  | "search_pets"
  | "browse_zones"
  | "browse_needs"
  | "delete"
  | "mark_found"
  | "help"
> = {
  [M.BUTTON.registrar.toLowerCase()]: "register",
  [M.BUTTON.registrarMascota.toLowerCase()]: "register_pet",
  [M.BUTTON.buscar.toLowerCase()]: "search",
  [M.BUTTON.buscarMascota.toLowerCase()]: "search_pets",
  [M.BUTTON.zonas.toLowerCase()]: "browse_zones",
  [M.BUTTON.necesidades.toLowerCase()]: "browse_needs",
  [M.BUTTON.rescatado.toLowerCase()]: "mark_found",
  [M.BUTTON.borrar.toLowerCase()]: "delete",
  [M.BUTTON.ayuda.toLowerCase()]: "help",
};

/** Normaliza una entrada corta: minusculas, sin espacios extremos ni acentos. */
function normalizeToken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Sinonimos aceptados para confirmar / cancelar / omitir. La gente no escribe la
// etiqueta EXACTA del boton: bajo estres tipea "si", "ok", "dale", "no". Aceptamos
// lo natural para que el flujo no se trabe (CLAUDE.md: gente no tecnica, emergencia).
const CONFIRM_TOKENS: ReadonlySet<string> = new Set([
  normalizeToken(M.BUTTON.confirmar),
  "confirmo",
  "si",
  "s",
  "ok",
  "okay",
  "dale",
  "vale",
  "claro",
  "correcto",
  "yes",
  "y",
]);
const CANCEL_TOKENS: ReadonlySet<string> = new Set([
  normalizeToken(M.BUTTON.cancelar),
  "cancel",
  "no",
]);
const SKIP_TOKENS: ReadonlySet<string> = new Set([
  normalizeToken(M.BUTTON.omitir),
  "saltar",
  "skip",
  "-",
]);
// Salida explicita del paso de conectar (boton "No, volver al inicio"). Aceptamos el
// texto del boton mas variantes naturales para no atrapar a la gente en el flujo.
const NO_CONECTAR_TOKENS: ReadonlySet<string> = new Set([
  normalizeToken(M.BUTTON.noConectar),
  "volver al inicio",
  "volver",
  "inicio",
  "menu",
]);

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
    default: {
      // Cualquier otro comando que inicie un flujo del menu (con alias BotFather).
      const flow = CMD_TO_FLOW[command];
      return flow ? startFlow(flow) : null;
    }
  }
}

/** Detecta si un texto del menu inicia un flujo; devuelve el arranque o null. */
function startFlowFromText(text: string): StepResult | null {
  const choice = MENU_TEXT[text.trim().toLowerCase()];
  if (!choice) return null;
  return startFlow(choice);
}

type FlowChoice =
  | "register"
  | "register_pet"
  | "search"
  | "search_pets"
  | "browse_zones"
  | "browse_needs"
  | "delete"
  | "mark_found"
  | "help";

function startFlow(choice: FlowChoice): StepResult {
  switch (choice) {
    case "register":
      return result(
        { flow: "register", step: "nombre", draft: {} },
        [reply(M.REGISTER_ASK_NOMBRE)],
      );
    case "register_pet":
      return result(
        { flow: "register_pet", step: "nombre", draft: {} },
        [reply(M.REGISTER_PET_ASK_NOMBRE, M.skipButtons())],
      );
    case "search":
      // Busqueda GUIADA: arranca pidiendo el nombre (salteable), igual que registrar.
      return result(
        { flow: "search", step: "nombre", draft: {} },
        [reply(M.SEARCH_ASK_NOMBRE, M.skipButtons())],
      );
    case "search_pets":
      return result(
        { flow: "search_pets", step: "query" },
        [reply(M.SEARCH_PET_ASK_QUERY)],
      );
    case "browse_zones":
      // Vista de solo lectura: sin paso de query. Emite el effect de inmediato y
      // queda en loading hasta que el adaptador re-inyecte la lista de zonas.
      return result({ flow: "browse_zones", step: "loading" }, [], { type: "list_zones" });
    case "browse_needs":
      // Igual que zonas: sin query, emite el effect y espera la lista de necesidades.
      return result({ flow: "browse_needs", step: "loading" }, [], { type: "list_needs" });
    case "delete":
      // Al entrar listamos los registros del DUENO (por canal). YA NO se pegan
      // codigos: emitimos el efecto y esperamos la lista (espeja browse_zones).
      return result({ flow: "delete", step: "loading" }, [], { type: "list_my_persons" });
    case "mark_found":
      return result({ flow: "mark_found", step: "loading" }, [], { type: "list_my_persons" });
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
    case "register_pet":
      return stepRegisterPet(state, input);
    case "search":
      return stepSearch(state, input);
    case "search_pets":
      return stepSearchPets(state, input);
    case "browse_zones":
      return stepBrowseZones(state, input);
    case "browse_needs":
      return stepBrowseNeeds(state, input);
    case "delete":
      return stepDelete(state, input);
    case "mark_found":
      return stepMarkFound(state, input);
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
      // Resultado inesperado: volvemos a 'confirm' (NO mantenemos el step actual, que
      // podria ser 'submitting' con botones muertos) reofreciendo confirmar sin perder
      // el draft, de modo que Confirmar/Cancelar siempre funcionen.
      return result(
        { flow: "register", step: "confirm", draft: state.draft },
        [reply(M.registerSummary(requireNombre(state.draft)), M.confirmButtons())],
      );
    }
    if (input.result.ok) {
      return toMenu(M.registerDone(input.result.id));
    }
    // El backend fallo: volvemos a 'confirm' (NO 'submitting') para que los botones
    // Confirmar/Cancelar vuelvan a funcionar y la persona pueda reintentar el envio
    // sin perder los datos cargados. En 'submitting' el texto se ignora y la dejaba
    // atascada (emergencia: un usuario trabado al registrar = una persona fuera del sistema).
    return result(
      { flow: "register", step: "confirm", draft: state.draft },
      [reply(M.REGISTER_FAILED, M.confirmButtons())],
    );
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
  if (isCancel(text)) {
    // Cancelar desde la confirmacion: descartamos el borrador y volvemos al menu.
    return toMenu(M.CANCELLED);
  }
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

// ── Flujo: registrar mascota ─────────────────────────────────────────────────

type RegisterPetState = Extract<ConversationState, { flow: "register_pet" }>;

/** Pasos de texto opcional del registro de mascota y a que paso saltan. */
const PET_NEXT: Record<
  "nombre" | "tipo" | "raza",
  { field: "nombre" | "tipo" | "raza"; nextStep: "tipo" | "raza" | "zona"; prompt: string }
> = {
  nombre: { field: "nombre", nextStep: "tipo", prompt: M.REGISTER_PET_ASK_TIPO },
  tipo: { field: "tipo", nextStep: "raza", prompt: M.REGISTER_PET_ASK_RAZA },
  raza: { field: "raza", nextStep: "zona", prompt: M.REGISTER_PET_ASK_ZONA },
};

function stepRegisterPet(state: RegisterPetState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    if (state.step !== "submitting" || input.result.type !== "create_pet") {
      // Resultado inesperado: volvemos a 'confirm' (NO mantenemos el step actual, que
      // podria ser 'submitting' con botones muertos) reofreciendo confirmar sin perder
      // el draft, de modo que Confirmar/Cancelar siempre funcionen.
      return result(
        { flow: "register_pet", step: "confirm", draft: state.draft },
        [reply(M.petSummary(state.draft), M.confirmButtons())],
      );
    }
    if (input.result.ok) {
      return toMenu(M.registerPetDone(input.result.id));
    }
    // El backend fallo: volvemos a 'confirm' (NO 'submitting') para que los botones
    // Confirmar/Cancelar vuelvan a funcionar y se pueda reintentar el envio sin perder
    // los datos cargados (en 'submitting' el texto se ignora y dejaba el flujo atascado).
    return result(
      { flow: "register_pet", step: "confirm", draft: state.draft },
      [reply(M.REGISTER_PET_FAILED, M.confirmButtons())],
    );
  }

  // input.kind === 'text'
  const text = input.text;
  switch (state.step) {
    case "nombre":
    case "tipo":
    case "raza":
      return registerPetSetOptionalTexto(state, text, PET_NEXT[state.step]);
    case "zona":
      return registerPetSetZona(state, text);
    case "confirm":
      return registerPetConfirm(state, text);
    case "submitting":
      // Esperando el effect_result; ignoramos el texto sin emitir respuesta.
      return result(state, []);
  }
}

/**
 * Paso de texto opcional (nombre/tipo/raza): Omitir => null; texto no vacio => se
 * valida con el schema; vacio sin omitir => re-pide el mismo paso. Avanza al siguiente.
 */
function registerPetSetOptionalTexto(
  state: RegisterPetState,
  text: string,
  next: { field: "nombre" | "tipo" | "raza"; nextStep: "tipo" | "raza" | "zona"; prompt: string },
): StepResult {
  if (isSkip(text)) {
    return advanceRegisterPet(state, { [next.field]: null }, next.nextStep, next.prompt);
  }
  const parsed = petCreateSchema.shape[next.field].safeParse(text);
  if (!parsed.success || parsed.data == null) {
    return result(
      { flow: "register_pet", step: next.field, draft: state.draft },
      [reply(M.REGISTER_PET_INVALID_TEXTO, M.skipButtons())],
    );
  }
  return advanceRegisterPet(state, { [next.field]: parsed.data }, next.nextStep, next.prompt);
}

/** Ultimo paso opcional (zona): tras el va el resumen + confirmacion. */
function registerPetSetZona(state: RegisterPetState, text: string): StepResult {
  let value: string | null;
  if (isSkip(text)) {
    value = null;
  } else {
    const parsed = petCreateSchema.shape.zona.safeParse(text);
    if (!parsed.success || parsed.data == null) {
      return result(
        { flow: "register_pet", step: "zona", draft: state.draft },
        [reply(M.REGISTER_PET_INVALID_TEXTO, M.skipButtons())],
      );
    }
    value = parsed.data;
  }
  const draft: PetDraft = { ...state.draft, zona: value };
  return result(
    { flow: "register_pet", step: "confirm", draft },
    [reply(M.petSummary(draft), M.confirmButtons())],
  );
}

/**
 * En confirm: Cancelar => menu; Confirmar con al menos un dato => emite create_pet;
 * Confirmar con TODO vacio => re-pide desde nombre (una mascota sin dato no sirve
 * para buscar); cualquier otra respuesta => re-muestra el resumen.
 */
function registerPetConfirm(state: RegisterPetState, text: string): StepResult {
  if (isCancel(text)) {
    return toMenu(M.CANCELLED);
  }
  if (!isConfirm(text)) {
    return result(state, [reply(M.petSummary(state.draft), M.confirmButtons())]);
  }
  if (petDraftIsEmpty(state.draft)) {
    // Sin ningun dato no se puede buscar: volvemos a pedir desde el nombre.
    return result(
      { flow: "register_pet", step: "nombre", draft: {} },
      [reply(M.REGISTER_PET_EMPTY), reply(M.REGISTER_PET_ASK_NOMBRE, M.skipButtons())],
    );
  }
  const data = buildPetCreate(state.draft);
  return result(
    { flow: "register_pet", step: "submitting", draft: state.draft },
    [], // sin respuesta aun: la final llega tras el effect_result
    { type: "create_pet", data },
  );
}

/** Una mascota sin nombre, tipo, raza ni zona es inutil para buscar. */
function petDraftIsEmpty(draft: PetDraft): boolean {
  const fields = [draft.nombre, draft.tipo, draft.raza, draft.zona];
  return fields.every((v) => v == null || v === "");
}

/** Construye el `PetCreate` validado a partir del draft acumulado. */
function buildPetCreate(draft: PetDraft): PetCreate {
  // El registro nace estado/verificacion por defecto del dominio; aqui solo fijamos
  // la fuente. NO incluimos contact_id (guardrail #1): el vinculo lo gestiona el canal.
  return petCreateSchema.parse({
    nombre: draft.nombre ?? undefined,
    tipo: draft.tipo ?? undefined,
    raza: draft.raza ?? undefined,
    zona: draft.zona ?? undefined,
    fuente: DEFAULT_FUENTE,
  });
}

/** Avanza el registro de mascota fusionando el draft y pasando al siguiente paso. */
function advanceRegisterPet(
  state: RegisterPetState,
  patch: Partial<PetDraft>,
  nextStep: RegisterPetState["step"],
  prompt: string,
): StepResult {
  const draft: PetDraft = { ...state.draft, ...patch };
  return result({ flow: "register_pet", step: nextStep, draft }, [reply(prompt, M.skipButtons())]);
}

// ── Flujo: buscar (GUIADO, espeja registrar) ──────────────────────────────────

type SearchState = Extract<ConversationState, { flow: "search" }>;

function stepSearch(state: SearchState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    // Resultado de la BUSQUEDA: muestra coincidencias y ofrece conectar (reencuentro).
    if (state.step === "searching" && input.result.type === "search_persons") {
      const { results } = input.result;
      if (results.length === 0) {
        // Sin coincidencias: volvemos a idle con el menu.
        return result(initialState, [reply(M.SEARCH_NO_RESULTS), reply(M.WELCOME, M.menuButtons())]);
      }
      // Con coincidencias: pasamos a 'choosing' guardando los ids PUBLICOS en orden.
      // El buscador podra elegir UNO por su numero para iniciar el reencuentro.
      const candidates = results.map((r) => r.id);
      return result(
        { flow: "search", step: "choosing", candidates },
        [
          reply(M.searchResults(results)),
          // Botones para TOCAR (1, 2...) + "No, volver al inicio": evita confundir
          // "su numero" con un telefono, que dejaba a la gente colgada.
          reply(M.searchConnectPrompt(results.length), M.connectButtons(results.length)),
        ],
      );
    }
    // Resultado de la SOLICITUD de reencuentro: mensaje calido segun el estado.
    if (state.step === "requesting" && input.result.type === "request_reunion") {
      const message =
        input.result.status === "requested"
          ? M.REUNION_REQUESTED
          : input.result.status === "minor"
            ? M.REUNION_MINOR_BLOCKED
            : M.REUNION_REQUEST_FAILED;
      return result(initialState, [reply(message), reply(M.WELCOME, M.menuButtons())]);
    }
    // Resultado inesperado para el paso actual: reofrecemos la busqueda desde el inicio.
    return result(
      { flow: "search", step: "nombre", draft: {} },
      [reply(M.SEARCH_ASK_NOMBRE, M.skipButtons())],
    );
  }

  // input.kind === 'text'
  if (state.step === "searching" || state.step === "requesting") {
    // Esperando un resultado del adaptador; ignoramos texto.
    return result(state, []);
  }

  if (state.step === "choosing") {
    // El buscador elige a quien conectar TOCANDO el boton con su numero de la lista.
    const candidates = state.candidates ?? [];
    // Boton explicito "No, volver al inicio": unica salida sin conectar. Asi un numero
    // mal escrito NO expulsa en silencio (lo que confundia a la gente); re-pedimos.
    if (isNoConectar(input.text)) {
      return toMenu(M.CANCELLED);
    }
    const personId = pickCandidate(input.text, candidates);
    if (personId === null) {
      // No es un numero valido de la lista: re-pedimos sin expulsar, manteniendo los
      // botones para que solo tenga que tocar. (Para salir, el boton de arriba.)
      return result(
        { flow: "search", step: "choosing", candidates },
        [reply(M.REUNION_REQUEST_INVALID, M.connectButtons(candidates.length))],
      );
    }
    // Emite el efecto de reencuentro; el adaptador anade el canal del buscador y el
    // backend pide el consentimiento de la otra parte. Sin contacto aqui (guardrail #1).
    return result(
      { flow: "search", step: "requesting", candidates },
      [],
      { type: "request_reunion", personId },
    );
  }

  // Pasos GUIADOS de recoleccion: cada uno salteable (espeja el registro de persona).
  const draft = state.draft ?? {};
  const text = input.text;
  switch (state.step) {
    case "nombre":
      return searchSetOptionalTexto(draft, text, "nombre", "apellidos", M.SEARCH_ASK_APELLIDOS);
    case "apellidos":
      return searchSetOptionalTexto(draft, text, "apellidos", "edad", M.SEARCH_ASK_EDAD);
    case "edad":
      return searchSetEdad(draft, text);
    case "zona":
      return searchSetOptionalTexto(draft, text, "zona", "descripcion", M.SEARCH_ASK_DESCRIPCION);
    case "descripcion":
      return searchSetDescripcion(draft, text);
  }
}

/**
 * Paso de texto opcional (nombre/apellidos/zona): Omitir => null; texto no vacio => se
 * valida con el schema de persona; vacio sin omitir => re-pide el mismo paso. Avanza al
 * siguiente paso guiado de la busqueda.
 */
function searchSetOptionalTexto(
  draft: SearchDraft,
  text: string,
  field: "nombre" | "apellidos" | "zona",
  nextStep: "apellidos" | "edad" | "descripcion",
  nextPrompt: string,
): StepResult {
  if (isSkip(text)) {
    return advanceSearch({ ...draft, [field]: null }, nextStep, nextPrompt);
  }
  // Reusamos los schemas de persona: nombre/apellidos/zona comparten validacion de texto.
  const shape =
    field === "nombre" ? personCreateSchema.shape.nombre : personCreateSchema.shape[field];
  const parsed = shape.safeParse(text);
  if (!parsed.success || parsed.data == null) {
    return result(
      { flow: "search", step: field, draft },
      [reply(M.SEARCH_INVALID_TEXTO, M.skipButtons())],
    );
  }
  return advanceSearch({ ...draft, [field]: parsed.data }, nextStep, nextPrompt);
}

/** Edad opcional de la busqueda: vacio/Omitir => null; numero invalido => re-pide. */
function searchSetEdad(draft: SearchDraft, text: string): StepResult {
  if (isSkip(text)) {
    return advanceSearch({ ...draft, edad: null }, "zona", M.SEARCH_ASK_ZONA);
  }
  const n = Number(text.trim());
  // Number("") es 0; exigimos que el texto sea realmente numerico.
  const looksNumeric = text.trim() !== "" && Number.isFinite(n);
  const parsed = looksNumeric ? edadSchema.safeParse(n) : { success: false as const };
  if (!parsed.success) {
    return result(
      { flow: "search", step: "edad", draft },
      [reply(M.SEARCH_INVALID_EDAD, M.skipButtons())],
    );
  }
  return advanceSearch({ ...draft, edad: parsed.data }, "zona", M.SEARCH_ASK_ZONA);
}

/**
 * Ultimo paso guiado (senas/descripcion): Omitir => null; texto no vacio => se valida.
 * Tras el, si hay AL MENOS UN dato se dispara la busqueda; si todo quedo vacio, no se
 * busca con vacio: se pide amablemente al menos un dato y se reinicia la recoleccion.
 */
function searchSetDescripcion(draft: SearchDraft, text: string): StepResult {
  let value: string | null;
  if (isSkip(text)) {
    value = null;
  } else {
    const parsed = personCreateSchema.shape.descripcion.safeParse(text);
    if (!parsed.success || parsed.data == null) {
      return result(
        { flow: "search", step: "descripcion", draft },
        [reply(M.SEARCH_INVALID_TEXTO, M.skipButtons())],
      );
    }
    value = parsed.data;
  }
  const full: SearchDraft = { ...draft, descripcion: value };
  if (searchDraftIsEmpty(full)) {
    // Sin ningun dato no se puede buscar: re-pedimos desde el nombre (al menos un dato).
    return result(
      { flow: "search", step: "nombre", draft: {} },
      [reply(M.SEARCH_EMPTY), reply(M.SEARCH_ASK_NOMBRE, M.skipButtons())],
    );
  }
  // Emite el efecto con los campos estructurados que el matcher pondera. El adaptador
  // buscara y re-inyectara los resultados. Sin contacto: vista publica (guardrail #1).
  return result(
    { flow: "search", step: "searching", draft: full },
    [],
    buildSearchEffect(full),
  );
}

/** Una busqueda sin nombre, apellidos, edad, zona ni senas no sirve para buscar. */
function searchDraftIsEmpty(draft: SearchDraft): boolean {
  const fields = [draft.nombre, draft.apellidos, draft.edad, draft.zona, draft.descripcion];
  return fields.every((v) => v == null || v === "");
}

/**
 * Construye el efecto `search_persons` a partir del draft. Mapea al scoring del matcher:
 *   - `query` = nombre + apellidos juntos (el matcher puntua el nombre token a token).
 *   - `zona`  = filtro/score de zona (campo ponderado del matcher).
 *   - `descripcion` (senas) = campo de texto libre ponderado del matcher.
 * La edad se recoge pero el matcher de hoy no la usa; no se envia (no rompe nada).
 */
function buildSearchEffect(draft: SearchDraft): Effect {
  const query = [draft.nombre, draft.apellidos]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ")
    .trim();
  const effect: {
    type: "search_persons";
    query: string;
    zona?: string;
    descripcion?: string;
  } = { type: "search_persons", query };
  if (draft.zona != null && draft.zona !== "") effect.zona = draft.zona;
  if (draft.descripcion != null && draft.descripcion !== "") {
    effect.descripcion = draft.descripcion;
  }
  return effect;
}

/** Avanza la busqueda guiada al siguiente paso con su draft y prompt (con Omitir). */
function advanceSearch(
  draft: SearchDraft,
  nextStep: "apellidos" | "edad" | "zona" | "descripcion",
  prompt: string,
): StepResult {
  return result({ flow: "search", step: nextStep, draft }, [reply(prompt, M.skipButtons())]);
}

/**
 * Resuelve el id de la persona elegida a partir del texto del buscador y la lista de
 * candidatos. Acepta un numero 1..N (1-indexado, como se muestra). Devuelve el id, o
 * null si el texto no es un numero valido dentro del rango.
 */
function pickCandidate(text: string, candidates: readonly string[]): string | null {
  const trimmed = text.trim();
  // Solo digitos: evita que Number(" 2 cosas ") cuele.
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > candidates.length) return null;
  return candidates[n - 1] ?? null;
}

// ── Flujo: buscar mascota ─────────────────────────────────────────────────────

type SearchPetsState = Extract<ConversationState, { flow: "search_pets" }>;

function stepSearchPets(state: SearchPetsState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    if (state.step !== "searching" || input.result.type !== "search_pets") {
      return result({ flow: "search_pets", step: "query" }, [reply(M.SEARCH_PET_ASK_QUERY)]);
    }
    const { results } = input.result;
    const text = results.length === 0 ? M.SEARCH_PET_NO_RESULTS : M.searchPetResults(results);
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
    return result({ flow: "search_pets", step: "query" }, [reply(M.SEARCH_PET_INVALID_QUERY)]);
  }
  // Emite el efecto; el adaptador buscara y re-inyectara los resultados.
  // No incluimos contacto: la busqueda usa la vista publica (guardrail #1).
  return result(
    { flow: "search_pets", step: "searching", query },
    [],
    { type: "search_pets", query },
  );
}

// ── Flujo: ver puntos de encuentro (zonas) ───────────────────────────────────

type BrowseZonesState = Extract<ConversationState, { flow: "browse_zones" }>;

/**
 * Vista de SOLO LECTURA. Al entrar ya se emitio `list_zones`; aqui solo esperamos
 * el `effect_result` con la lista. Cuando llega, la mostramos (o el mensaje vacio) y
 * volvemos a idle con el menu. Texto recibido en loading se ignora (espeja stepSearch).
 */
function stepBrowseZones(state: BrowseZonesState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    if (input.result.type !== "list_zones") {
      // Resultado inesperado: volvemos a idle ofreciendo el menu.
      return toMenu(M.WELCOME);
    }
    const { zones } = input.result;
    const text = zones.length === 0 ? M.ZONES_EMPTY : M.zonesList(zones);
    return result(initialState, [reply(text), reply(M.WELCOME, M.menuButtons())]);
  }
  // Texto mientras carga: lo ignoramos sin emitir respuesta.
  return result(state, []);
}

// ── Flujo: ver necesidades por zona ──────────────────────────────────────────

type BrowseNeedsState = Extract<ConversationState, { flow: "browse_needs" }>;

/**
 * Vista de SOLO LECTURA. Espejo de `stepBrowseZones`: espera el `effect_result` con
 * las necesidades, las muestra (ordenadas por urgencia) o el mensaje vacio, y vuelve
 * a idle con el menu. Texto recibido en loading se ignora.
 */
function stepBrowseNeeds(state: BrowseNeedsState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    if (input.result.type !== "list_needs") {
      return toMenu(M.WELCOME);
    }
    const { needs } = input.result;
    const text = needs.length === 0 ? M.NEEDS_EMPTY : M.needsList(needs);
    return result(initialState, [reply(text), reply(M.WELCOME, M.menuButtons())]);
  }
  return result(state, []);
}

// ── Flujo: borrar ────────────────────────────────────────────────────────────

type DeleteState = Extract<ConversationState, { flow: "delete" }>;

function stepDelete(state: DeleteState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    // Llego la lista de MIS registros: la mostramos para elegir, o avisamos si no hay.
    if (state.step === "loading" && input.result.type === "list_my_persons") {
      return showMyPersons(input.result.persons, "delete");
    }
    // Llego el resultado del BORRADO en si.
    if (state.step === "deleting" && input.result.type === "delete_person") {
      return input.result.ok
        ? toMenu(M.DELETE_DONE)
        : result(initialState, [reply(M.DELETE_FAILED), reply(M.WELCOME, M.menuButtons())]);
    }
    // Resultado inesperado para el paso actual: reintentamos listando.
    return result({ flow: "delete", step: "loading" }, [], { type: "list_my_persons" });
  }

  // input.kind === 'text'
  switch (state.step) {
    case "loading":
      // Esperando la lista; ignoramos texto (espeja browse_zones).
      return result(state, []);
    case "choosing": {
      const persons = state.persons ?? [];
      if (isCancel(input.text)) return toMenu(M.CANCELLED);
      const chosen = pickPerson(input.text, persons);
      if (chosen === null) {
        // No es un numero valido de la lista: re-pedimos sin expulsar, con botones.
        return result(
          { flow: "delete", step: "choosing", persons },
          [reply(M.DELETE_PICK_INVALID, M.pickPersonButtons(persons.length))],
        );
      }
      return result(
        { flow: "delete", step: "confirm", personId: chosen.id, nombre: chosen.nombre },
        [reply(M.deleteConfirm(chosen.nombre), M.confirmButtons())],
      );
    }
    case "confirm": {
      if (isCancel(input.text)) {
        // Cancelar desde la confirmacion de borrado: volvemos al menu sin borrar.
        return toMenu(M.CANCELLED);
      }
      if (!isConfirm(input.text)) {
        // Cualquier respuesta que no sea confirmar re-pide la confirmacion.
        const nombre = state.nombre ?? "";
        return result(state, [reply(M.deleteConfirm(nombre), M.confirmButtons())]);
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

/**
 * Muestra los registros del DUENO para que elija uno (borrar/marcar). Si no hay
 * ninguno ligado a este canal, lo dice claro y vuelve al menu. Comparte el mismo
 * picker para ambos flujos; solo cambian los textos del prompt y el "ninguno".
 */
function showMyPersons(
  persons: readonly OwnedPerson[],
  flow: "delete" | "mark_found",
): StepResult {
  if (persons.length === 0) {
    const none = flow === "delete" ? M.DELETE_NONE : M.MARK_FOUND_NONE;
    return result(initialState, [reply(none), reply(M.WELCOME, M.menuButtons())]);
  }
  const prompt = flow === "delete" ? M.DELETE_PICK : M.MARK_FOUND_PICK;
  return result(
    { flow, step: "choosing", persons },
    [reply(M.myPersonsList(persons)), reply(prompt, M.pickPersonButtons(persons.length))],
  );
}

/**
 * Resuelve el registro elegido a partir del texto del usuario y la lista mostrada.
 * Acepta un numero 1..N (1-indexado, como se muestra). Devuelve el registro, o null
 * si el texto no es un numero valido dentro del rango.
 */
function pickPerson(text: string, persons: readonly OwnedPerson[]): OwnedPerson | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > persons.length) return null;
  return persons[n - 1] ?? null;
}

// ── Flujo: rescatado (el dueno marca como encontrado con vida) ────────────────

type MarkFoundState = Extract<ConversationState, { flow: "mark_found" }>;

/**
 * Espejo de `stepDelete`: pide el id -> confirma -> emite el efecto `mark_found` ->
 * espera el resultado. El backend autoriza por canal (solo el dueno) igual que el
 * borrado; el "no es el dueno" llega como `ok:false` y se muestra el fallo generico
 * sin revelar si el registro existe ni de quien es (guardrail #1).
 */
function stepMarkFound(state: MarkFoundState, input: FlowInput): StepResult {
  if (input.kind === "effect_result") {
    // Llego la lista de MIS registros: la mostramos para elegir, o avisamos si no hay.
    if (state.step === "loading" && input.result.type === "list_my_persons") {
      return showMyPersons(input.result.persons, "mark_found");
    }
    // Llego el resultado del MARCADO en si.
    if (state.step === "marking" && input.result.type === "mark_found") {
      return input.result.ok
        ? toMenu(M.MARK_FOUND_DONE)
        : result(initialState, [reply(M.MARK_FOUND_FAILED), reply(M.WELCOME, M.menuButtons())]);
    }
    // Resultado inesperado para el paso actual: reintentamos listando.
    return result({ flow: "mark_found", step: "loading" }, [], { type: "list_my_persons" });
  }

  // input.kind === 'text'
  switch (state.step) {
    case "loading":
      // Esperando la lista; ignoramos texto (espeja browse_zones).
      return result(state, []);
    case "choosing": {
      const persons = state.persons ?? [];
      if (isCancel(input.text)) return toMenu(M.CANCELLED);
      const chosen = pickPerson(input.text, persons);
      if (chosen === null) {
        return result(
          { flow: "mark_found", step: "choosing", persons },
          [reply(M.MARK_FOUND_PICK_INVALID, M.pickPersonButtons(persons.length))],
        );
      }
      return result(
        { flow: "mark_found", step: "confirm", personId: chosen.id, nombre: chosen.nombre },
        [reply(M.markFoundConfirm(chosen.nombre), M.confirmButtons())],
      );
    }
    case "confirm": {
      if (isCancel(input.text)) {
        // Cancelar desde la confirmacion: volvemos al menu sin marcar.
        return toMenu(M.CANCELLED);
      }
      if (!isConfirm(input.text)) {
        // Cualquier respuesta que no sea confirmar re-pide la confirmacion.
        const nombre = state.nombre ?? "";
        return result(state, [reply(M.markFoundConfirm(nombre), M.confirmButtons())]);
      }
      const personId = state.personId ?? "";
      // La autorizacion real (que sea el dueno) la hace el adaptador/backend.
      return result(
        { flow: "mark_found", step: "marking", personId },
        [],
        { type: "mark_found", personId },
      );
    }
    case "marking":
      // Esperando el effect_result; ignoramos texto.
      return result(state, []);
  }
}

// ── Tokens de entrada ────────────────────────────────────────────────────────

function isSkip(text: string): boolean {
  return SKIP_TOKENS.has(normalizeToken(text));
}

function isConfirm(text: string): boolean {
  return CONFIRM_TOKENS.has(normalizeToken(text));
}

function isCancel(text: string): boolean {
  return CANCEL_TOKENS.has(normalizeToken(text));
}

function isNoConectar(text: string): boolean {
  return NO_CONECTAR_TOKENS.has(normalizeToken(text));
}
