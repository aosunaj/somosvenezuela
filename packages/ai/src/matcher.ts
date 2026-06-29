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
 *   - 'exacto'  : la similitud de nombre es PERFECTA y COMPLETA (todos los tokens
 *                 buscados y todos los del candidato casan). Coincidir solo el
 *                 nombre de pila de un registro con apellidos NO es 'exacto'.
 *   - 'trigram' : similitud local (levenshtein + trigramas), parcial.
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

/** Similitud entre dos TOKENS (palabras sueltas) ya normalizados. */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  // Tokens son cadenas cortas: pesamos mas Levenshtein que trigramas (capta erratas).
  return combinedSimilarity(a, b, 0.6);
}

/** Suma de los mejores emparejamientos de cada token de `src` contra `dst`. */
function bestMatchSum(src: readonly string[], dst: readonly string[]): number {
  let sum = 0;
  for (const x of src) {
    let best = 0;
    for (const y of dst) {
      const s = tokenSimilarity(x, y);
      if (s > best) best = s;
    }
    sum += best;
  }
  return sum;
}

/**
 * Similitud por nombre TOKEN A TOKEN (no cadena-completa-contra-cadena), entre
 * dos nombres ya normalizados+canonicalizados.
 *
 * POR QUE token a token: comparar "ana" contra "ana osuna jurado" como una sola
 * cadena penaliza por longitud y diluye un acierto real del nombre de pila a un
 * score falsamente bajo. Aqui cada token buscado se empareja con su mejor token
 * del candidato y viceversa.
 *
 * La medida es una F1 difusa (media armonica de dos coberturas):
 *   - precision: cuanto de lo BUSCADO aparece en el candidato.
 *   - recall:    cuanto del CANDIDATO quedo cubierto por lo buscado.
 * Asi, coincidir SOLO el nombre de pila contra un registro con apellidos da un
 * score PARCIAL honesto (recall bajo: hay apellidos sin cubrir), nunca 100%;
 * cubrir mas tokens sube el score; y una errata en un token NO descarta porque
 * el trigram/levenshtein del token la tolera. Coincidencia perfecta y completa
 * de todos los tokens (en ambos sentidos) da 1.
 */
function nameSimilarity(queryName: string, candidateName: string): number {
  const qTokens = queryName.split(" ").filter((t) => t.length > 0);
  const cTokens = candidateName.split(" ").filter((t) => t.length > 0);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  const precision = bestMatchSum(qTokens, cTokens) / qTokens.length;
  const recall = bestMatchSum(cTokens, qTokens) / cTokens.length;
  if (precision + recall === 0) return 0;

  return clamp01((2 * precision * recall) / (precision + recall));
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

/**
 * Media ponderada de las similitudes por campo presentes en la query.
 *
 * Devuelve el `score` agregado [0,1] y `exact`: si la coincidencia es PERFECTA
 * en todos los campos comparados (score === 1). Coincidir un solo campo (p. ej.
 * el nombre de pila de un registro con apellidos) ya NO puede dar 1, porque la
 * similitud de nombre es token a token y penaliza los tokens sin cubrir: el
 * resultado es la MEDIA, nunca el maximo de un campo (guardrail #4 — la IA
 * sugiere, nunca afirma certeza por un acierto parcial).
 */
function localScore(
  query: MatchQuery,
  candidate: PublicPerson,
  weights: { nombre: number; zona: number; descripcion: number },
): { score: number; exact: boolean } {
  const qName = normalizeName(query.nombre);
  const cName = candidateFullName(candidate);
  const nameSim = nameSimilarity(qName, cName);

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
  // 'exacto' SOLO si la media ponderada es perfecta: todos los campos casan al
  // 100%. Un acierto parcial (nombre de pila suelto) cae por debajo de 1.
  const exact = qName.length > 0 && score >= 1;
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
