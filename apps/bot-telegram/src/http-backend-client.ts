import {
  ownedPersonSchema,
  publicNeedSchema,
  publicPersonSchema,
  publicPetSchema,
  publicZoneSchema,
} from "core";
import { z } from "zod";
import type { OwnedPerson, PublicNeed, PublicZone } from "core";
import {
  NotOwnerError,
  type ActiveRelayInfo,
  type BackendClient,
  type ChannelIdentity,
  type PublicPersonResult,
  type PublicPetResult,
  type RescatadoStatus,
  type ReunionConsentStatus,
  type ReunionDecision,
  type ReunionRequestStatus,
} from "./ports.js";

// Implementacion real del cliente del backend (spec 01) via fetch.
//
//   POST   `${BACKEND_URL}/persons`                 -> crea persona (slice anterior).
//   POST   `${BACKEND_URL}/register-person`         -> crea persona VINCULADA al canal.
//   POST   `${BACKEND_URL}/pets`                     -> crea mascota VINCULADA al canal.
//   DELETE `${BACKEND_URL}/persons/:id/by-channel`  -> borra si el canal es dueno.
//   POST   `${BACKEND_URL}/persons/:id/found-by-channel` -> marca encontrado si dueno.
//   POST   `${BACKEND_URL}/searches`                -> busca persona, vincula al buscador.
//   GET    `${BACKEND_URL}/search/pets`             -> busca mascotas (vista publica).
//   GET    `${BACKEND_URL}/zones`                   -> lista zonas publicas (mapa).
//   Relay (F4):
//   GET    `${BACKEND_URL}/relay/active`            -> consulta relay activo del canal.
//   POST   `${BACKEND_URL}/relay/:id/forward`       -> reenviar mensaje por relay (cola).
//   POST   `${BACKEND_URL}/relay/:id/close`         -> cerrar relay ambas partes.
//   POST   `${BACKEND_URL}/consent/:id/respond`     -> responder consent session.
//   POST   `${BACKEND_URL}/relay/:id/reveal`        -> solicitar revelacion bilateral.
//   POST   `${BACKEND_URL}/consent/sweep`           -> expirar consent sessions vencidos.
//   GET    `${BACKEND_URL}/needs`                   -> lista necesidades publicas (mapa).
//   POST   `${BACKEND_URL}/rescatado`               -> reportar persona encontrada (Slice D).
//
// Tipamos/validamos las respuestas con los schemas de `core` para no confiar
// ciegamente en el backend. JAMAS pedimos ni leemos contact_id: el contrato del
// backend ya devuelve la vista publica (sin contacto), y aqui lo reforzamos.

/** Respuesta de POST /register-person: solo nos interesa el id creado. */
const registerResponseSchema = z.object({
  personId: z.string(),
});

