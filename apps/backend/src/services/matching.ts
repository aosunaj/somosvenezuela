import { rankCandidates, type MatchQuery } from "ai";
import type { MatchRepo, PersonRepo } from "db";

// Servicio de matching (CEREBRO del ciclo): dada una busqueda recien creada,
// propone personas candidatas y las persiste como `matches` PROPUESTOS para
// revision humana.
//
// GUARDRAILS:
//   - #2 (menores): los candidatos salen de personRepo.searchPersonsPublic, que
//     lee la vista persons_public (excluye menores y contact_id). Nunca tocamos la
//     tabla base ni incluimos menores.
//   - #4 (la IA sugiere, los humanos confirman): aqui SOLO se crean matches
//     'propuesto'. NO se notifica a nadie. La notificacion al buscador nace mas
//     tarde, cuando un humano confirma el match (POST /matches/:id/confirm).
//   - Determinista en v1: rankCandidates corre sin AiScorer (similitud local pura).
//
// El servicio es testeable con repos falsos: no toca red ni Supabase.

/** Umbral minimo de score [0,1] para persistir un match (descarta el ruido). */
export const MATCH_THRESHOLD = 0.45;

/** Maximo de matches que se persisten por busqueda (los N mejores). */
export const MATCH_TOP_N = 10;

/** Dependencias del servicio de matching (inyectadas para testear sin BD). */
export interface MatchingDeps {
  personRepo: PersonRepo;
  matchRepo: MatchRepo;
}

/** Parametros de afinado del matching (opcionales; defaults sensatos). */
export interface RunMatchingOptions {
  /** Umbral minimo de score para persistir. Por defecto MATCH_THRESHOLD. */
  threshold?: number;
  /** Maximo de matches a persistir. Por defecto MATCH_TOP_N. */
  topN?: number;
}

/** Resultado de una corrida de matching (para diagnostico, sin PII). */
export interface RunMatchingResult {
  /** Numero de matches PROPUESTOS efectivamente persistidos. */
  created: number;
}

/**
 * Corre el matching para una busqueda de persona y persiste los candidatos que
 * superen el umbral (top-N) como matches 'propuesto'.
 *
 * @param searchId  id de la busqueda recien creada.
 * @param query     nombre/zona/descripcion buscados (sin datos de contacto).
 *
 * No corre si la query no trae NINGUN criterio (nombre, zona o descripcion): no
 * hay con que recuperar ni puntuar. Es seguro de llamar en best-effort: el
 * llamador puede ignorar el resultado.
 */
export async function runMatchingForSearch(
  deps: MatchingDeps,
  searchId: string,
  query: MatchQuery,
  options: RunMatchingOptions = {},
): Promise<RunMatchingResult> {
  const threshold = options.threshold ?? MATCH_THRESHOLD;
  const topN = options.topN ?? MATCH_TOP_N;

  // Termino de RECUPERACION del pool: el primer criterio textual disponible
  // (nombre > descripcion). La zona se reenvia siempre como filtro del RPC.
  // Sin ningun criterio no hay nada que buscar.
  const nombre = query.nombre?.trim() ?? "";
  const descripcion = query.descripcion?.trim() ?? "";
  const zona = query.zona?.trim() ?? "";
  const tieneCriterio = nombre.length > 0 || descripcion.length > 0 || zona.length > 0;
  if (!tieneCriterio) return { created: 0 };

  // 1) Candidatos: busqueda difusa publica (trgm) -> SOLO persons_public (sin
  //    menores, sin contact_id). Sin nombre usamos la descripcion como termino
  //    libre; la zona, si viene, acota el pool via zona_filtro. Con q vacio y
  //    solo zona, el RPC recupera por el filtro de zona.
  const termino = nombre.length > 0 ? nombre : descripcion;
  const candidates = await deps.personRepo.searchPersonsPublic(termino, query.zona);
  if (candidates.length === 0) return { created: 0 };

  // 2) Re-ranking determinista local (sin AiScorer): la IA SUGIERE con score.
  const ranked = await rankCandidates(query, candidates);

  // 3) Persiste como matches 'propuesto' SOLO los que superen el umbral (top-N).
  const toPersist = ranked
    .filter((r) => r.score >= threshold)
    .slice(0, topN);

  let created = 0;
  for (const { candidate, score, method } of toPersist) {
    await deps.matchRepo.create({
      search_id: searchId,
      person_id: candidate.id,
      score,
      metodo: method,
    });
    created += 1;
  }

  return { created };
}
