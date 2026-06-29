import type { PublicNeed, PublicZone } from "core";
import {
  NotOwnerError,
  type BackendClient,
  type ChannelIdentity,
  type PublicPersonResult,
  type PublicPetResult,
  type ReunionConsentStatus,
  type ReunionDecision,
  type ReunionRequestStatus,
  type WhatsAppTransport,
} from "../src/ports.js";

// Dobles en memoria para probar el adaptador SIN red ni token (espejo de los del bot
// de Telegram).
//
// - FakeTransport captura cada mensaje enviado (to, texto, botones) para poder afirmar
//   QUE se envio y verificar que NUNCA sale dato de contacto.
// - FakeBackend captura el ultimo `createPerson` recibido y devuelve resultados de
//   busqueda programables; puede configurarse para LANZAR (probar errores).

// ── Identificadores sinteticos (jamas PII real, guardrail #1) ────────────────

export const SYNTH_PERSON_ID = "11111111-1111-4111-8111-111111111111";
export const SYNTH_CONTACT_ID = "22222222-2222-4222-8222-222222222222";

/** wa_id sintetico del remitente (numero internacional sin `+`, sin formato venezolano). */
export const SYNTH_WA_ID = "10000000000";

// ── Transporte falso ─────────────────────────────────────────────────────────

export interface SentMessage {
  readonly to: string;
  readonly text: string;
  readonly buttons?: readonly (readonly string[])[];
}

export class FakeTransport implements WhatsAppTransport {
  readonly sent: SentMessage[] = [];

  async sendMessage(
    to: string,
    text: string,
    buttons?: readonly (readonly string[])[],
  ): Promise<void> {
    this.sent.push(buttons === undefined ? { to, text } : { to, text, buttons });
  }

  /** Todo el texto enviado, concatenado (util para asserts de privacidad). */
  allText(): string {
    return this.sent.map((m) => m.text).join("\n");
  }

  /** Solo los mensajes dirigidos a un destinatario concreto. */
  forRecipient(to: string): SentMessage[] {
    return this.sent.filter((m) => m.to === to);
  }
}

// ── Backend falso ─────────────────────────────────────────────────────────────

export interface CreatePersonCall {
  readonly data: unknown;
}

export interface RegisterCall {
  readonly person: unknown;
  readonly channel: ChannelIdentity;
}

export interface RegisterPetCall {
  readonly pet: unknown;
  readonly channel: ChannelIdentity;
}

export interface DeleteCall {
  readonly personId: string;
  readonly channel: ChannelIdentity;
}

export interface MarkFoundCall {
  readonly personId: string;
  readonly channel: ChannelIdentity;
}

export interface SearchCall {
  readonly query: string;
  readonly zona?: string;
  readonly channel?: ChannelIdentity;
  readonly descripcion?: string;
}

export interface RequestReunionCall {
  readonly personId: string;
  readonly channel: ChannelIdentity;
}

export interface ReunionConsentCall {
  readonly decision: ReunionDecision;
  readonly channel: ChannelIdentity;
}

interface FakeBackendOptions {
  /** Resultados que devolvera `searchPersons`. */
  readonly searchResults?: readonly PublicPersonResult[];
  /** Resultados que devolvera `searchPets`. */
  readonly petResults?: readonly PublicPetResult[];
  /** Zonas que devolvera `listZones` (mapa, lectura publica). */
  readonly zoneResults?: readonly PublicZone[];
  /** Necesidades que devolvera `listNeeds` (mapa, lectura publica). */
  readonly needResults?: readonly PublicNeed[];
  /** Si true, `createPerson`/`registerPerson` lanzan (para probar errores). */
  readonly failCreate?: boolean;
  /** Si true, `searchPersons` lanza. */
  readonly failSearch?: boolean;
  /** Si true, `searchPets` lanza. */
  readonly failSearchPets?: boolean;
  /** Si true, `listZones` lanza. */
  readonly failListZones?: boolean;
  /** Si true, `listNeeds` lanza. */
  readonly failListNeeds?: boolean;
  /** Si true, `deleteByChannel` lanza NotOwnerError (403: no es el dueno). */
  readonly deleteNotOwner?: boolean;
  /** Si true, `deleteByChannel` lanza un error generico (fallo transitorio). */
  readonly failDelete?: boolean;
  /** Si true, `markFoundByChannel` lanza NotOwnerError (403: no es el dueno). */
  readonly markFoundNotOwner?: boolean;
  /** Si true, `markFoundByChannel` lanza un error generico (fallo transitorio). */
  readonly failMarkFound?: boolean;
  /** Estado que devuelve `requestReunion` (por defecto 'requested'). */
  readonly reunionRequestStatus?: ReunionRequestStatus;
  /** Estado que devuelve `reunionConsent` (por defecto 'accepted_waiting'). */
  readonly reunionConsentStatus?: ReunionConsentStatus;
  /** Si true, `requestReunion` lanza (para probar el fallback 'failed'). */
  readonly failRequestReunion?: boolean;
  /** Si true, `reunionConsent` lanza (para probar el mensaje generico). */
  readonly failReunionConsent?: boolean;
  /** Id que devuelve `createPerson`/`registerPerson` cuando no falla. */
  readonly createdId?: string;
}

