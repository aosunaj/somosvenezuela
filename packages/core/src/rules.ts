import {
  DEFAULT_ESTADO,
  DEFAULT_FUENTE,
  DEFAULT_VERIFICACION,
  type EstadoPersona,
  type EstadoVerificacion,
} from "./enums.js";
import {
  type PublicPerson,
  type PublicPet,
} from "./schemas.js";

// Reglas de dominio PURAS (sin efectos secundarios, sin red, sin BD).
// Reflejan los guardrails de docs/guardrails.md y se testean en aislamiento.

// ── Defaults al crear ────────────────────────────────────────────────────────

/** Estado y verificacion por defecto de cualquier registro nuevo. */
export interface RegistroDefaults {
  estado: EstadoPersona;
  verificacion: EstadoVerificacion;
}

/**
 * Defaults de creacion: todo registro nace `desaparecida` + `sin_verificar`
 * (guardrails #3 y #4; DEFAULT del esquema SQL).
 */
export function defaultsDeCreacion(): RegistroDefaults {
  return { estado: DEFAULT_ESTADO, verificacion: DEFAULT_VERIFICACION };
}

/** Fuente por defecto de un registro propio. */
export function fuentePorDefecto() {
  return DEFAULT_FUENTE;
}

// ── Guardrail: fallecidos ────────────────────────────────────────────────────

/**
 * Combinacion estado/verificacion a validar contra el guardrail de fallecidos.
 */
export interface EstadoVerificacionInput {
  estado: EstadoPersona;
  verificacion: EstadoVerificacion;
}

/**
 * Guardrail de fallecidos: `estado='fallecida'` SOLO si `verificacion='verificada'`.
 * Refuerza en dominio la constraint SQL `fallecida_requiere_verificacion`.
 * Nunca se marca un fallecimiento por rumor (guardrail #3).
 */
export function esEstadoFallecidoValido(input: EstadoVerificacionInput): boolean {
  if (input.estado !== "fallecida") return true;
  return input.verificacion === "verificada";
}

/** Error de dominio para transiciones/registros que violan un guardrail. */
export class GuardrailError extends Error {
  override readonly name = "GuardrailError";
  constructor(
    message: string,
    /** Identificador estable del guardrail violado (para logs/tests). */
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Valida el guardrail de fallecidos y lanza si se viola.
 * Usar antes de persistir cualquier cambio de estado a `fallecida`.
 */
export function assertEstadoFallecidoValido(input: EstadoVerificacionInput): void {
  if (!esEstadoFallecidoValido(input)) {
    throw new GuardrailError(
      "No se puede marcar 'fallecida' sin verificacion 'verificada' (fuente fiable).",
      "fallecida_requiere_verificacion",
    );
  }
}

// ── Guardrail #1: ocultar contacto ───────────────────────────────────────────

/** Entrada minima para derivar la vista publica de una persona. */
type PersonConContacto = PublicPerson & { contact_id: string | null };
/** Entrada minima para derivar la vista publica de una mascota. */
type PetConContacto = PublicPet & { contact_id: string | null };

/**
 * Proyecta una persona a su vista publica eliminando `contact_id` y cualquier
 * dato de contacto. CRITICO: el contacto NUNCA es visible (guardrail #1, spec 01).
 */
export function toPublicPerson(person: PersonConContacto): PublicPerson {
  const { contact_id: _contact_id, ...publica } = person;
  void _contact_id;
  return publica;
}

/**
 * Proyecta una mascota a su vista publica eliminando `contact_id`.
 * CRITICO: el contacto NUNCA es visible (guardrail #1).
 */
export function toPublicPet(pet: PetConContacto): PublicPet {
  const { contact_id: _contact_id, ...publica } = pet;
  void _contact_id;
  return publica;
}
