// Flujo unificado buscar/registrar (Slice U, spec-delta nucleo-ux).
// Reducer PURO: sin red, BD ni efectos. Compatible con la maquina existente.
//
// Este modulo es ADITIVO respecto a machine.ts: agrega un nuevo flujo
// "unified_entry" a ConversationState sin tocar los flujos existentes.
// La coordinacion con PR3 es segura: este archivo es nuevo, no modifica machine.ts.
//
// Flujo:
//   collecting → (texto acumulado) → buscar → searching
//   searching → (resultado vacio) → no_match
//   searching → (candidato) → confirming
//   confirming → (SI) → subscribing → idle
//   confirming → (NO) → no_match
//   no_match → (SI registrar) → registro existente (register/register_pet)
//   no_match → (NO) → idle

import type { ConversationState, Reply } from "./conversation/state.js";
import { initialState } from "./conversation/state.js";
import * as M from "./conversation/messages.js";

// ── Tipos del dominio ─────────────────────────────────────────────────────────

/** Dominio al que aplica el flujo unificado. */
export type UnifiedEntryDomain = "person" | "pet";

/** Draft de datos recogidos en la fase de recoleccion libre. */
export interface UnifiedEntryDraft {
  readonly rawInput?: string;
}

/**
 * Candidato de busqueda devuelto por el efecto search_unified.
 * Vista publica (sin contact_id — guardrail #1).
 */
export interface SearchCandidate {
  readonly id: string;
  readonly nombre?: string | null;
  readonly apellidos?: string | null;
  readonly edad?: number | null;
  readonly zona?: string | null;
  readonly descripcion?: string | null;
  readonly tipo?: string | null;
  readonly raza?: string | null;
  readonly foto_url?: string | null;
  readonly estado: string;
  readonly fuente: string;
  readonly verificacion: string;
  readonly created_at: string;
  readonly score?: number;
}

// ── Estado del flujo unificado ────────────────────────────────────────────────

/** Pasos del flujo unificado. */
const UNIFIED_STEPS = {
  COLLECTING: "collecting",
  SEARCHING: "searching",
  CONFIRMING: "confirming",
  SUBSCRIBING: "subscribing",
  NO_MATCH: "no_match",
} as const;

type UnifiedEntryStep = (typeof UNIFIED_STEPS)[keyof typeof UNIFIED_STEPS];

/**
 * Estado de la conversacion del flujo unificado.
 * Un estado unico con step discriminado — candidatos presentes cuando se esta
 * en confirming. Los pasos que no necesitan candidatos tienen la propiedad como undefined.
 */
export interface UnifiedEntryState {
  readonly flow: "unified_entry";
  readonly domain: UnifiedEntryDomain;
  readonly step: UnifiedEntryStep;
  readonly draft: UnifiedEntryDraft;
  /** Solo presente en step="confirming". */
  readonly candidates?: readonly SearchCandidate[];
}

// ── Efectos del flujo unificado ────────────────────────────────────────────────

/**
 * Efecto de busqueda unificada: lanza una busqueda por texto libre en el dominio.
 * El adaptador ejecuta la busqueda y re-inyecta search_result.
 */
export interface SearchUnifiedEffect {
  readonly type: "search_unified";
  readonly query: string;
  readonly domain: UnifiedEntryDomain;
}

/**
 * Efecto de suscripcion al caso: el usuario confirma que el candidato
 * es la misma persona/mascota y quiere recibir avisos (B-1 dedup).
 *
 * NUNCA abre relay ni consentimiento entre buscadores (guardrail Slice B).
 * Solo marca el interes del canal en el caso para futuras notificaciones.
 */
export interface SubscribeToCaseEffect {
  readonly type: "subscribe_to_case";
  readonly caseId: string;
  readonly domain: UnifiedEntryDomain;
}

/**
 * Efecto de inicio de registro: cuando no hay coincidencia y el usuario acepta,
 * el adaptador transiciona al flujo register/register_pet existente.
 */
export interface StartRegisterEffect {
  readonly type: "start_register";
  readonly domain: UnifiedEntryDomain;
  readonly prefillData?: UnifiedEntryDraft;
}

export type UnifiedEntryEffect =
  | SearchUnifiedEffect
  | SubscribeToCaseEffect
  | StartRegisterEffect;

// ── Inputs del flujo unificado ────────────────────────────────────────────────

