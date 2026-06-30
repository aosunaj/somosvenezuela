import { describe, expect, it } from "vitest";
import type { DbClient } from "../client.js";
import { createSecureDeleteRepo } from "../repos/secure-delete.js";

// Tests de borrado atomico (judgment-r3 item 1).
// Verifica que deletePersonAndOwner usa rpc('close_relays_and_delete_contact')
// en lugar de dos .delete() sueltos sobre la tabla contacts.
//
// CRITICO (guardrail #5 derecho al borrado): el borrado debe ser atomico.
// La ventana de fallo parcial (persona borrada, contacto/relay vivo) = breach.
//
// Datos SINTETICOS sin PII.

const SYNTH_PERSON_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SYNTH_CONTACT_ID = "bbbbbbbb-0000-4000-8000-000000000002";

interface CallLog {
  fromTable: string[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  deleteCalls: string[];
}

/**
 * Crea un fake DbClient que registra:
 * - Las tablas accedidas via from()
 * - Las llamadas a rpc()
 * - Las llamadas a .delete() por tabla
 */
function makeFakeTrackingClient(deleteError: null | { message: string; code?: string } = null): {
  client: DbClient;
  log: CallLog;
} {
  const log: CallLog = {
    fromTable: [],
    rpcCalls: [],
    deleteCalls: [],
  };

  const rpcBuilder = {
    select: () => rpcBuilder,
    then: (resolve: (v: { data: unknown[]; error: unknown }) => unknown) =>
      resolve({ data: [], error: null }),
  };

  function makeFromBuilder(table: string) {
    const builder: Record<string, unknown> = {
      select: (_cols?: string) => builder,
      eq: (_col: string, _val: string) => builder,
      maybeSingle: () =>
        Promise.resolve({
          data: table === "persons" ? { contact_id: SYNTH_CONTACT_ID } : null,
          error: null,
        }),
      delete: () => {
        log.deleteCalls.push(table);
        return {
          eq: (_col: string, _val: string) => ({
            then: (resolve: (v: { data: null; error: null | { message: string } }) => unknown) =>
              resolve({ data: null, error: deleteError }),
          }),
        };
      },
    };
    return builder;
  }

  const client = {
    from: (table: string) => {
      log.fromTable.push(table);
      return makeFromBuilder(table);
    },
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      log.rpcCalls.push({ fn, args });
      return rpcBuilder;
    },
  } as unknown as DbClient;

  return { client, log };
}

// ── deletePersonAndOwner: borrado atomico ────────────────────────────────────

describe("SecureDeleteRepo.deletePersonAndOwner — borrado atomico", () => {
  it("borra persona via .delete() de tabla persons", async () => {
    const { client, log } = makeFakeTrackingClient();
    const repo = createSecureDeleteRepo(client);

    await repo.deletePersonAndOwner(SYNTH_PERSON_ID, SYNTH_CONTACT_ID);

    expect(log.deleteCalls).toContain("persons");
  });

  it("usa rpc('close_relays_and_delete_contact') en lugar de .delete() sobre contacts", async () => {
    const { client, log } = makeFakeTrackingClient();
    const repo = createSecureDeleteRepo(client);

    await repo.deletePersonAndOwner(SYNTH_PERSON_ID, SYNTH_CONTACT_ID);

    // Debe haber una llamada a rpc con la funcion correcta
    const rpcCall = log.rpcCalls.find(
      (c) => c.fn === "close_relays_and_delete_contact",
    );
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.args).toMatchObject({ p_contact_id: SYNTH_CONTACT_ID });
  });

  it("NO llama a .delete() sobre la tabla contacts directamente", async () => {
    const { client, log } = makeFakeTrackingClient();
    const repo = createSecureDeleteRepo(client);

    await repo.deletePersonAndOwner(SYNTH_PERSON_ID, SYNTH_CONTACT_ID);

    // contacts.delete() ya no debe usarse — la rpc lo hace atomicamente
    expect(log.deleteCalls).not.toContain("contacts");
  });

  it("con contactId null → solo borra persona, no llama rpc", async () => {
    const { client, log } = makeFakeTrackingClient();
    const repo = createSecureDeleteRepo(client);

    await repo.deletePersonAndOwner(SYNTH_PERSON_ID, null);

    expect(log.deleteCalls).toContain("persons");
    expect(log.rpcCalls).toHaveLength(0);
  });

  it("orden: borra persona PRIMERO, luego rpc (persons.contact_id es SET NULL)", async () => {
    const callOrder: string[] = [];

    const rpcBuilder = {
      select: () => rpcBuilder,
      then: (resolve: (v: { data: unknown[]; error: unknown }) => unknown) => {
        callOrder.push("rpc:close_relays_and_delete_contact");
        return resolve({ data: [], error: null });
      },
    };

    const client = {
      from: (table: string) => {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: table === "persons" ? { contact_id: SYNTH_CONTACT_ID } : null,
                  error: null,
                }),
            }),
          }),
          delete: () => ({
            eq: (_col: string, _val: string) => ({
              then: (resolve: (v: { data: null; error: null }) => unknown) => {
                callOrder.push(`delete:${table}`);
                return resolve({ data: null, error: null });
              },
            }),
          }),
        };
      },
      rpc: (fn: string, _args: Record<string, unknown> = {}) => {
        if (fn === "close_relays_and_delete_contact") {
          callOrder.push(`rpc:${fn}`);
        }
        return rpcBuilder;
      },
    } as unknown as DbClient;

    const repo = createSecureDeleteRepo(client);
    await repo.deletePersonAndOwner(SYNTH_PERSON_ID, SYNTH_CONTACT_ID);

    const personIdx = callOrder.indexOf("delete:persons");
    const rpcIdx = callOrder.indexOf("rpc:close_relays_and_delete_contact");
    expect(personIdx).toBeGreaterThanOrEqual(0);
    expect(rpcIdx).toBeGreaterThan(personIdx);
  });
});
