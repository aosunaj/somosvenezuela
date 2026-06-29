import { publicPersonSchema, publicPetSchema } from "core";
import { z } from "zod";
import {
  NotOwnerError,
  type BackendClient,
  type ChannelIdentity,
  type PublicPersonResult,
  type PublicPetResult,
} from "./ports.js";

// Implementacion real del cliente del backend (spec 01) via fetch.
//
//   POST   `${BACKEND_URL}/persons`                 -> crea persona (slice anterior).
//   POST   `${BACKEND_URL}/register-person`         -> crea persona VINCULADA al canal.
//   DELETE `${BACKEND_URL}/persons/:id/by-channel`  -> borra si el canal es dueno.
//   POST   `${BACKEND_URL}/searches`                -> busca persona, vincula al buscador.
//   GET    `${BACKEND_URL}/search/pets`             -> busca mascotas (vista publica).
//
// Tipamos/validamos las respuestas con los schemas de `core` para no confiar
// ciegamente en el backend. JAMAS pedimos ni leemos contact_id: el contrato del
// backend ya devuelve la vista publica (sin contacto), y aqui lo reforzamos.

/** Respuesta de POST /register-person: solo nos interesa el id creado. */
const registerResponseSchema = z.object({
  personId: z.string(),
});

/** Respuesta de POST /searches: la maquina recibe la vista publica + score. */
const searchPersonsResponseSchema = z.object({
  results: z.array(
    publicPersonSchema.extend({ score: z.number().optional() }),
  ),
});

/** Respuesta de GET /search/pets: vista publica de mascota + score. */
const searchPetsResponseSchema = z.object({
  results: z.array(
    publicPetSchema.extend({ score: z.number().optional() }),
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

  async registerPerson(
    person: unknown,
    channel: ChannelIdentity,
  ): Promise<{ readonly id: string }> {
    const res = await fetch(`${this.#baseUrl}/register-person`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // El backend persiste el vinculo usuario<->canal a partir de `channel`.
      body: JSON.stringify({ person, channel }),
    });

    if (!res.ok) {
      throw new Error(`POST /register-person fallo con estado ${res.status}`);
    }

    const json: unknown = await res.json();
    const parsed = registerResponseSchema.parse(json);
    return { id: parsed.personId };
  }

  async deleteByChannel(
    personId: string,
    channel: ChannelIdentity,
  ): Promise<void> {
    const res = await fetch(
      `${this.#baseUrl}/persons/${encodeURIComponent(personId)}/by-channel`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        // El backend autoriza con el vinculo del canal; no enviamos contact_id.
        body: JSON.stringify({
          plataforma: channel.plataforma,
          chatId: channel.chatId,
        }),
      },
    );

    // 204: borrado autorizado y hecho. 403: el canal no es dueno (fallo esperado).
    if (res.status === 403) {
      throw new NotOwnerError();
    }
    if (!res.ok) {
      throw new Error(
        `DELETE /persons/:id/by-channel fallo con estado ${res.status}`,
      );
    }
  }

  async searchPersons(
    query: string,
    zona?: string,
    channel?: ChannelIdentity,
  ): Promise<readonly PublicPersonResult[]> {
    const body: Record<string, unknown> = {
      tipo: "persona",
      target_nombre: query,
    };
    if (zona !== undefined && zona.length > 0) {
      body["zona"] = zona;
    }
    // Pasamos el canal para que el backend vincule al buscador y pueda
    // notificarle despues si aparece una coincidencia (Capa 2: reunir familias).
    if (channel !== undefined) {
      body["channel"] = channel;
    }

    const res = await fetch(`${this.#baseUrl}/searches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`POST /searches fallo con estado ${res.status}`);
    }

    const json: unknown = await res.json();
    const parsed = searchPersonsResponseSchema.parse(json);
    // Normalizamos `score`: solo lo incluimos cuando es un numero. Con
    // exactOptionalPropertyTypes, `score: undefined` no equivale a omitirlo, asi
    // que reconstruimos cada resultado para que el shape calce con PublicPersonResult.
    return parsed.results.map(({ score, ...persona }) =>
      score === undefined ? persona : { ...persona, score },
    );
  }

  async searchPets(
    query: string,
    zona?: string,
  ): Promise<readonly PublicPetResult[]> {
    const url = new URL(`${this.#baseUrl}/search/pets`);
    url.searchParams.set("q", query);
    if (zona !== undefined && zona.length > 0) {
      url.searchParams.set("zona", zona);
    }

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`GET /search/pets fallo con estado ${res.status}`);
    }

    const json: unknown = await res.json();
    // Validamos como vista publica de mascota: confirma que NO viene contact_id.
    const parsed = searchPetsResponseSchema.parse(json);
    return parsed.results.map(({ score, ...mascota }) =>
      score === undefined ? mascota : { ...mascota, score },
    );
  }
}
