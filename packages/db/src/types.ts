import type {
  EstadoPersona,
  EstadoVerificacion,
  FuenteDato,
  TipoBusqueda,
  PlataformaCanal,
} from "core";

// Tipos de fila tal como llegan de Supabase (snake_case, columnas de la BD).
// Espejan migrations/0001_init.sql y migrations/0002_rls_policies.sql.
//
// REGLA DE PRIVACIDAD A NIVEL DE TIPO (defensa en profundidad):
//   - Las filas de TABLA BASE (*Row) incluyen contact_id (interno).
//   - Las filas de VISTA PUBLICA (*PublicRow) NO declaran contact_id: la propia
//     vista SQL ya lo excluye, y aqui el tipo lo hace imposible de leer/devolver.
// Los repositorios publicos solo conocen los tipos *PublicRow, de modo que el
// contacto no puede salir ni por accidente.

// ── persons ──────────────────────────────────────────────────────────────────

/** Fila completa de la tabla base `persons` (incluye contact_id interno). */
export interface PersonRow {
  id: string;
  nombre: string;
  apellidos: string | null;
  edad: number | null;
  zona: string | null;
  descripcion: string | null;
  foto_url: string | null;
  estado: EstadoPersona;
  fuente: FuenteDato;
  verificacion: EstadoVerificacion;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fila de la vista `persons_public`: SIN contact_id (la vista lo excluye) y SIN
 * menores (la vista filtra edad<18 y filas en `minors`). No reintroducir ninguno.
 */
export interface PersonPublicRow {
  id: string;
  nombre: string;
  apellidos: string | null;
  edad: number | null;
  zona: string | null;
  descripcion: string | null;
  foto_url: string | null;
  estado: EstadoPersona;
  fuente: FuenteDato;
  verificacion: EstadoVerificacion;
  created_at: string;
  updated_at: string;
}

/** Columnas seleccionables de `persons_public` (orden y nombres exactos de la vista). */
export const PERSON_PUBLIC_COLUMNS =
  "id, nombre, apellidos, edad, zona, descripcion, foto_url, estado, fuente, verificacion, created_at, updated_at" as const;

// ── pets ─────────────────────────────────────────────────────────────────────

/** Fila completa de la tabla base `pets` (incluye contact_id interno). */
export interface PetRow {
  id: string;
  nombre: string | null;
  tipo: string | null;
  raza: string | null;
  zona: string | null;
  foto_url: string | null;
  estado: EstadoPersona;
  fuente: FuenteDato;
  verificacion: EstadoVerificacion;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Fila de la vista `pets_public`: SIN contact_id. */
export interface PetPublicRow {
  id: string;
  nombre: string | null;
  tipo: string | null;
  raza: string | null;
  zona: string | null;
  foto_url: string | null;
  estado: EstadoPersona;
  fuente: FuenteDato;
  verificacion: EstadoVerificacion;
  created_at: string;
  updated_at: string;
}

/** Columnas seleccionables de `pets_public`. */
export const PET_PUBLIC_COLUMNS =
  "id, nombre, tipo, raza, zona, foto_url, estado, fuente, verificacion, created_at, updated_at" as const;

// ── searches ─────────────────────────────────────────────────────────────────

/** Fila completa de la tabla base `searches` (incluye buscador_contact_id sensible). */
export interface SearchRow {
  id: string;
  tipo: TipoBusqueda;
  target_nombre: string | null;
  target_descripcion: string | null;
  zona: string | null;
  buscador_contact_id: string | null;
  /** Señal de menor (conservativa). Default false. */
  es_menor: boolean;
  created_at: string;
}

// ── matches ──────────────────────────────────────────────────────────────────

/** Metodo que produjo el score de un match. Espeja el CHECK del esquema. */
export type MatchMetodo = "exacto" | "trigram" | "ia";

/** Estado de revision humana de un match. Espeja el CHECK del esquema. */
export type MatchEstadoRevision = "propuesto" | "confirmado" | "descartado";

/**
 * Estado de consentimiento de UNA parte (buscador o registrante) en un reencuentro.
 * Espeja el CHECK de migrations/0006. Ciclo: sin_solicitar -> solicitado ->
 * aceptado | rechazado.
 */
export type ConsentimientoEstado =
  | "sin_solicitar"
  | "solicitado"
  | "aceptado"
  | "rechazado";

/**
 * Estado del reencuentro a nivel de match. Espeja el CHECK de migrations/0006.
 * El intercambio de contacto SOLO ocurre en 'intercambiado' (doble aceptado).
 */
export type ReunionEstado =
  | "inactiva"
  | "pendiente"
  | "intercambiado"
  | "rechazada";

/**
 * Fila completa de la tabla base `matches` (migrations/0001 + 0006). Una coincidencia
 * PROPUESTA por el motor entre una busqueda y una persona/mascota, para REVISION
 * HUMANA, mas el consentimiento BILATERAL de reencuentro (0006). No contiene PII:
 * solo ids internos, score, estado de revision y los estados de consentimiento.
 */
export interface MatchRow {
  id: string;
  search_id: string | null;
  person_id: string | null;
  pet_id: string | null;
  /** numeric(4,3) en [0,1]; llega como number desde supabase-js. */
  score: number;
  metodo: MatchMetodo;
  estado_revision: MatchEstadoRevision;
  /** Identificador libre del revisor humano (sin PII). */
  revisado_por: string | null;
  /** Consentimiento de quien busca (0006). Por defecto 'sin_solicitar'. */
  consentimiento_buscador: ConsentimientoEstado;
  /** Consentimiento de quien registro a la persona (0006). Por defecto 'sin_solicitar'. */
  consentimiento_registrante: ConsentimientoEstado;
  /** Estado del reencuentro (0006). Por defecto 'inactiva'. */
  reunion_estado: ReunionEstado;
  created_at: string;
}

// ── person_state_changes (AUDITORIA, INTERNA) ────────────────────────────────

/**
 * Fila de la tabla `person_state_changes` (migrations/0005). Auditoria de cambios
 * de estado sensibles de personas (guardrail #8: quien + cuando). INTERNA: solo
 * backend. `changed_by_contact_id` referencia contacts (sensible), por eso la tabla
 * tiene RLS deny-all.
 */
export interface PersonStateChangeRow {
  id: string;
  person_id: string;
  /** Estado previo. Nulo cuando el flujo no lo conoce (p. ej. no se leyo antes). */
  estado_anterior: EstadoPersona | null;
  estado_nuevo: EstadoPersona;
  /** Contacto que provoco el cambio (el dueno del canal en el rescatado). */
  changed_by_contact_id: string | null;
  changed_at: string;
}

// ── contacts (SENSIBLE) ──────────────────────────────────────────────────────

/** Fila completa de la tabla base `contacts`. SENSIBLE: solo backend. */
export interface ContactRow {
  id: string;
  telefono: string | null;
  email: string | null;
  solo_uso_interno: boolean;
  created_at: string;
}

// ── channels (SENSIBLE) ──────────────────────────────────────────────────────

/** Fila completa de la tabla base `channels`. SENSIBLE: solo backend. */
export interface ChannelRow {
  id: string;
  contact_id: string;
  plataforma: PlataformaCanal;
  chat_id: string;
  opt_in: boolean;
  created_at: string;
}

// ── alive_messages ─────────────────────────────────────────────────────────

/**
 * Fila de la tabla base `alive_messages` tal como llega de Supabase (snake_case).
 * NO contiene datos de contacto: autor_nombre es un nombre libre, no un contact_id.
 * Espeja migrations/0001_init.sql.
 */
export interface AliveMessageRow {
  id: string;
  person_id: string | null;
  autor_nombre: string;
  tipo: string;
  contenido: string;
  zona: string | null;
  entregado: boolean;
  created_at: string;
}
