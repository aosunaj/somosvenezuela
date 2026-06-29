import {
  NotOwnerError,
  type BackendClient,
  type ChannelIdentity,
  type PublicPersonResult,
  type PublicPetResult,
  type TelegramTransport,
} from "../src/ports.js";

// Dobles en memoria para probar el adaptador SIN red ni token.
//
// - FakeTransport captura cada mensaje enviado (chatId, texto, botones) para
//   poder afirmar QUE se envio y verificar que NUNCA sale dato de contacto.
// - FakeBackend captura el ultimo `createPerson` recibido y devuelve resultados
//   de busqueda programables; puede configurarse para LANZAR (probar errores).

// ── Identificadores sinteticos (jamas PII real, guardrail #1) ────────────────

export const SYNTH_PERSON_ID = "11111111-1111-4111-8111-111111111111";
export const SYNTH_CONTACT_ID = "22222222-2222-4222-8222-222222222222";

// ── Transporte falso ─────────────────────────────────────────────────────────

export interface SentMessage {
  readonly chatId: number;
  readonly text: string;
  readonly buttons?: readonly (readonly string[])[];
}

export class FakeTransport implements TelegramTransport {
  readonly sent: SentMessage[] = [];

  async sendMessage(
    chatId: number,
    text: string,
    buttons?: readonly (readonly string[])[],
  ): Promise<void> {
    this.sent.push(buttons === undefined ? { chatId, text } : { chatId, text, buttons });
  }

  /** Todo el texto enviado, concatenado (util para asserts de privacidad). */
  allText(): string {
    return this.sent.map((m) => m.text).join("\n");
  }

  /** Solo los mensajes dirigidos a un chat concreto. */
  forChat(chatId: number): SentMessage[] {
    return this.sent.filter((m) => m.chatId === chatId);
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

export interface DeleteCall {
  readonly personId: string;
  readonly channel: ChannelIdentity;
}

export interface SearchCall {
  readonly query: string;
  readonly zona?: string;
  readonly channel?: ChannelIdentity;
}

interface FakeBackendOptions {
  /** Resultados que devolvera `searchPersons`. */
  readonly searchResults?: readonly PublicPersonResult[];
  /** Resultados que devolvera `searchPets`. */
  readonly petResults?: readonly PublicPetResult[];
  /** Si true, `createPerson`/`registerPerson` lanzan (para probar errores). */
  readonly failCreate?: boolean;
  /** Si true, `searchPersons` lanza. */
  readonly failSearch?: boolean;
  /** Si true, `searchPets` lanza. */
  readonly failSearchPets?: boolean;
  /** Si true, `deleteByChannel` lanza NotOwnerError (403: no es el dueno). */
  readonly deleteNotOwner?: boolean;
  /** Si true, `deleteByChannel` lanza un error generico (fallo transitorio). */
  readonly failDelete?: boolean;
  /** Id que devuelve `createPerson`/`registerPerson` cuando no falla. */
  readonly createdId?: string;
}

export class FakeBackend implements BackendClient {
  readonly createCalls: CreatePersonCall[] = [];
  readonly registerCalls: RegisterCall[] = [];
  readonly deleteCalls: DeleteCall[] = [];
  readonly searchCalls: SearchCall[] = [];
  readonly petSearchCalls: SearchCall[] = [];
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

  async deleteByChannel(personId: string, channel: ChannelIdentity): Promise<void> {
    this.deleteCalls.push({ personId, channel });
    if (this.#opts.deleteNotOwner === true) {
      throw new NotOwnerError();
    }
    if (this.#opts.failDelete === true) {
      throw new Error("backend caido (sintetico)");
    }
  }

  async searchPersons(
    query: string,
    zona?: string,
    channel?: ChannelIdentity,
  ): Promise<readonly PublicPersonResult[]> {
    this.searchCalls.push(buildSearchCall(query, zona, channel));
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
}

/** Construye un SearchCall omitiendo claves opcionales ausentes (exactOptional). */
function buildSearchCall(
  query: string,
  zona?: string,
  channel?: ChannelIdentity,
): SearchCall {
  const call: { query: string; zona?: string; channel?: ChannelIdentity } = { query };
  if (zona !== undefined) call.zona = zona;
  if (channel !== undefined) call.channel = channel;
  return call;
}

// ── Helpers de construccion ──────────────────────────────────────────────────

/** Update de Telegram minimo de tipo texto, ya con la forma cruda esperada. */
export function textUpdate(chatId: number, text: string, updateId = 1): unknown {
  return {
    update_id: updateId,
    message: { chat: { id: chatId }, text },
  };
}

/**
 * Construye una vista publica sintetica para resultados de busqueda. NO incluye
 * contact_id (publicPerson lo omite). Acepta campos contaminantes via `extra`
 * SOLO para el test de privacidad (simula un backend que filtra de mas).
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
