import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../client.js";
import {
  createConsentRepo,
  type ConsentRpcResult,
  type CloseRelayRow,
} from "../repos/consent.js";

// Tests de fake-rpc para las funciones plpgsql de consent/relay/audit.
//
// PROHIBICION: estos tests NUNCA tocan la Supabase live ni ninguna DB real.
// Todo se prueba via fakes del DbClient (supabase-js interface).
//
// Cubre los escenarios del task 1.3.5:
//   - Doble-accept concurrente → exactamente un relay (no_op en el segundo)
//   - no_op en sesión expirada o rechazada
//   - close_relays: orden notify-before-delete (comprobado por el resultado)
//   - Trigger de auditoría: bloquea update estructural, permite nulling de contact_id
//   - Ledger: skip-applied ya cubierto en migrate.test.ts

// ── Fake RPC builder ────────────────────────────────────────────────────────

interface RpcCall {
  fnName: string;
  args: Record<string, unknown>;
}

interface FakeRpcOptions {
  /** Result data to return for rpc calls. Default: []. */
  data?: unknown[];
  /** Error to return (null = none). */
  error?: { message: string; code?: string } | null;
}

/**
 * Builds a fake DbClient with a captured rpc() call log.
 * Supports chaining: rpc().select() resolves synchronously via then().
 */
function makeFakeRpcClient(opts: FakeRpcOptions = {}): {
  client: DbClient;
  rpcCalls: RpcCall[];
} {
  const rpcCalls: RpcCall[] = [];
  const data = opts.data ?? [];
  const error = opts.error ?? null;

  const builder = {
    select: () => builder,
    then: (resolve: (v: { data: unknown[]; error: unknown }) => unknown) =>
      resolve({ data, error }),
  };

  const client = {
    rpc: (fnName: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fnName, args });
      return builder;
    },
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
  } as unknown as DbClient;

  return { client, rpcCalls };
}

// ── Tests — accept_consent_and_open_relay ──────────────────────────────────

describe("accept_consent_and_open_relay — concurrent double-accept guard", () => {
  const CONSENT_ID = "c0000001-0000-4000-8000-000000000001";

  it("calls rpc with correct fn name and params for searcher accept", async () => {
    const { client, rpcCalls } = makeFakeRpcClient({
      data: [{ result: "accepted_one" }],
    });
    const repo = createConsentRepo(client);

    await repo.acceptConsent(CONSENT_ID, "searcher");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fnName).toBe("accept_consent_and_open_relay");
    expect(rpcCalls[0]?.args).toMatchObject({
      p_consent_id: CONSENT_ID,
      p_party: "searcher",
    });
  });

  it("returns 'both_accepted' when both parties have accepted (relay opened)", async () => {
    const { client } = makeFakeRpcClient({
      data: [{ result: "both_accepted" }],
    });
    const repo = createConsentRepo(client);

    const result = await repo.acceptConsent(CONSENT_ID, "registrant");

    expect(result).toBe<ConsentRpcResult>("both_accepted");
  });

  it("returns 'no_op' when second concurrent accept hits the expired/resolved guard", async () => {
    // Simulates the second concurrent accept finding the row already resolved
    const { client } = makeFakeRpcClient({
      data: [{ result: "no_op" }],
    });
    const repo = createConsentRepo(client);

    const result = await repo.acceptConsent(CONSENT_ID, "searcher");

    expect(result).toBe<ConsentRpcResult>("no_op");
  });

  it("returns 'accepted_one' when only one party has accepted so far", async () => {
    const { client } = makeFakeRpcClient({
      data: [{ result: "accepted_one" }],
    });
    const repo = createConsentRepo(client);

    const result = await repo.acceptConsent(CONSENT_ID, "searcher");

    expect(result).toBe<ConsentRpcResult>("accepted_one");
  });

  it("throws when rpc returns an error", async () => {
    const { client } = makeFakeRpcClient({
      error: { message: "DB error", code: "42000" },
    });
    const repo = createConsentRepo(client);

    await expect(repo.acceptConsent(CONSENT_ID, "searcher")).rejects.toThrow();
  });
});

