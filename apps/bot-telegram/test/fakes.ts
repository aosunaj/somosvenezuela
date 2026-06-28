import type {
  BackendClient,
  PublicPersonResult,
  TelegramTransport,
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

export interface SearchCall {
  readonly query: string;
  readonly zona?: string;
}

interface FakeBackendOptions {
  /** Resultados que devolvera `searchPersons`. */
  readonly searchResults?: readonly PublicPersonResult[];
  /** Si true, `createPerson` lanza (para probar manejo de errores). */
  readonly failCreate?: boolean;
  /** Si true, `searchPersons` lanza. */
  readonly failSearch?: boolean;
  /** Id que devuelve `createPerson` cuando no falla. */
  readonly createdId?: string;
}

export class FakeBackend implements BackendClient {
  readonly createCalls: CreatePersonCall[] = [];
  readonly searchCalls: SearchCall[] = [];
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

  async searchPersons(
    query: string,
    zona?: string,
  ): Promise<readonly PublicPersonResult[]> {
    this.searchCalls.push(zona === undefined ? { query } : { query, zona });
    if (this.#opts.failSearch === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.searchResults ?? [];
  }
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
