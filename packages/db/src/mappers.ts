import {
  toPublicPerson,
  toPublicPet,
  type Person,
  type Pet,
  type PublicPerson,
  type PublicPet,
  type Search,
} from "core";
import type {
  PersonRow,
  PersonPublicRow,
  PetRow,
  PetPublicRow,
  SearchRow,
} from "./types.js";

// Mapeo fila-de-BD -> tipo de dominio (`core`). Funciones puras y testeables
// sin red ni BD. Las filas llegan en snake_case (igual que el dominio), por lo
// que el mapeo es estructural, pero se explicita campo a campo para que el tipo
// sea estable y cualquier cambio de esquema rompa aqui de forma visible.

// ── persons ──────────────────────────────────────────────────────────────────

/** Mapea una fila completa de `persons` (tabla base) al tipo de dominio Person. */
export function rowToPerson(row: PersonRow): Person {
  return {
    id: row.id,
    nombre: row.nombre,
    apellidos: row.apellidos,
    edad: row.edad,
    zona: row.zona,
    descripcion: row.descripcion,
    foto_url: row.foto_url,
    estado: row.estado,
    fuente: row.fuente,
    verificacion: row.verificacion,
    contact_id: row.contact_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Mapea una fila de la vista `persons_public` al tipo PublicPerson.
 * La fila ya no trae contact_id (ni la vista ni el tipo lo exponen). Se pasa por
 * toPublicPerson de core como SALVAGUARDA final: si algun dia la fila llegara con
 * contact_id, el proyector lo elimina antes de devolverlo (guardrail #1).
 */
export function publicRowToPublicPerson(row: PersonPublicRow): PublicPerson {
  return toPublicPerson({
    ...row,
    // contact_id se fuerza a null: la vista no lo provee y toPublicPerson lo descarta.
    contact_id: null,
  });
}

// ── pets ─────────────────────────────────────────────────────────────────────

/** Mapea una fila completa de `pets` (tabla base) al tipo de dominio Pet. */
export function rowToPet(row: PetRow): Pet {
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    raza: row.raza,
    zona: row.zona,
    foto_url: row.foto_url,
    estado: row.estado,
    fuente: row.fuente,
    verificacion: row.verificacion,
    contact_id: row.contact_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Mapea una fila de la vista `pets_public` al tipo PublicPet.
 * Misma salvaguarda que en personas: toPublicPet de core elimina contact_id.
 */
export function publicRowToPublicPet(row: PetPublicRow): PublicPet {
  return toPublicPet({
    ...row,
    contact_id: null,
  });
}

// ── searches ─────────────────────────────────────────────────────────────────

/** Mapea una fila completa de `searches` al tipo de dominio Search. */
export function rowToSearch(row: SearchRow): Search {
  return {
    id: row.id,
    tipo: row.tipo,
    target_nombre: row.target_nombre,
    target_descripcion: row.target_descripcion,
    zona: row.zona,
    buscador_contact_id: row.buscador_contact_id,
    es_menor: row.es_menor ?? false,
    created_at: row.created_at,
  };
}