/** Respuesta de POST /pets: solo nos interesa el id de la mascota creada. */
const petResponseSchema = z.object({
  id: z.string(),
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

/** Respuesta de GET /zones: listado publico de zonas (mapa). */
const zonesResponseSchema = z.object({
  zones: z.array(publicZoneSchema),
});

/** Respuesta de GET /needs: listado publico de necesidades por zona (mapa). */
const needsResponseSchema = z.object({
  needs: z.array(publicNeedSchema),
});

/** Respuesta de POST /persons/mine-by-channel: los registros del dueno (sin contacto). */
const myPersonsResponseSchema = z.object({
  persons: z.array(ownedPersonSchema),
});

/** Respuesta de POST /reunion/request: el estado de la solicitud (sin contacto). */
const reunionRequestResponseSchema = z.object({
  status: z.enum(["requested", "minor", "failed"]),
});

/** Respuesta de POST /reunion/consent: el estado del consentimiento (sin contacto). */
const reunionConsentResponseSchema = z.object({
  status: z.enum(["not_found", "rejected", "exchanged", "accepted_waiting"]),
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

  async registerPet(
    pet: unknown,
    channel: ChannelIdentity,
  ): Promise<{ readonly id: string }> {
    const res = await fetch(`${this.#baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // El backend resuelve el vinculo usuario<->canal a partir de `channel` y crea
      // la mascota ligada a ese contacto. El cuerpo es el PetCreate + el canal.
      body: JSON.stringify({ ...(pet as Record<string, unknown>), channel }),
    });

    if (!res.ok) {
      throw new Error(`POST /pets fallo con estado ${res.status}`);
    }

    const json: unknown = await res.json();
    const parsed = petResponseSchema.parse(json);
    return { id: parsed.id };
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

  async markFoundByChannel(
    personId: string,
    channel: ChannelIdentity,
  ): Promise<void> {
    const res = await fetch(
      `${this.#baseUrl}/persons/${encodeURIComponent(personId)}/found-by-channel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        // El backend autoriza con el vinculo del canal; no enviamos contact_id.
        body: JSON.stringify({
          plataforma: channel.plataforma,
          chatId: channel.chatId,
        }),
      },
    );

    // 200: autorizado y marcado. 403: el canal no es dueno (fallo esperado).
    if (res.status === 403) {
      throw new NotOwnerError();
    }
    if (!res.ok) {
      throw new Error(
        `POST /persons/:id/found-by-channel fallo con estado ${res.status}`,
      );
    }
  }

  async listMyPersons(channel: ChannelIdentity): Promise<readonly OwnedPerson[]> {
    const res = await fetch(`${this.#baseUrl}/persons/mine-by-channel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // El backend autoriza por la propiedad del canal; no enviamos contact_id.
      body: JSON.stringify({
        plataforma: channel.plataforma,
        chatId: channel.chatId,
      }),
    });
    if (!res.ok) {
      throw new Error(`POST /persons/mine-by-channel fallo con estado ${res.status}`);
    }
    const json: unknown = await res.json();
    // Validamos como vista del dueno: confirma que NO viene contact_id.
    return myPersonsResponseSchema.parse(json).persons;
  }

  async requestReunion(
    personId: string,
    channel: ChannelIdentity,
  ): Promise<ReunionRequestStatus> {
    const res = await fetch(`${this.#baseUrl}/reunion/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // El backend correlaciona al buscador por la propiedad del canal; no enviamos
      // contact_id. La persona elegida va por su id publico (no es PII de contacto).
      body: JSON.stringify({
        channel: { plataforma: channel.plataforma, chatId: channel.chatId },
        personId,
      }),
    });
    if (!res.ok) {
      throw new Error(`POST /reunion/request fallo con estado ${res.status}`);
    }
    const json: unknown = await res.json();
    return reunionRequestResponseSchema.parse(json).status;
  }

  async reunionConsent(
    decision: ReunionDecision,
    channel: ChannelIdentity,
  ): Promise<ReunionConsentStatus> {
    const res = await fetch(`${this.#baseUrl}/reunion/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // El backend correlaciona la solicitud pendiente por la propiedad del canal del
      // registrante; no enviamos contact_id. El contacto, si ambos aceptan, llega
      // despues por notificacion, nunca en esta respuesta (guardrail #1).
      body: JSON.stringify({
        channel: { plataforma: channel.plataforma, chatId: channel.chatId },
        decision,
      }),
    });
    if (!res.ok) {
      throw new Error(`POST /reunion/consent fallo con estado ${res.status}`);
    }
    const json: unknown = await res.json();
    return reunionConsentResponseSchema.parse(json).status;
  }

  async searchPersons(
    query: string,
    zona?: string,
    channel?: ChannelIdentity,
    descripcion?: string,
    es_menor?: boolean,
  ): Promise<readonly PublicPersonResult[]> {
    const body: Record<string, unknown> = {
      tipo: "persona",
    };
    // El nombre es OPCIONAL: la busqueda guiada permite omitirlo y buscar solo por
    // zona o senas. Solo lo enviamos si trae texto (el backend valida min(1) y
    // re-normaliza el score sobre los campos provistos).
    if (query.trim().length > 0) {
      body["target_nombre"] = query;
    }
    if (zona !== undefined && zona.length > 0) {
      body["zona"] = zona;
    }
    // Las senas viajan como `target_descripcion`: el backend las usa en la query de
    // matching (campo ponderado) para un parecido mas afinado.
    if (descripcion !== undefined && descripcion.length > 0) {
      body["target_descripcion"] = descripcion;
    }
    // Pasamos el canal para que el backend vincule al buscador y pueda
    // notificarle despues si aparece una coincidencia (Capa 2: reunir familias).
    if (channel !== undefined) {
      body["channel"] = channel;
    }
    // es_menor: respuesta EXPLICITA del usuario al paso 'menor' (R2-4a).
    // Solo se envia cuando el usuario respondio; el backend confirma server-side
    // de forma conservadora (judgment-r3 item 5).
    if (es_menor !== undefined) {
      body["es_menor"] = es_menor;
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

  async listZones(): Promise<readonly PublicZone[]> {
    const res = await fetch(`${this.#baseUrl}/zones`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`GET /zones fallo con estado ${res.status}`);
    }

    const json: unknown = await res.json();
    // Validamos la vista publica (sin contacto ni identidad interna) antes de usarla.
    const parsed = zonesResponseSchema.parse(json);
    return parsed.zones;
  }

  async listNeeds(): Promise<readonly PublicNeed[]> {
    const res = await fetch(`${this.#baseUrl}/needs`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`GET /needs fallo con estado ${res.status}`);
    }

    const json: unknown = await res.json();
    const parsed = needsResponseSchema.parse(json);
    return parsed.needs;
  }

  // ── Relay methods (F4, design v3) ─────────────────────────────────────────

  /** Schema for GET /relay/active response. */
  static readonly #activeRelaySchema = z
    .object({
      relayId: z.string(),
      otherChannelId: z.string(),
    })
    .nullable();

  async getActiveRelay(channel: ChannelIdentity): Promise<ActiveRelayInfo | null> {
    try {
      const res = await fetch(`${this.#baseUrl}/relay/active`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plataforma: channel.plataforma,
          chatId: channel.chatId,
        }),
      });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      return HttpBackendClient.#activeRelaySchema.parse(json);
    } catch {
      // Network error or parse failure: treat as no relay (safe default).
      return null;
    }
  }

  async forwardRelayMessage(
    relayId: string,
    text: string,
    channel: ChannelIdentity,
  ): Promise<void> {
    const res = await fetch(
      `${this.#baseUrl}/relay/${encodeURIComponent(relayId)}/forward`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          channel: { plataforma: channel.plataforma, chatId: channel.chatId },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`POST /relay/:id/forward fallo con estado ${res.status}`);
    }
  }

  async closeRelay(relayId: string, channel: ChannelIdentity): Promise<void> {
    const res = await fetch(
      `${this.#baseUrl}/relay/${encodeURIComponent(relayId)}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: { plataforma: channel.plataforma, chatId: channel.chatId },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`POST /relay/:id/close fallo con estado ${res.status}`);
    }
  }

  async respondConsent(
    consentId: string,
    decision: "aceptado" | "rechazado",
    channel: ChannelIdentity,
  ): Promise<void> {
    const res = await fetch(
      `${this.#baseUrl}/consent/${encodeURIComponent(consentId)}/respond`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          channel: { plataforma: channel.plataforma, chatId: channel.chatId },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`POST /consent/:id/respond fallo con estado ${res.status}`);
    }
  }

  async requestRelayReveal(relayId: string, channel: ChannelIdentity): Promise<void> {
    const res = await fetch(
      `${this.#baseUrl}/relay/${encodeURIComponent(relayId)}/reveal`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: { plataforma: channel.plataforma, chatId: channel.chatId },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`POST /relay/:id/reveal fallo con estado ${res.status}`);
    }
  }

  async sweepConsent(): Promise<void> {
    const res = await fetch(`${this.#baseUrl}/consent/sweep`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`POST /consent/sweep fallo con estado ${res.status}`);
    }
  }

  /** Schema for POST /rescatado response. */
  static readonly #rescatadoResponseSchema = z.object({
    outcome: z.enum(["queued", "human_review", "consent_pending", "operator_queue"]),
  });

  async reportRescatado(
    personId: string,
    channel: ChannelIdentity,
  ): Promise<RescatadoStatus> {
    try {
      const res = await fetch(`${this.#baseUrl}/rescatado`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Solo enviamos el id publico de la persona y el canal del buscador.
        // NUNCA contact_id: el backend resuelve el vinculo por canal (guardrail #1).
        body: JSON.stringify({
          personId,
          channel: { plataforma: channel.plataforma, chatId: channel.chatId },
        }),
      });
      if (!res.ok) {
        return "failed";
      }
      const json: unknown = await res.json();
      const parsed = HttpBackendClient.#rescatadoResponseSchema.safeParse(json);
      if (!parsed.success) {
        return "failed";
      }
      return parsed.data.outcome;
    } catch {
      return "failed";
    }
  }
}
