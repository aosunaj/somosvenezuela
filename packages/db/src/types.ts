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
  created_at: string;
}

// ── matches ──────────────────────────────────────────────────────────────────

/** Metodo que produjo el score de un match. Espeja el CHECK del esquema. */
export type MatchMetodo = "exacto" | "trigram" | "ia";

/** Estado de revision humana de un match. Espeja el CHECK del esquema. */
export type MatchEstadoRevision = "propuesto" | "confirmado" | "descartado";

/**
 * Fila completa de la tabla base `matches` (migrations/0001). Una coincidencia
 * PROPUESTA por el motor entre una busqueda y una persona/mascota, para REVISION
 * HUMANA. No contiene PII: solo ids internos, score y estado de revision.
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
  created_at: string;
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
