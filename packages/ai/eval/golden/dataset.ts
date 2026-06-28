// Set DORADO SINTETICO para evaluar el matching (T3.4 parcial, docs/harness.md).
//
// Datos 100% FICTICIOS — sin PII real (guardrail #1). Personas y zonas
// inventadas para Venezuela. Cada caso es un par busqueda <-> candidatos con
// etiqueta de cual es el match esperado (o ninguno).
//
// Cada candidato es una `PublicPerson`: vista publica del dominio, SIN datos de
// contacto (core/schemas.ts). El eval mide si el matcher pone el candidato
// etiquetado como match en la primera posicion (precision/recall simples).

import type { PublicPerson } from "core";
import type { MatchQuery } from "../../src/index.js";

/** Un caso del set dorado. */
export interface GoldenCase {
  /** Identificador legible del caso (para el reporte). */
  readonly id: string;
  /** Que se busca. */
  readonly query: MatchQuery;
  /** Universo de candidatos a rankear. */
  readonly candidates: readonly PublicPerson[];
  /**
   * Id del candidato que DEBERIA quedar primero, o `null` si se espera que
   * NINGUN candidato sea un match razonable (caso negativo).
   */
  readonly expectedMatchId: string | null;
}

// Timestamps fijos: el motor no los usa, pero el tipo PublicPerson los exige.
const TS = "2026-06-01T00:00:00.000Z";

/** Construye una PublicPerson sintetica con defaults neutros. */
function person(
  id: string,
  nombre: string,
  opts: {
    apellidos?: string | null;
    edad?: number | null;
    zona?: string | null;
    descripcion?: string | null;
  } = {},
): PublicPerson {
  return {
    id,
    nombre,
    apellidos: opts.apellidos ?? null,
    edad: opts.edad ?? null,
    zona: opts.zona ?? null,
    descripcion: opts.descripcion ?? null,
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: TS,
    updated_at: TS,
  };
}

// ── Identificadores sinteticos (uuid v4 ficticios y constantes) ──────────────
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const P4 = "44444444-4444-4444-8444-444444444444";
const P5 = "55555555-5555-4555-8555-555555555555";
const P6 = "66666666-6666-4666-8666-666666666666";
const P7 = "77777777-7777-4777-8777-777777777777";
const P8 = "88888888-8888-4888-8888-888888888888";

export const GOLDEN_CASES: readonly GoldenCase[] = [
  {
    // Match exacto con tilde en la busqueda.
    id: "exacto-con-tilde",
    query: { nombre: "José Martínez" },
    candidates: [
      person(P1, "Jose", { apellidos: "Martinez", zona: "Caracas" }),
      person(P2, "Luis", { apellidos: "Hernandez", zona: "Valencia" }),
    ],
    expectedMatchId: P1,
  },
  {
    // Apodo "Pepe" debe casar con "Jose".
    id: "apodo-pepe-jose",
    query: { nombre: "Pepe Rodriguez", zona: "Maracaibo" },
    candidates: [
      person(P3, "Jose", { apellidos: "Rodriguez", zona: "Maracaibo" }),
      person(P4, "Pedro", { apellidos: "Rojas", zona: "Maracaibo" }),
    ],
    expectedMatchId: P3,
  },
  {
    // Errata simple en el apellido (Gonzalez vs Gonzales).
    id: "errata-apellido",
    query: { nombre: "Maria Gonzalez", zona: "Barquisimeto" },
    candidates: [
      person(P5, "Maria", { apellidos: "Gonzales", zona: "Barquisimeto" }),
      person(P6, "Marta", { apellidos: "Guzman", zona: "Barquisimeto" }),
    ],
    expectedMatchId: P5,
  },
  {
    // "Toño" (apodo de Antonio) + zona ligeramente distinta.
    id: "apodo-tono-antonio",
    query: { nombre: "Toño Pérez", zona: "San Cristobal" },
    candidates: [
      person(P7, "Antonio", { apellidos: "Perez", zona: "San Cristobal centro" }),
      person(P8, "Andres", { apellidos: "Paredes", zona: "Merida" }),
    ],
    expectedMatchId: P7,
  },
  {
    // Caso NEGATIVO: nadie en el universo se parece a la busqueda.
    id: "sin-match",
    query: { nombre: "Wladimir Echeverria", zona: "Punto Fijo" },
    candidates: [
      person(P2, "Luis", { apellidos: "Hernandez", zona: "Valencia" }),
      person(P6, "Marta", { apellidos: "Guzman", zona: "Barquisimeto" }),
    ],
    expectedMatchId: null,
  },
  {
    // Match por nombre + descripcion (reordenamiento y palabras extra).
    id: "descripcion-reordenada",
    query: {
      nombre: "Carmen Salas",
      descripcion: "camisa azul, pelo rizado, estatura media",
    },
    candidates: [
      person(P1, "Carmen", {
        apellidos: "Salas",
        descripcion: "estatura media, pelo rizado y camisa azul",
      }),
      person(P2, "Carla", {
        apellidos: "Solis",
        descripcion: "chaqueta negra, pelo liso",
      }),
    ],
    expectedMatchId: P1,
  },
];

/** Umbral minimo para considerar un candidato como match (sugerencia fuerte). */
export const MATCH_SCORE_THRESHOLD = 0.6;
