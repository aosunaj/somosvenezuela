import type { OwnedPerson, PublicNeed, PublicZone } from "core";
import {
  NotOwnerError,
  type ActiveRelayInfo,
  type BackendClient,
  type ChannelIdentity,
  type ForwardRelayCall as ForwardRelayCallType,
  type PublicPersonResult,
  type PublicPetResult,
  type RescatadoStatus,
  type ReunionConsentStatus,
  type ReunionDecision,
  type ReunionRequestStatus,
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

export interface ListMyPersonsCall {
  readonly channel: ChannelIdentity;
}

export interface SearchCall {
  readonly query: string;
  readonly zona?: string;
  readonly channel?: ChannelIdentity;
  readonly descripcion?: string;
  /** es_menor flag forwarded from the machine (R2-4a / judgment-r3 item 5). */
  readonly es_menor?: boolean;
}

export interface RequestReunionCall {
  readonly personId: string;
  readonly channel: ChannelIdentity;
}

export interface ReunionConsentCall {
  readonly decision: ReunionDecision;
  readonly channel: ChannelIdentity;
}

export interface CloseRelayCall {
  readonly relayId: string;
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
  /** Registros propios que devuelve `listMyPersons` (vista del dueno, sin contacto). */
  readonly myPersonsResults?: readonly OwnedPerson[];
  /** Si true, `listMyPersons` lanza un error generico (fallo transitorio). */
  readonly failListMyPersons?: boolean;
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
  /** Relay activo que devuelve `getActiveRelay` (null = sin relay). */
  readonly activeRelay?: ActiveRelayInfo | null;
  /** Si true, `closeRelay` lanza (para probar el fallo). */
  readonly closeRelayFails?: boolean;
  /** Estado que devuelve `reportRescatado` (por defecto 'queued'). */
  readonly reportRescatadoStatus?: RescatadoStatus;
  /** Si true, `reportRescatado` lanza un error generico. */
  readonly failReportRescatado?: boolean;
}

/** Captura de una llamada a reportRescatado. */
export interface ReportRescatadoCall {
  readonly personId: string;
  readonly channel: ChannelIdentity;
}

export class FakeBackend implements BackendClient {
  readonly createCalls: CreatePersonCall[] = [];
  readonly registerCalls: RegisterCall[] = [];
  readonly registerPetCalls: RegisterPetCall[] = [];
  readonly deleteCalls: DeleteCall[] = [];
  readonly markFoundCalls: MarkFoundCall[] = [];
  readonly listMyPersonsCalls: ListMyPersonsCall[] = [];
  readonly searchCalls: SearchCall[] = [];
  readonly petSearchCalls: SearchCall[] = [];
  readonly requestReunionCalls: RequestReunionCall[] = [];
  readonly reunionConsentCalls: ReunionConsentCall[] = [];
  readonly forwardRelayMessageCalls: ForwardRelayCallType[] = [];
  readonly closeRelayCalls: CloseRelayCall[] = [];
  readonly sweepConsentCalls: number[] = [];
  readonly reportRescatadoCalls: ReportRescatadoCall[] = [];
  /** Cuenta cuantas veces se llamo a cada lectura de mapa (sin argumentos). */
  listZonesCalls = 0;
  listNeedsCalls = 0;
  getActiveRelayCalls = 0;
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

  async listMyPersons(channel: ChannelIdentity): Promise<readonly OwnedPerson[]> {
    this.listMyPersonsCalls.push({ channel });
    if (this.#opts.failListMyPersons === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.myPersonsResults ?? [];
  }

  async searchPersons(
    query: string,
    zona?: string,
    channel?: ChannelIdentity,
    descripcion?: string,
    es_menor?: boolean,
  ): Promise<readonly PublicPersonResult[]> {
    this.searchCalls.push(buildSearchCall(query, zona, channel, descripcion, es_menor));
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

  async getActiveRelay(channel: ChannelIdentity): Promise<ActiveRelayInfo | null> {
    void channel;
    this.getActiveRelayCalls += 1;
    return this.#opts.activeRelay ?? null;
  }

  async forwardRelayMessage(
    relayId: string,
    text: string,
    channel: ChannelIdentity,
  ): Promise<void> {
    this.forwardRelayMessageCalls.push({ relayId, text, channel });
  }

  async closeRelay(relayId: string, channel: ChannelIdentity): Promise<void> {
    this.closeRelayCalls.push({ relayId, channel });
    if (this.#opts.closeRelayFails === true) {
      throw new Error("backend caido (sintetico)");
    }
  }

  async sweepConsent(): Promise<void> {
    this.sweepConsentCalls.push(1);
  }

  async respondConsent(
    consentId: string,
    decision: "aceptado" | "rechazado",
    channel: ChannelIdentity,
  ): Promise<void> {
    void consentId;
    void decision;
    void channel;
  }

  async requestRelayReveal(relayId: string, channel: ChannelIdentity): Promise<void> {
    void relayId;
    void channel;
  }

  async reportRescatado(personId: string, channel: ChannelIdentity): Promise<RescatadoStatus> {
    this.reportRescatadoCalls.push({ personId, channel });
    if (this.#opts.failReportRescatado === true) {
      throw new Error("backend caido (sintetico)");
    }
    return this.#opts.reportRescatadoStatus ?? "queued";
  }
}

/** Construye un SearchCall omitiendo claves opcionales ausentes (exactOptional). */
function buildSearchCall(
  query: string,
  zona?: string,
  channel?: ChannelIdentity,
  descripcion?: string,
  es_menor?: boolean,
): SearchCall {
  const call: {
    query: string;
    zona?: string;
    channel?: ChannelIdentity;
    descripcion?: string;
    es_menor?: boolean;
  } = { query };
  if (zona !== undefined) call.zona = zona;
  if (channel !== undefined) call.channel = channel;
  if (descripcion !== undefined) call.descripcion = descripcion;
  if (es_menor !== undefined) call.es_menor = es_menor;
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

/** Registro propio sintetico (vista del dueno, sin contacto) para marcar/borrar. */
export function ownedPersonFixture(overrides: Partial<OwnedPerson> = {}): OwnedPerson {
  return {
    id: SYNTH_PERSON_ID,
    nombre: "Persona Sintetica",
    apellidos: null,
    zona: "Zona Norte",
    estado: "desaparecida",
    ...overrides,
  };
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
