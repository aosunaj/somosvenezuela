import type { PublicPerson } from "core";

// Capa de acceso a la API REST del backend (GET /search).
//
// CONTRATO DE PRIVACIDAD (guardrail #1): la respuesta publica del backend NUNCA
// incluye contact_id ni dato de contacto. El tipo PublicPerson de "core" ya
// excluye contact_id por construccion (publicPersonSchema = personSchema.omit({ contact_id })),
// asi que cualquier campo de contacto que llegara por error queda fuera del tipo
// y la UI solo renderiza los campos declarados aqui.

/** Resultado de busqueda: persona publica + score de coincidencia [0..1]. */
export interface SearchResult extends PublicPerson {
  /** Similitud trigram [0..1]; mayor = mas probable. */
  score: number;
}

/** Forma de la respuesta de GET /search. */
interface SearchResponse {
  results: SearchResult[];
}

/**
 * URL base del backend. Se lee de VITE_BACKEND_URL; si falta, se usa el backend
 * local de desarrollo (ver README de apps/web).
 */
const DEFAULT_BACKEND_URL = "http://localhost:3000";

function getBackendUrl(): string {
  const fromEnv = import.meta.env.VITE_BACKEND_URL;
  return typeof fromEnv === "string" && fromEnv.length > 0
    ? fromEnv
    : DEFAULT_BACKEND_URL;
}

/** Quita la barra final para construir URLs de forma predecible. */
function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export interface SearchParams {
  /** Termino de busqueda (obligatorio). */
  q: string;
  /** Filtro opcional por zona. */
  zona?: string;
}

/**
 * Llama a GET /search?q=...&zona=... y devuelve los resultados.
 * Lanza un Error con mensaje amable si la respuesta no es correcta.
 */
export async function searchPersons(
  params: SearchParams,
  options?: { signal?: AbortSignal },
): Promise<SearchResult[]> {
  const base = trimTrailingSlash(getBackendUrl());
  const url = new URL(`${base}/search`);
  url.searchParams.set("q", params.q);
  if (params.zona && params.zona.length > 0) {
    url.searchParams.set("zona", params.zona);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options?.signal ?? null,
  });

  if (!response.ok) {
    throw new Error(`La busqueda no respondio correctamente (${response.status}).`);
  }

  const data = (await response.json()) as SearchResponse;
  return Array.isArray(data.results) ? data.results : [];
}
