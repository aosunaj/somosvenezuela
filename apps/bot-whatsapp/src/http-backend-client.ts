import { publicPersonSchema } from "core";
import { z } from "zod";
import type { BackendClient, PublicPersonResult } from "./ports.js";

// Implementacion real del cliente del backend (spec 01) via fetch.
//
//   POST `${BACKEND_URL}/persons`  -> crea persona, responde la vista publica (con id).
//   GET  `${BACKEND_URL}/search`   -> busca, responde { results: PublicPerson[] + score }.
//
// Identico al cliente del bot de Telegram: el contrato del backend es el mismo para
// todos los canales (un solo backend y modelo de datos). Tipamos/validamos las
// respuestas con los schemas de `core` para no confiar ciegamente en el backend.
// JAMAS pedimos ni leemos contact_id: el contrato del backend ya devuelve la vista
// publica (sin contacto), y aqui lo reforzamos.

/** Respuesta de GET /search: la maquina recibe la vista publica + score. */
const searchResponseSchema = z.object({
  results: z.array(
    publicPersonSchema.extend({ score: z.number().optional() }),
  ),
});

export class HttpBackendClient implements BackendClient {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    // Normalizamos la base para evitar dobles barras al concatenar rutas.
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async createPerson(data: unknown): Promise<{ readonly id: string }> {
    const res = await fetch(`${this.#baseUrl}/persons`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      throw new Error(`POST /persons fallo con estado ${res.status}`);
    }

    const json: unknown = await res.json();
    // Validamos la respuesta como vista publica: confirma que hay id y que NO
    // viene contact_id (publicPersonSchema lo omite del esquema).
    const persona = publicPersonSchema.parse(json);
    return { id: persona.id };
  }

  async searchPersons(
    query: string,
    zona?: string,
  ): Promise<readonly PublicPersonResult[]> {
    const url = new URL(`${this.#baseUrl}/search`);
    url.searchParams.set("q", query);
    if (zona !== undefined && zona.length > 0) {
      url.searchParams.set("zona", zona);
    }

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`GET /search fallo con estado ${res.status}`);
    }

    const json: unknown = await res.json();
    const parsed = searchResponseSchema.parse(json);
    // Normalizamos `score`: solo lo incluimos cuando es un numero. Con
    // exactOptionalPropertyTypes, `score: undefined` no equivale a omitirlo, asi
    // que reconstruimos cada resultado para que el shape calce con PublicPersonResult.
    return parsed.results.map(({ score, ...persona }) =>
      score === undefined ? persona : { ...persona, score },
    );
  }
}
