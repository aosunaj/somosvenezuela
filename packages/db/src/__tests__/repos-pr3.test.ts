import { describe, expect, it } from "vitest";
import type { DbClient } from "../client.js";
import {
  createPersonRepo,
  type PersonRepo,
} from "../repos/person.js";
import {
  createSearchRepo,
  type SearchRepo,
} from "../repos/search.js";
import {
  createRelayRepo,
  type RelayRepo,
} from "../repos/relay.js";
import {
  createAuditRepo,
  type AuditRepo,
} from "../repos/audit.js";

// Tests de repositorios nuevos de PR3 usando FAKES (sin BD real).
// Datos SINTETICOS sin PII.

// ── Fake client helpers ──────────────────────────────────────────────────────

const SYNTH_PERSON_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SYNTH_CONTACT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const SYNTH_SEARCH_ID = "cccccccc-0000-4000-8000-000000000003";
const SYNTH_RELAY_ID = "dddddddd-0000-4000-8000-000000000004";
const SYNTH_AUDIT_ID = "eeeeeeee-0000-4000-8000-000000000005";

/** Crea un fake DbClient que devuelve datos fijos en .select().from()... */
function makeFakeSelectClient(rows: unknown[]): DbClient {
  const queryBuilder = {
    select: () => queryBuilder,
    eq: () => queryBuilder,
    or: () => queryBuilder,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    limit: () => queryBuilder,
    order: () => queryBuilder,
    returns: () => queryBuilder,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  return {
    from: () => queryBuilder,
    rpc: () => queryBuilder,
  } as unknown as DbClient;
}

function makeFakeErrorClient(message: string, code?: string): DbClient {
  const queryBuilder = {
    select: () => queryBuilder,
    eq: () => queryBuilder,
    maybeSingle: () => Promise.resolve({ data: null, error: { message, code } }),
    limit: () => queryBuilder,
    order: () => queryBuilder,
    returns: () => queryBuilder,
    then: (resolve: (v: { data: null; error: { message: string } }) => unknown) =>
      resolve({ data: null, error: { message } }),
  };
  return {
    from: () => queryBuilder,
    rpc: () => queryBuilder,
  } as unknown as DbClient;
}

// ── PersonRepo: isMinorById ──────────────────────────────────────────────────

describe("PersonRepo.isMinorById (tabla base, NUNCA persons_public)", () => {
  it("persona con edad < 18 → true", async () => {
    const client = makeFakeSelectClient([
      { id: SYNTH_PERSON_ID, edad: 15, minors_row: null },
    ]);
    const repo = createPersonRepo(client);
    const result = await repo.isMinorById(SYNTH_PERSON_ID);
    expect(result).toBe(true);
  });

  it("persona con edad null → true (conservador)", async () => {
    const client = makeFakeSelectClient([
      { id: SYNTH_PERSON_ID, edad: null, minors_row: null },
    ]);
    const repo = createPersonRepo(client);
    const result = await repo.isMinorById(SYNTH_PERSON_ID);
    expect(result).toBe(true);
  });

  it("persona con edad >= 18 y sin minors → false (adulto)", async () => {
    const client = makeFakeSelectClient([
      { id: SYNTH_PERSON_ID, edad: 25, minors_row: null },
    ]);
    const repo = createPersonRepo(client);
    const result = await repo.isMinorById(SYNTH_PERSON_ID);
    expect(result).toBe(false);
  });

  it("persona con fila en minors → true (tabla minors gana sobre edad)", async () => {
    const client = makeFakeSelectClient([
      { id: SYNTH_PERSON_ID, edad: 25, minors_row: { id: "some-id" } },
    ]);
    const repo = createPersonRepo(client);
    const result = await repo.isMinorById(SYNTH_PERSON_ID);
    expect(result).toBe(true);
  });

  it("persona no encontrada → true (conservador: person_id inválido → minor gate)", async () => {
    const client = makeFakeSelectClient([]);
    const repo = createPersonRepo(client);
    const result = await repo.isMinorById("nonexistent-id");
    expect(result).toBe(true);
  });
});

// ── PersonRepo: getVerificationStatus ───────────────────────────────────────

describe("PersonRepo.getVerificationStatus (tabla base, no persons_public)", () => {
  it("persona con pregunta y hash → devuelve ambos", async () => {
    const client = makeFakeSelectClient([{
      id: SYNTH_PERSON_ID,
      verification_question: "¿Nombre de tu mascota?",
      verification_answer_hash: "$argon2id$v=19$m=65536...",
    }]);
    const repo = createPersonRepo(client);
    const result = await repo.getVerificationStatus(SYNTH_PERSON_ID);
    expect(result).not.toBeNull();
    expect(result?.hasQuestion).toBe(true);
    expect(result?.answerHash).toBe("$argon2id$v=19$m=65536...");
  });

  it("persona sin pregunta → hasQuestion=false, answerHash=null", async () => {
    const client = makeFakeSelectClient([{
      id: SYNTH_PERSON_ID,
      verification_question: null,
      verification_answer_hash: null,
    }]);
    const repo = createPersonRepo(client);
    const result = await repo.getVerificationStatus(SYNTH_PERSON_ID);
    expect(result).not.toBeNull();
    expect(result?.hasQuestion).toBe(false);
    expect(result?.answerHash).toBeNull();
  });

  it("persona no encontrada → null", async () => {
    const client = makeFakeSelectClient([]);
    const repo = createPersonRepo(client);
    const result = await repo.getVerificationStatus("nonexistent");
    expect(result).toBeNull();
  });
});

// ── SearchRepo: isMinorByContactId (multi-persona conservador) ───────────────

describe("SearchRepo.isMinorByContactId (multi-persona conservador)", () => {
  it("contacto con al menos un menor → true", async () => {
    // El contacto tiene dos personas: una adulta y una menor.
    const client = makeFakeSelectClient([
      { id: "p1", edad: 25, minors_row: null },
      { id: "p2", edad: 14, minors_row: null },
    ]);
    const repo = createSearchRepo(client);
    const result = await repo.isMinorByContactId(SYNTH_CONTACT_ID);
    expect(result).toBe(true);
  });

  it("contacto sin personas → true (conservador: ninguna persona → minor gate)", async () => {
    const client = makeFakeSelectClient([]);
    const repo = createSearchRepo(client);
    const result = await repo.isMinorByContactId(SYNTH_CONTACT_ID);
    expect(result).toBe(true);
  });

  it("contacto con todas personas adultas → false", async () => {
    const client = makeFakeSelectClient([
      { id: "p1", edad: 30, minors_row: null },
      { id: "p2", edad: 45, minors_row: null },
    ]);
    const repo = createSearchRepo(client);
    const result = await repo.isMinorByContactId(SYNTH_CONTACT_ID);
    expect(result).toBe(false);
  });

  it("contacto con persona de edad null → true (conservador: edad desconocida = menor)", async () => {
    const client = makeFakeSelectClient([
      { id: "p1", edad: null, minors_row: null },
    ]);
    const repo = createSearchRepo(client);
    const result = await repo.isMinorByContactId(SYNTH_CONTACT_ID);
    expect(result).toBe(true);
  });

  it("contacto con persona adulta pero fila en minors → true (tabla minors gana)", async () => {
    const client = makeFakeSelectClient([
      { id: "p1", edad: 30, minors_row: { id: "m1" } },
    ]);
    const repo = createSearchRepo(client);
    const result = await repo.isMinorByContactId(SYNTH_CONTACT_ID);
    expect(result).toBe(true);
  });
});

// ── SearchRepo: listOpenMatchingReport ───────────────────────────────────────

describe("SearchRepo.listOpenMatchingReport", () => {
  it("devuelve lista de búsquedas abiertas para matching (sin buscador_contact_id en output)", async () => {
    const client = makeFakeSelectClient([
      {
        id: SYNTH_SEARCH_ID,
        tipo: "persona",
        target_nombre: "Juan",
        target_descripcion: null,
        zona: null,
        buscador_contact_id: SYNTH_CONTACT_ID, // interno, no debe salir
        es_menor: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const repo = createSearchRepo(client);
    const result = await repo.listOpenMatchingReport();
    expect(result).toHaveLength(1);
    // buscador_contact_id no se expone en este método
    expect(result[0]).not.toHaveProperty("buscador_contact_id");
    expect(result[0]!.id).toBe(SYNTH_SEARCH_ID);
  });

  it("lista vacía cuando no hay búsquedas abiertas", async () => {
    const client = makeFakeSelectClient([]);
    const repo = createSearchRepo(client);
    const result = await repo.listOpenMatchingReport();
    expect(result).toHaveLength(0);
  });
});

// ── RelayRepo ────────────────────────────────────────────────────────────────

describe("RelayRepo", () => {
  it("getActiveRelay: devuelve relay activo para un canal", async () => {
    const client = makeFakeSelectClient([{
      id: SYNTH_RELAY_ID,
      party_a_channel_id: "ch-a",
      party_b_channel_id: "ch-b",
      state: "active",
    }]);
    const repo = createRelayRepo(client);
    const result = await repo.getActiveRelay("ch-a");
    expect(result).not.toBeNull();
    expect(result?.relayId).toBe(SYNTH_RELAY_ID);
    // El otro canal es ch-b (la parte contraria)
    expect(result?.otherChannelId).toBe("ch-b");
  });

  it("getActiveRelay: null cuando no hay relay activo", async () => {
    const client = makeFakeSelectClient([]);
    const repo = createRelayRepo(client);
    const result = await repo.getActiveRelay("ch-unknown");
    expect(result).toBeNull();
  });

  it("closeRelay: cierra el relay (llama a update state=closed)", async () => {
    // Fake client que captura el update call
    let updateCalled = false;
    const queryBuilder = {
      select: () => queryBuilder,
      eq: (col: string) => {
        if (col === "id") updateCalled = true;
        return queryBuilder;
      },
      update: () => queryBuilder,
      limit: () => queryBuilder,
      order: () => queryBuilder,
      returns: () => queryBuilder,
      then: (resolve: (v: { data: null; error: null }) => unknown) =>
        resolve({ data: null, error: null }),
    };
    const client = { from: () => queryBuilder, rpc: () => queryBuilder } as unknown as DbClient;
    const repo = createRelayRepo(client);
    await repo.closeRelay(SYNTH_RELAY_ID);
    expect(updateCalled).toBe(true);
  });
});

// ── AuditRepo ────────────────────────────────────────────────────────────────

describe("AuditRepo", () => {
  it("writeRouteDecision: escribe una fila de auditoría route_decision", async () => {
    let insertCalled = false;
    const queryBuilder = {
      select: () => queryBuilder,
      eq: () => queryBuilder,
      insert: () => { insertCalled = true; return queryBuilder; },
      single: () => Promise.resolve({ data: { id: SYNTH_AUDIT_ID }, error: null }),
      limit: () => queryBuilder,
      order: () => queryBuilder,
      returns: () => queryBuilder,
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: null, error: null }),
    };
    const client = { from: () => queryBuilder, rpc: () => queryBuilder } as unknown as DbClient;
    const repo = createAuditRepo(client);
    await repo.writeRouteDecision({
      matchId: "m-id",
      searcherContactId: SYNTH_CONTACT_ID,
      registrantContactId: "c-reg",
      score: 0.9,
      threshold: 0.85,
      result: "auto",
    });
    expect(insertCalled).toBe(true);
  });
});