export class FakeBackend implements BackendClient {
  readonly createCalls: CreatePersonCall[] = [];
  readonly registerCalls: RegisterCall[] = [];
  readonly registerPetCalls: RegisterPetCall[] = [];
  readonly deleteCalls: DeleteCall[] = [];
  readonly markFoundCalls: MarkFoundCall[] = [];
  readonly searchCalls: SearchCall[] = [];
  readonly petSearchCalls: SearchCall[] = [];
  readonly requestReunionCalls: RequestReunionCall[] = [];
  readonly reunionConsentCalls: ReunionConsentCall[] = [];
  /** Cuenta cuantas veces se llamo a cada lectura de mapa (sin argumentos). */
  listZonesCalls = 0;
  listNeedsCalls = 0;
  readonly #opts: FakeBackendOptions;

  constructor(opts: FakeBackendOptions = {}) {
    this.#opts = opts;
  }

  async createPerson(data: unknown): Promise<{ readonly id: string }> {
    this.createCalls.push({ data });
    if (this.#opts.failCreate === true) {
      throw new Error("backend caido (sintetico)");
    }
    return { id: this.#opts.createdId ?? SYNTH_PERSON_ID };
  }

  async registerPerson(
    person: unknown,
    channel: ChannelIdentity,
  ): Promise<{ readonly id: string }> {
    this.registerCalls.push({ person, channel });
    if (this.#opts.failCreate === true) {
      throw new Error("backend caido (sintetico)");
    }
    return { id: this.#opts.createdId ?? SYNTH_PERSON_ID };
  }

  async registerPet(
    pet: unknown,
    channel: ChannelIdentity,
  ): Promise<{ readonly id: string }> {
    this.registerPetCalls.push({ pet, channel });
    if (this.#opts.failCreate === true) {
      throw new Error("backend caido (sintetico)");
    }
    return { id: this.#opts.createdId ?? SYNTH_PERSON_ID };
  }

  async deleteByChannel(personId: string, channel: ChannelIdentity): Promise<void> {
    this.deleteCalls.push({ personId, channel });
    if (this.#opts.deleteNotOwner === true) {
      throw new NotOwnerError();
    }
    if (this.#opts.failDelete === true) {
      throw new Error("backend caido (sintetico)");
    }
  }

  async markFoundByChannel(personId: string, channel: ChannelIdentity): Promise<void> {
    this.markFoundCalls.push({ personId, channel });
    if (this.#opts.markFoundNotOwner === true) {
      throw new NotOwnerError();
    }
    if (this.#opts.failMarkFound === true) {
      throw new Error("backend caido (sintetico)");
    }
  }

  async searchPersons(
    query: string,
    zona?: string,
    channel?: ChannelIdentity,
    descripcion?: string,
  ): Promise<readonly PublicPersonResult[]> {
    this.searchCalls.push(buildSearchCall(query, zona, channel, descripcion));
    if (this.#opts.failSearch === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.searchResults ?? [];
  }

  async searchPets(
    query: string,
    zona?: string,
  ): Promise<readonly PublicPetResult[]> {
    this.petSearchCalls.push(buildSearchCall(query, zona));
    if (this.#opts.failSearchPets === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.petResults ?? [];
  }

  async requestReunion(
    personId: string,
    channel: ChannelIdentity,
  ): Promise<ReunionRequestStatus> {
    this.requestReunionCalls.push({ personId, channel });
    if (this.#opts.failRequestReunion === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.reunionRequestStatus ?? "requested";
  }

  async reunionConsent(
    decision: ReunionDecision,
    channel: ChannelIdentity,
  ): Promise<ReunionConsentStatus> {
    this.reunionConsentCalls.push({ decision, channel });
    if (this.#opts.failReunionConsent === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.reunionConsentStatus ?? "accepted_waiting";
  }

  async listZones(): Promise<readonly PublicZone[]> {
    this.listZonesCalls += 1;
    if (this.#opts.failListZones === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.zoneResults ?? [];
  }

  async listNeeds(): Promise<readonly PublicNeed[]> {
    this.listNeedsCalls += 1;
    if (this.#opts.failListNeeds === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.needResults ?? [];
  }
}

/** Construye un SearchCall omitiendo claves opcionales ausentes (exactOptional). */
function buildSearchCall(
  query: string,
  zona?: string,
  channel?: ChannelIdentity,
  descripcion?: string,
): SearchCall {
  const call: {
    query: string;
    zona?: string;
    channel?: ChannelIdentity;
    descripcion?: string;
  } = { query };
  if (zona !== undefined) call.zona = zona;
  if (channel !== undefined) call.channel = channel;
  if (descripcion !== undefined) call.descripcion = descripcion;
  return call;
}

// ── Helpers de construccion ──────────────────────────────────────────────────

/**
 * Payload de webhook de WhatsApp minimo con un unico mensaje de texto, ya con la forma
 * cruda esperada (entry[].changes[].value.messages[]).
 */
export function textUpdate(waId: string, text: string): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "ENTRY_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "10000000000",
                phone_number_id: "PHONE_NUMBER_ID",
              },
              messages: [
                {
                  from: waId,
                  id: "wamid.SYNTHETIC",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/**
 * Construye una vista publica sintetica para resultados de busqueda. NO incluye
 * contact_id (publicPerson lo omite). Acepta campos contaminantes via `extra` SOLO
 * para el test de privacidad (simula un backend que filtra de mas).
 */
export function publicPersonFixture(
  overrides: Record<string, unknown> = {},
): PublicPersonResult {
  const base = {
    id: SYNTH_PERSON_ID,
    nombre: "Persona Sintetica",
    apellidos: null,
    edad: null,
    zona: "Zona Norte",
    descripcion: null,
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: "2026-06-28T00:00:00.000Z",
    updated_at: "2026-06-28T00:00:00.000Z",
    ...overrides,
  };
  // El cast es seguro para los tests: el fake del backend no valida el schema,
  // simulamos exactamente lo que llegaria por la interfaz.
  return base as unknown as PublicPersonResult;
}

/**
 * Construye una vista publica sintetica de MASCOTA para resultados de busqueda.
 * NO incluye contact_id (publicPet lo omite). Acepta campos contaminantes via
 * `overrides` SOLO para el test de privacidad.
 */
export function publicPetFixture(
  overrides: Record<string, unknown> = {},
): PublicPetResult {
  const base = {
    id: SYNTH_PERSON_ID,
    nombre: "Mascota Sintetica",
    tipo: "perro",
    raza: null,
    zona: "Zona Norte",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: "2026-06-28T00:00:00.000Z",
    updated_at: "2026-06-28T00:00:00.000Z",
    ...overrides,
  };
  return base as unknown as PublicPetResult;
}

/** Zona publica sintetica (mapa, sin contacto ni identidad interna). */
export function publicZoneFixture(overrides: Record<string, unknown> = {}): PublicZone {
  const base = {
    id: SYNTH_PERSON_ID,
    nombre: "Plaza Sintetica",
    lat: null,
    lng: null,
    estado: "activa",
    updated_at: "2026-06-28T00:00:00.000Z",
    ...overrides,
  };
  return base as unknown as PublicZone;
}

/** Necesidad publica sintetica por zona (mapa, sin contacto). */
export function publicNeedFixture(overrides: Record<string, unknown> = {}): PublicNeed {
  const base = {
    id: SYNTH_PERSON_ID,
    zone_id: SYNTH_CONTACT_ID,
    tipo: "agua",
    urgencia: "alta",
    descripcion: "Falta agua potable",
    updated_at: "2026-06-28T00:00:00.000Z",
    ...overrides,
  };
  return base as unknown as PublicNeed;
}
