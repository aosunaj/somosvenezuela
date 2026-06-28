import type {
  BackendClient,
  PublicPersonResult,
  WhatsAppTransport,
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