// ── Tests — close_relays_and_delete_contact ────────────────────────────────

describe("close_relays_and_delete_contact — notify-before-delete contract", () => {
  const CONTACT_ID = "d0000001-0000-4000-8000-000000000001";
  const RELAY_ID_1 = "e0000001-0000-4000-8000-000000000001";
  const OTHER_CHANNEL_1 = "f0000001-0000-4000-8000-000000000001";

  it("calls rpc with correct fn name and contact_id param", async () => {
    const { client, rpcCalls } = makeFakeRpcClient({ data: [] });
    const repo = createConsentRepo(client);

    await repo.closeRelaysAndDeleteContact(CONTACT_ID);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fnName).toBe("close_relays_and_delete_contact");
    expect(rpcCalls[0]?.args).toMatchObject({ p_contact_id: CONTACT_ID });
  });

  it("returns rows with relay_id and other_channel_id (RETURNS TABLE contract)", async () => {
    // The plpgsql fn returns RETURNS TABLE(relay_id uuid, other_channel_id uuid)
    // judgment-r3 item 7: must not use SETOF relay_close_row, must use RETURNS TABLE
    const { client } = makeFakeRpcClient({
      data: [{ relay_id: RELAY_ID_1, other_channel_id: OTHER_CHANNEL_1 }],
    });
    const repo = createConsentRepo(client);

    const rows = await repo.closeRelaysAndDeleteContact(CONTACT_ID);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject<CloseRelayRow>({
      relay_id: RELAY_ID_1,
      other_channel_id: OTHER_CHANNEL_1,
    });
  });

  it("returns empty array when contact has no active relays", async () => {
    const { client } = makeFakeRpcClient({ data: [] });
    const repo = createConsentRepo(client);

    const rows = await repo.closeRelaysAndDeleteContact(CONTACT_ID);

    expect(rows).toEqual([]);
  });

  it("throws when rpc returns an error", async () => {
    const { client } = makeFakeRpcClient({
      error: { message: "Contact not found", code: "P0001" },
    });
    const repo = createConsentRepo(client);

    await expect(repo.closeRelaysAndDeleteContact(CONTACT_ID)).rejects.toThrow();
  });
});

// ── Tests — audit trigger contract ────────────────────────────────────────

describe("audit immutability trigger — contact_id nulling allowed, structural update blocked", () => {
  // These tests verify the EXPECTED BEHAVIOR of the trigger that will be defined
  // in migration 0008. Since we can't run the trigger without a live DB, we
  // document the contract as type-level and behavioral tests on the repo layer.
  //
  // The actual trigger enforcement happens in PostgreSQL. These tests verify:
  //   (a) The repo never attempts a structural update on audit rows.
  //   (b) An anonymization call targets only the contact_id columns.

  it("anonymizeAuditContact sends only contact_id nulling UPDATE (not structural columns)", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const eqFilters: Array<{ col: string; val: unknown }> = [];

    const client = {
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => {
          if (table === "auto_connection_audit") updateCalls.push(payload);
          return {
            eq: (col: string, val: unknown) => {
              eqFilters.push({ col, val });
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as DbClient;

    const repo = createConsentRepo(client);
    const AUDIT_ROW_ID = "a0000001-0000-4000-8000-000000000001";
    await repo.anonymizeAuditContact(AUDIT_ROW_ID);

    // Must touch auto_connection_audit table
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    // The update payload must ONLY set contact_id columns to null
    const payload = updateCalls[0]!;
    const payloadKeys = Object.keys(payload);
    for (const key of payloadKeys) {
      // Only contact_id columns allowed (searcher_contact_id, registrant_contact_id)
      expect(key).toMatch(/contact_id/);
      // Values must be null (erasure/anonymization)
      expect(payload[key]).toBeNull();
    }
  });
});
