// Motor de matching local: ordena candidatos por parecido a una busqueda.
//
// DETERMINISTA y PURO por defecto: sin red, sin estado global. La capa de IA
// (AiScorer) es OPCIONAL y se inyecta; si no esta, el motor funciona igual
// (degradacion segura, guardrail #5).
//
// La IA SUGIERE, los humanos confirman: el resultado son candidatos con score
// para REVISION HUMANA. Aqui NADA se "confirma". El estado de revision de un
// match (p.ej. 'propuesto') es responsabilidad del dominio/BD, no de este motor.

import type { PublicPerson } from "core";
import {
  normalizeName,
  normalizeText,
} from "./normalize.js";
import {
  clamp01,
  combinedSimilarity,
  levenshteinSimilarity,
  trigramSimilarity,
} from "./similarity.js";
import type { AiScorer } from "./scorer.js";

/**
 * Metodo que produjo el score de un candidato.
 *   - 'exacto'  : el nombre normalizado coincide exactamente.
 *   - 'trigram' : similitud local (levenshtein + trigramas).
 *   - 'ia'      : score ajustado por la capa de IA (Claude). Solo si se inyecta
 *                 un AiScorer y este eleva la confianza de un caso dudoso.
 */
export type MatchMethod = "exacto" | "trigram" | "ia";

/** Busqueda de entrada para el matcher (texto libre, sin datos de contacto). */
export interface MatchQuery {
  /** Nombre/identificador buscado (obligatorio para puntuar por nombre). */
  readonly nombre: string;
  /** Zona buscada, opcional. */
  readonly zona?: string;
  /** Descripcion libre buscada, opcional. */
  readonly descripcion?: string;
}

/** Un candidato puntuado: sugerencia para revision humana, nunca confirmacion. */
export interface RankedCandidate {
  /** Candidato evaluado (vista publica: jamas datos de contacto). */
  readonly candidate: PublicPerson;
  /** Score agregado en [0, 1]. */
  readonly score: number;
  /** Como se obtuvo el score. */
  readonly method: MatchMethod;
}

/** Opciones del ranking. Todas opcionales: el motor tiene defaults sensatos. */
export interface RankOptions {
  /**
   * Pesos relativos de cada campo en el score agregado. Se normalizan
   * internamente, asi que no hace falta que sumen 1.
   */
  readonly weights?: {
    readonly nombre?: number;
    readonly zona?: number;
    readonly descripcion?: number;
  };
  /**
   * Umbral de "duda" en [0, 1]: candidatos con score local en
   * [aiDoubtMin, aiDoubtMax] son los unicos que se enviarian a la IA (si hay
   * AiScorer). Por defecto [0.45, 0.85]: ni claramente match ni claramente no.
   */
  readonly aiDoubtMin?: number;
  readonly aiDoubtMax?: number;
  /**
   * Capa de IA opcional (Claude). Si se omite, el motor solo usa similitud
   * local. Inyectarla NO cambia el contrato: la IA sigue SUGIRIENDO con score.
   */
  readonly aiScorer?: AiScorer;
}

const DEFAULT_WEIGHTS = { nombre: 0.7, zona: 0.15, descripcion: 0.15 } as const;
const DEFAULT_AI_DOUBT_MIN = 0.45;
const DEFAULT_AI_DOUBT_MAX = 0.85;

/** Similitud por nombre entre dos textos ya normalizados+canonicalizados. */
function nameSimilarity(queryName: string, candidateName: string): number {
  if (queryName.length === 0 || candidateName.length === 0) return 0;
  if (queryName === candidateName) return 1;
  // Nombres son cadenas cortas: pesamos mas Levenshtein que trigramas.
  return combinedSimilarity(queryName, candidateName, 0.6);
}

/** Similitud por campo de texto libre (zona/descripcion) ya normalizado. */
function fieldSimilarity(query: string, candidate: string): number {
  if (query.length === 0 || candidate.length === 0) return 0;
  if (query === candidate) return 1;
  // Texto libre: trigramas capta reordenamientos mejor que Levenshtein.
  return clamp01(0.4 * levenshteinSimilarity(query, candidate) + 0.6 * trigramSimilarity(query, candidate));
}

