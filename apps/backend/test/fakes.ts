import type {
  OwnedPerson,
  Person,
  PersonCreate,
  PublicPerson,
  Search,
  SearchCreate,
} from "core";
import type {
  ChannelRepo,
  ChannelTransport,
  MatchCreate,
  MatchRepo,
  PersonRepo,
  PersonStateAuditRepo,
  PersonStateChangeInput,
  PublicPersonResult,
  SearchRepo,
} from "db";

// Repos FALSOS para testear la API sin BD real (no hay service_role en el test).
// Capturan lo que reciben y devuelven filas controladas, para verificar el
// contrato (defaults, privacidad, auth) por la respuesta HTTP.
//
// Todos los datos son SINTETICOS (guardrail #1: nada de PII real en tests).

/** Contacto sintetico; debe NUNCA aparecer en respuestas publicas. */
export const SYNTH_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
export const SYNTH_PERSON_ID = "a0000000-0000-4000-8000-000000000001";
export const SYNTH_SEARCH_ID = "d0000000-0000-4000-8000-000000000001";

/** Registro completo de persona (interno): incluye contact_id, que el repo real devolveria. */
function fakePerson(input: PersonCreate): Person {
  return {
    id: SYNTH_PERSON_ID,
    nombre: input.nombre,
    apellidos: input.apellidos ?? null,
    edad: input.edad ?? null,
    zona: input.zona ?? null,
    descripcion: input.descripcion ?? null,
    foto_url: input.foto_url ?? null,
    // Defaults del dominio: todo nace desaparecida/sin_verificar (guardrails #3/#4).
    estado: "desaparecida",
    fuente: input.fuente ?? "propia",
    verificacion: "sin_verificar",
    // Campo SENSIBLE: presente en el registro interno, jamas en la respuesta publica.
    contact_id: input.contact_id ?? SYNTH_CONTACT_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

/** Resultado publico de busqueda (sin contact_id) con score. */
function fakeSearchResult(score: number): PublicPersonResult {
  return {
    id: SYNTH_PERSON_ID,
    nombre: "Persona Sintetica",
    apellidos: "Apellido Ficticio",
    edad: 30,
    zona: "Zona Sintetica Norte",
    descripcion: "Datos de prueba",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    score,
  };
}

/** Vista del dueno sintetica (sin contacto): lo que devolveria listByContact. */
function fakeOwnedPerson(): OwnedPerson {
  return {
    id: SYNTH_PERSON_ID,
    nombre: "Persona Sintetica",
    apellidos: "Apellido Ficticio",
    zona: "Zona Sintetica Norte",
    estado: "desaparecida",
  };
}

/** Registros de lo que recibieron los repos, para aserciones. */
export interface RepoCalls {
  personCreated: PersonCreate[];
  searchCreated: SearchCreate[];
  removedIds: string[];
  markedFoundIds: string[];
  listedByContactIds: string[];
  searchQueries: Array<{ query: string; zona?: string }>;
  matchCreated: MatchCreate[];
  stateAudited: PersonStateChangeInput[];
}

export function makeRepoCalls(): RepoCalls {
  return {
    personCreated: [],
    searchCreated: [],
    removedIds: [],
    markedFoundIds: [],
    listedByContactIds: [],
    searchQueries: [],
    matchCreated: [],
    stateAudited: [],
  };
}

/** Fake PersonStateAuditRepo: captura las filas de auditoria de estado (guardrail #8). */
export function makeFakePersonStateAuditRepo(calls: RepoCalls): PersonStateAuditRepo {
  return {
    async record(input) {
      calls.stateAudited.push(input);
    },
  };
}

/** Fake PersonRepo: devuelve el registro completo (con contact_id) en create. */
export function makeFakePersonRepo(calls: RepoCalls): PersonRepo {
  const publicPerson = (input: PersonCreate): PublicPerson => {
    const { contact_id: _drop, ...rest } = fakePerson(input);
    void _drop;
    return rest;
  };
  return {
    async create(input) {
      calls.personCreated.push(input);
      return fakePerson(input);
    },
    async listPublic() {
      return [publicPerson({ nombre: "Persona Sintetica" })];
    },
    async getPublic() {
      return publicPerson({ nombre: "Persona Sintetica" });
    },
    async searchPersonsPublic(query, zona) {
      calls.searchQueries.push(zona === undefined ? { query } : { query, zona });
      return [fakeSearchResult(0.91), fakeSearchResult(0.42)];
    },
    async listByContact(contactId) {
      calls.listedByContactIds.push(contactId);
      return [fakeOwnedPerson()];
    },
    async remove(id) {
      calls.removedIds.push(id);
    },
    async markFound(id) {
      calls.markedFoundIds.push(id);
    },
  };
}

/** Fake SearchRepo: devuelve el registro completo (con buscador_contact_id) en create. */
export function makeFakeSearchRepo(calls: RepoCalls): SearchRepo {
  return {
    async create(input) {
      calls.searchCreated.push(input);
      const search: Search = {
        id: SYNTH_SEARCH_ID,
        tipo: input.tipo,
        target_nombre: input.target_nombre ?? null,
        target_descripcion: input.target_descripcion ?? null,
        zona: input.zona ?? null,
        // SENSIBLE: presente en el registro interno; nunca en la respuesta publica.
        buscador_contact_id: input.buscador_contact_id ?? SYNTH_CONTACT_ID,
        created_at: "2026-01-01T00:00:00.000Z",
      };
      return search;
    },
    async getById() {
      return null;
    },
  };
}

/**
 * Fake MatchRepo: captura los matches que crearia el motor (para aserciones) y
 * devuelve respuestas vacias en los listados. Las rutas de revision se prueban en
 * matches.test.ts con un fake dedicado; aqui solo cubrimos el disparo desde /searches.
 */
export function makeFakeMatchRepo(calls: RepoCalls): MatchRepo {
  return {
    async create(input) {
      calls.matchCreated.push(input);
      return {
        id: "b0000000-0000-4000-8000-000000000001",
        search_id: input.search_id,
        person_id: input.person_id ?? null,
        pet_id: input.pet_id ?? null,
        score: input.score,
        metodo: input.metodo,
        estado_revision: "propuesto",
        revisado_por: null,
        created_at: "2026-01-01T00:00:00.000Z",
      };
    },
    async listPendingWithContext() {
      return [];
    },
    async getById() {
      return null;
    },
    async setEstadoRevision() {
      /* no-op */
    },
    async getConfirmContext() {
      return null;
    },
  };
}

/** Fake ChannelRepo: solo expone la direccion de transporte (sin contact_id). */
export function makeFakeChannelRepo(): ChannelRepo {
  return {
    async create() {
      throw new Error("no usado en estos tests");
    },
    async listByContact() {
      return [];
    },
    async getTransport(): Promise<ChannelTransport | null> {
      return null;
    },
    async remove() {
      /* no-op */
    },
  };
}
