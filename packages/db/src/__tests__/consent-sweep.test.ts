import { describe, expect, it } from "vitest";

// [TDD-RED] ConsentRepo extension: getExpiredPendingConsents + markConsentExpired
//
// These methods are required by sweepExpiredConsents (judgment-r3 item 11).
// The consent repo needs to expose:
//   - getExpiredPendingConsents(): returns sessions where state IN
//     ('pending_a','pending_b') AND expires_at < now()
//   - markConsentExpired(id): sets state='expired' for a consent session
//
// Tests use the fake-rpc pattern (no real Supabase).

// Fake Supabase client that captures calls
interface FakeQueryResult<T> {
  data: T | null;
  error: null;
}

function makeFakeClient() {
  const updates: Array<{ id: string; state: string }> = [];
  const expiredSessions = [
    {
      id: "cccc0000-0000-4000-8000-000000000001",
      searcher_channel_id: "aaaa0000-0000-4000-8000-000000000001",
      registrant_channel_id: "bbbb0000-0000-4000-8000-000000000002",
    },
  ];

  return {
    _updates: updates,
    _expiredSessions: expiredSessions,
    from(table: string) {
      return {
        _table: table,
        select(_cols?: string) {
          return {
            in(_col: string, _vals: string[]) {
              return {
                lt(_col: string, _val: string) {
                  return Promise.resolve({
                    data: expiredSessions,
                    error: null,
                  } as FakeQueryResult<typeof expiredSessions>);
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            eq(col: string, val: string) {
              if (col === "id") {
                updates.push({ id: val, state: values["state"] as string });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
    // Keep rpc for existing tests
    rpc(_fn: string, _args: unknown) {
      return {
        select() {
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };
}

describe("ConsentRepo — getExpiredPendingConsents", () => {
  it("returns expired pending sessions from the DB", async () => {
    const { createConsentRepo } = await import("../repos/consent.js");
    const fakeClient = makeFakeClient();
    const repo = createConsentRepo(fakeClient as unknown as Parameters<typeof createConsentRepo>[0]);

    const result = await repo.getExpiredPendingConsents();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({
      id: "cccc0000-0000-4000-8000-000000000001",
      searcherChannelId: "aaaa0000-0000-4000-8000-000000000001",
      registrantChannelId: "bbbb0000-0000-4000-8000-000000000002",
    });
  });

  it("returns empty array when no sessions are expired", async () => {
    const { createConsentRepo } = await import("../repos/consent.js");
    const fakeClient = makeFakeClient();
    fakeClient._expiredSessions.length = 0;
    const repo = createConsentRepo(fakeClient as unknown as Parameters<typeof createConsentRepo>[0]);

    const result = await repo.getExpiredPendingConsents();
    expect(result).toEqual([]);
  });
});

describe("ConsentRepo — markConsentExpired", () => {
  it("updates state to 'expired' for the given consent id", async () => {
    const { createConsentRepo } = await import("../repos/consent.js");
    const fakeClient = makeFakeClient();
    const repo = createConsentRepo(fakeClient as unknown as Parameters<typeof createConsentRepo>[0]);

    const consentId = "cccc0000-0000-4000-8000-000000000001";
    await repo.markConsentExpired(consentId);

    expect(fakeClient._updates).toContainEqual({ id: consentId, state: "expired" });
  });
});