export type UnifiedEntryEffectResult =
  | {
      readonly type: "search_result";
      readonly results: readonly SearchCandidate[];
    }
  | {
      readonly type: "subscribe_to_case";
      readonly ok: boolean;
    };

export type UnifiedEntryInput =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "effect_result"; readonly result: UnifiedEntryEffectResult };

// ── Resultado del reducer ─────────────────────────────────────────────────────

/**
 * Estado de salida: puede ser UnifiedEntryState (continua el flujo)
 * o un ConversationState de la maquina principal (cuando se delega al registro
 * existente o se vuelve al menu principal).
 */
export type UnifiedEntryNextState = UnifiedEntryState | ConversationState;

export interface UnifiedEntryStepResult {
  readonly state: UnifiedEntryNextState;
  readonly replies: readonly Reply[];
  readonly effect?: UnifiedEntryEffect;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Estado inicial del flujo unificado para un dominio dado. */
export function initialUnifiedEntryState(domain: UnifiedEntryDomain): UnifiedEntryState {
  return {
    flow: "unified_entry",
    domain,
    step: UNIFIED_STEPS.COLLECTING,
    draft: {},
  };
}

function reply(text: string, buttons?: readonly (readonly string[])[]): Reply {
  return buttons ? { text, buttons } : { text };
}

/** Tokens de confirmacion (si/yes y equivalentes naturales). */
const CONFIRM_TOKENS: ReadonlySet<string> = new Set([
  "si", "s", "ok", "okay", "dale", "vale", "claro", "yes", "y", "correcto", "confirmo",
]);

/** Tokens de cancelacion/negacion. */
const CANCEL_TOKENS: ReadonlySet<string> = new Set([
  "no", "cancel", "cancelar", "nope",
]);

/** Aliases para iniciar la busqueda desde la fase de recoleccion. */
const SEARCH_TRIGGER_TOKENS: ReadonlySet<string> = new Set([
  "buscar", "busca", "search", "ya", "listo",
]);

function normalizeToken(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function isConfirm(text: string): boolean {
  return CONFIRM_TOKENS.has(normalizeToken(text));
}

function isCancel(text: string): boolean {
  return CANCEL_TOKENS.has(normalizeToken(text));
}

function isSearchTrigger(text: string): boolean {
  return SEARCH_TRIGGER_TOKENS.has(normalizeToken(text));
}

/** Construye un resumen SEGURO del candidato (sin PII del registrante — guardrail #1). */
function safeCandidateSummary(candidate: SearchCandidate, domain: UnifiedEntryDomain): string {
  if (domain === "pet") {
    const nombre = candidate.nombre ?? "Sin nombre";
    const tipo = candidate.tipo ? `, tipo: ${candidate.tipo}` : "";
    const raza = candidate.raza ? `, raza: ${candidate.raza}` : "";
    const zona = candidate.zona ? `, zona: ${candidate.zona}` : "";
    const score = typeof candidate.score === "number"
      ? ` · parecido: ${Math.round(candidate.score * 100)}%`
      : "";
    return (
      `Encontramos una posible mascota:\n${nombre}${tipo}${raza}${zona}${score}\n` +
      `Estado: ${candidate.estado} · Verificacion: ${candidate.verificacion}`
    );
  }
  const nombre = candidate.nombre ?? "(sin nombre)";
  const apellidos = candidate.apellidos ? ` ${candidate.apellidos}` : "";
  const edad = candidate.edad != null ? `, ${candidate.edad} anos` : "";
  const zona = candidate.zona ? `, zona: ${candidate.zona}` : "";
  const score = typeof candidate.score === "number"
    ? ` · parecido: ${Math.round(candidate.score * 100)}%`
    : "";
  return (
    `Encontramos una posible coincidencia:\n${nombre}${apellidos}${edad}${zona}${score}\n` +
    `Estado: ${candidate.estado} · Verificacion: ${candidate.verificacion}`
  );
}

/** Texto de confirmacion "es la misma persona/mascota?". Sin PII de contacto. */
function confirmationPrompt(candidate: SearchCandidate, domain: UnifiedEntryDomain): string {
  const summary = safeCandidateSummary(candidate, domain);
  const subject = domain === "pet" ? "mascota" : "persona";
  return (
    `${summary}\n\n` +
    `Es la misma ${subject}? (Responde Si o No)`
  );
}

// ── Reducer principal ─────────────────────────────────────────────────────────

/**
 * Reducer puro del flujo unificado buscar/registrar.
 * step(state, input) → { state, replies, effect? }
 *
 * NUNCA conecta dos buscadores entre si (guardrail Slice B / B-1 dedup).
 * NUNCA expone PII del registrante en las replies (guardrail #1).
 */
export function stepUnifiedEntry(
  state: UnifiedEntryState,
  input: UnifiedEntryInput,
): UnifiedEntryStepResult {
  switch (state.step) {
    case UNIFIED_STEPS.COLLECTING:
      return stepCollecting(state, input);
    case UNIFIED_STEPS.SEARCHING:
      return stepSearching(state, input);
    case UNIFIED_STEPS.CONFIRMING:
      return stepConfirming(state, input);
    case UNIFIED_STEPS.SUBSCRIBING:
      return stepSubscribing(state, input);
    case UNIFIED_STEPS.NO_MATCH:
      return stepNoMatch(state, input);
  }
}

// ── Paso: recoleccion libre de datos ─────────────────────────────────────────

function stepCollecting(
  state: UnifiedEntryState,
  input: UnifiedEntryInput,
): UnifiedEntryStepResult {
  if (input.kind === "effect_result") {
    // No esperamos resultado en collecting; ignoramos y repedimos.
    return { state, replies: [reply(collectingPrompt(state.domain))] };
  }

  const text = input.text.trim();

  // Texto vacio: pedimos al menos un dato.
  if (text.length === 0) {
    return {
      state,
      replies: [reply("Necesitamos al menos un dato para continuar. Cuentanos el nombre, zona u otras senas.")],
    };
  }

  // Token de busqueda explícito: si hay draft acumulado, lanza la busqueda.
  if (isSearchTrigger(text)) {
    const query = state.draft.rawInput ?? "";
    if (query.trim().length === 0) {
      return {
        state,
        replies: [reply("Necesitamos al menos un dato para buscar. Cuentanos el nombre, zona u otras senas.")],
      };
    }
    const newState: UnifiedEntryState = { ...state, step: UNIFIED_STEPS.SEARCHING };
    return {
      state: newState,
      replies: [],
      effect: { type: "search_unified", query, domain: state.domain },
    };
  }

  // Texto libre: acumula en el draft y lanza busqueda inmediata.
  const accumulated = state.draft.rawInput
    ? `${state.draft.rawInput} ${text}`
    : text;
  const newState: UnifiedEntryState = {
    flow: "unified_entry",
    domain: state.domain,
    step: UNIFIED_STEPS.SEARCHING,
    draft: { rawInput: accumulated },
  };
  return {
    state: newState,
    replies: [],
    effect: { type: "search_unified", query: accumulated, domain: state.domain },
  };
}

/** Prompt inicial de la fase de recoleccion segun el dominio. */
function collectingPrompt(domain: UnifiedEntryDomain): string {
  if (domain === "pet") {
    return "Cuentanos sobre la mascota: nombre, especie, raza, zona o senas. Puedes dar cualquier dato que conozcas.";
  }
  return "Cuentanos sobre la persona: nombre, apellidos, edad, zona o senas. Puedes dar cualquier dato que conozcas.";
}

// ── Paso: esperando resultado de busqueda ─────────────────────────────────────

function stepSearching(
  state: UnifiedEntryState,
  input: UnifiedEntryInput,
): UnifiedEntryStepResult {
  if (input.kind === "text") {
    // Ignoramos texto mientras esperamos el resultado.
    return { state, replies: [] };
  }

  if (input.result.type !== "search_result") {
    // Resultado inesperado: volvemos al inicio.
    return { state: initialState, replies: [reply(M.WELCOME, M.menuButtons())] };
  }

  const { results } = input.result;

  if (results.length === 0) {
    const subject = state.domain === "pet" ? "mascotas" : "personas";
    const newState: UnifiedEntryState = {
      flow: "unified_entry",
      domain: state.domain,
      step: UNIFIED_STEPS.NO_MATCH,
      draft: state.draft,
    };
    return {
      state: newState,
      replies: [
        reply(
          `No encontramos coincidencias entre las ${subject} registradas. ` +
          `Quieres registrar la ausencia para recibir avisos si aparece? (Responde Si o No)`,
        ),
      ],
    };
  }

  // Tomamos el primer candidato (mejor score) para confirmar.
  const best = results[0]!;
  const newState: UnifiedEntryState = {
    flow: "unified_entry",
    domain: state.domain,
    step: UNIFIED_STEPS.CONFIRMING,
    draft: state.draft,
    candidates: results,
  };
  return {
    state: newState,
    replies: [reply(confirmationPrompt(best, state.domain))],
  };
}

// ── Paso: confirmacion "es la misma persona/mascota?" ────────────────────────

function stepConfirming(
  state: UnifiedEntryState,
  input: UnifiedEntryInput,
): UnifiedEntryStepResult {
  if (input.kind === "effect_result") {
    // No esperamos efecto en confirming; ignoramos.
    return { state, replies: [] };
  }

  const text = input.text;

  if (isConfirm(text)) {
    // Usuario confirma: suscribirse al caso (B-1: NO abre relay/consentimiento entre buscadores).
    const best = state.candidates?.[0];
    if (best === undefined) {
      return { state: initialState, replies: [reply(M.WELCOME, M.menuButtons())] };
    }
    const newState: UnifiedEntryState = {
      flow: "unified_entry",
      domain: state.domain,
      step: UNIFIED_STEPS.SUBSCRIBING,
      draft: state.draft,
    };
    return {
      state: newState,
      replies: [],
      effect: { type: "subscribe_to_case", caseId: best.id, domain: state.domain },
    };
  }

  if (isCancel(text)) {
    // Usuario dice NO: ofrecer registro como caso nuevo.
    const subject = state.domain === "pet" ? "mascota" : "persona";
    const newState: UnifiedEntryState = {
      flow: "unified_entry",
      domain: state.domain,
      step: UNIFIED_STEPS.NO_MATCH,
      draft: state.draft,
    };
    return {
      state: newState,
      replies: [
        reply(
          `Entendido. Quieres registrar la ${subject} como un caso nuevo para recibir avisos? (Responde Si o No)`,
        ),
      ],
    };
  }

  // Respuesta no reconocida: re-preguntar.
  const best = state.candidates?.[0];
  const promptText = best
    ? confirmationPrompt(best, state.domain)
    : "Es la misma persona? Responde Si o No.";
  return {
    state,
    replies: [reply(`No entendi. Responde Si o No.\n\n${promptText}`)],
  };
}

// ── Paso: esperando confirmacion de suscripcion ────────────────────────────────

function stepSubscribing(
  state: UnifiedEntryState,
  input: UnifiedEntryInput,
): UnifiedEntryStepResult {
  if (input.kind === "text") {
    return { state, replies: [] };
  }

  if (input.result.type !== "subscribe_to_case") {
    return { state: initialState, replies: [reply(M.WELCOME, M.menuButtons())] };
  }

  if (input.result.ok) {
    // Suscripcion exitosa: confirmar sin mencionar conexion con otros buscadores.
    return {
      state: initialState,
      replies: [
        reply(
          "Te avisaremos si hay novedades sobre este caso. " +
          "Gracias por ayudar a que nadie se quede atras.",
          M.menuButtons(),
        ),
      ],
    };
  }

  // Fallo: mensaje generico.
  return {
    state: initialState,
    replies: [
      reply(
        "No pudimos registrar tu seguimiento ahora mismo. Por favor, intentalo de nuevo en un momento.",
        M.menuButtons(),
      ),
    ],
  };
}

// ── Paso: sin coincidencia — ofrecer registro ──────────────────────────────────

function stepNoMatch(
  state: UnifiedEntryState,
  input: UnifiedEntryInput,
): UnifiedEntryStepResult {
  if (input.kind === "effect_result") {
    return { state, replies: [] };
  }

  const text = input.text;

  if (isConfirm(text)) {
    // Usuario quiere registrar el caso nuevo.
    // Transicionamos al flujo de registro existente de la maquina principal.
    if (state.domain === "pet") {
      const newState: ConversationState = { flow: "register_pet", step: "nombre", draft: {} };
      return {
        state: newState,
        replies: [reply(M.REGISTER_PET_ASK_NOMBRE, M.skipButtons())],
      };
    }
    const newState: ConversationState = { flow: "register", step: "nombre", draft: {} };
    return {
      state: newState,
      replies: [reply(M.REGISTER_ASK_NOMBRE)],
    };
  }

  if (isCancel(text)) {
    return {
      state: initialState,
      replies: [reply(M.CANCELLED, M.menuButtons())],
    };
  }

  // Respuesta no reconocida: re-preguntar.
  const subject = state.domain === "pet" ? "mascota" : "persona";
  return {
    state,
    replies: [
      reply(`Quieres registrar la ${subject} como caso nuevo para recibir avisos? (Responde Si o No)`),
    ],
  };
}
