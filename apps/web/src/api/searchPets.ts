import type { PublicPet } from "core";
import { getApiBase } from "./http.ts";

// Capa de acceso a la API REST del backend (GET /search/pets).
//
// CONTRATO DE PRIVACIDAD (guardrail #1): la respuesta publica del backend NUNCA
// incluye contact_id ni dato de contacto. El tipo PublicPet de "core" ya
// excluye contact_id por construccion (publicPetSchema = petSchema.omit({ contact_id })),
// asi que cualquier campo de contacto que llegara por error queda fuera del tipo
// y la UI solo renderiza los campos declarados aqui.

/** Resultado de busqueda de mascota: mascota publica + score de coincidencia [0..1]. */
export interface PetSearchResult extends PublicPet {
  /** Similitud trigram [0..1]; mayor = mas probable. */
  score: number;
}

/** Forma de la respuesta de GET /search/pets. */
interface PetSearchResponse {
  results: PetSearchResult[];
}

export interface PetSearchParams {
  /** Termino de busqueda (obligatorio). */
  q: string;
  /** Filtro opcional por zona. */
  zona?: string;
}

/**
 * Llama a GET /search/pets?q=...&zona=... y devuelve los resultados.
 * Lanza un Error con mensaje amable si la respuesta no es correcta.
 */
export async function searchPets(
  params: PetSearchParams,
  options?: { signal?: AbortSignal },
): Promise<PetSearchResult[]> {
  const url = new URL(`${getApiBase()}/search/pets`);
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
    throw new Error(
      `La busqueda no respondio correctamente (${response.status}).`,
    );
  }

  const data = (await response.json()) as PetSearchResponse;
  return Array.isArray(data.results) ? data.results : [];
}
