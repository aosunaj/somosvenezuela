// ai — Motor de IA de matching de SomosVenezuela (Fase 3 · T3.1 + T3.2 local).
//
// Matching DETERMINISTA y PURO: dado lo que alguien busca, propone las personas
// registradas que mas se parecen, con un score, para REVISION HUMANA.
//
// GUARDRAILS (docs/guardrails.md #5): la IA SUGIERE con score, NUNCA decide.
// La capa de IA (Claude) es OPCIONAL y se inyecta tras la interfaz `AiScorer`;
// sin ella, el matching local sigue funcionando (degradacion segura). Este
// paquete NO hace llamadas de red.

export {
  NICKNAME_CANON,
  canonicalizeToken,
  nameTokens,
  normalizeName,
  normalizeText,
} from "./normalize.js";

export {
  clamp01,
  combinedSimilarity,
  levenshteinDistance,
  levenshteinSimilarity,
  trigramSimilarity,
  trigrams,
} from "./similarity.js";

export {
  rankCandidates,
  type MatchMethod,
  type MatchQuery,
  type RankOptions,
  type RankedCandidate,
} from "./matcher.js";

export {
  NullAiScorer,
  type AiScoreRequest,
  type AiScoreResult,
  type AiScorer,
} from "./scorer.js";

// Reexporta tipos del dominio que aparecen en la API publica del motor, para
// que los consumidores no tengan que importar de "core" por separado.
export type { PublicPerson, Search } from "core";