/**
 * Combina el nombre completo del candidato (nombre + apellidos) en un solo
 * texto normalizado para comparar contra la busqueda.
 */
function candidateFullName(candidate: PublicPerson): string {
  const apellidos = candidate.apellidos ?? "";
  return normalizeName(`${candidate.nombre} ${apellidos}`.trim());
}

/** Media ponderada de las similitudes por campo presentes en la query. */
function localScore(
  query: MatchQuery,
  candidate: PublicPerson,
  weights: { nombre: number; zona: number; descripcion: number },
): { score: number; exact: boolean } {
  const qName = normalizeName(query.nombre);
  const cName = candidateFullName(candidate);
  const nameSim = nameSimilarity(qName, cName);
  const exact = qName.length > 0 && qName === cName;

  let weightSum = weights.nombre;
  let acc = weights.nombre * nameSim;

  if (query.zona !== undefined && candidate.zona !== null) {
    const sim = fieldSimilarity(normalizeText(query.zona), normalizeText(candidate.zona));
    acc += weights.zona * sim;
    weightSum += weights.zona;
  }
  if (query.descripcion !== undefined && candidate.descripcion !== null) {
    const sim = fieldSimilarity(
      normalizeText(query.descripcion),
      normalizeText(candidate.descripcion),
    );
    acc += weights.descripcion * sim;
    weightSum += weights.descripcion;
  }

  const score = weightSum > 0 ? clamp01(acc / weightSum) : 0;
  return { score, exact };
}

/**
 * Ordena `candidates` por parecido a `query`, de mayor a menor score.
 *
 * Determinista y degradado por defecto (solo similitud local). Si se inyecta
 * `options.aiScorer`, los candidatos DUDOSOS (score local en la banda de duda)
 * se re-puntuan con la IA; el resto se resuelve localmente. La IA SUGIERE: su
 * score reemplaza al local solo para desempatar dudosos, nunca confirma nada.
 *
 * Empates: orden estable por score desc; a igualdad de score se conserva el
 * orden de entrada (sort estable de V8) para resultados reproducibles.
 */
export async function rankCandidates(
  query: MatchQuery,
  candidates: readonly PublicPerson[],
  options: RankOptions = {},
): Promise<RankedCandidate[]> {
  const weights = {
    nombre: options.weights?.nombre ?? DEFAULT_WEIGHTS.nombre,
    zona: options.weights?.zona ?? DEFAULT_WEIGHTS.zona,
    descripcion: options.weights?.descripcion ?? DEFAULT_WEIGHTS.descripcion,
  };
  const doubtMin = clamp01(options.aiDoubtMin ?? DEFAULT_AI_DOUBT_MIN);
  const doubtMax = clamp01(options.aiDoubtMax ?? DEFAULT_AI_DOUBT_MAX);
  const aiScorer = options.aiScorer;

  const qName = normalizeName(query.nombre);
  const qZone = query.zona !== undefined ? normalizeText(query.zona) : undefined;
  const qDesc =
    query.descripcion !== undefined ? normalizeText(query.descripcion) : undefined;

  const ranked: RankedCandidate[] = [];

  for (const candidate of candidates) {
    const { score: local, exact } = localScore(query, candidate, weights);

    if (exact) {
      ranked.push({ candidate, score: 1, method: "exacto" });
      continue;
    }

    let score = local;
    let method: MatchMethod = "trigram";

    // Solo los casos DUDOSOS pasan por la IA (ahorra coste y latencia).
    const isDoubtful = local >= doubtMin && local <= doubtMax;
    if (aiScorer !== undefined && isDoubtful) {
      try {
        const ai = await aiScorer.score({
          queryName: qName,
          ...(qZone !== undefined ? { queryZone: qZone } : {}),
          ...(qDesc !== undefined ? { queryDescription: qDesc } : {}),
          candidate,
        });
        score = clamp01(ai.score);
        method = "ia";
      } catch {
        // DEGRADACION SEGURA: si la IA falla, conservamos el score local.
        score = local;
        method = "trigram";
      }
    }

    ranked.push({ candidate, score, method });
  }

  // Orden estable por score descendente.
  return ranked.sort((a, b) => b.score - a.score);
}
