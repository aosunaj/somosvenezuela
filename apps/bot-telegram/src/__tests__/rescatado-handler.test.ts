import { describe, expect, it } from "vitest";
import { FakeBackend, FakeTransport, textUpdate } from "../../test/fakes.js";
import { handleUpdate } from "../handle-update.js";

// [TDD-RED] Tests for reportRescatado wiring in bot-telegram.
//
// The bot exposes /rescatado_reportar (or similar) command for a SEARCHER to
// report finding someone. This is different from /rescatado (which is the owner
// marking their registered person as found = mark_found flow in core machine).
//
// reportRescatado (Slice D) is for when the SEARCHER says "I found this person".
// It calls POST /rescatado on the backend via BackendClient.reportRescatado().
//
// Design: the bot wires reportRescatado as a direct command handler (outside the
// machine), similar to how reunionConsent works for /conectar / /rechazar.

const CHAT_ID = 42;

describe("reportRescatado — BackendClient method (bot-telegram)", () => {
  it("FakeBackend satisfies BackendClient with reportRescatado method", () => {
    // Type-level check: FakeBackend must implement reportRescatado
    const backend = new FakeBackend();
    expect(typeof backend.reportRescatado).toBe("function");
  });

  it("/reportar_rescatado command calls backend.reportRescatado with personId and channel", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    const sessions = new Map<number, unknown>();

    await handleUpdate(
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          // Command with personId argument: /reportar_rescatado <personId>
          text: "/reportar_rescatado cccccccc-0000-4000-8000-000000000003",
        },
      },
      {
        transport,
        backend: backend as unknown as Parameters<typeof handleUpdate>[1]["backend"],
        sessions: {
          get: (id: number) => sessions.get(id) as never,
          set: (id: number, state: unknown) => sessions.set(id, state),
        },
      },
    );

    expect(backend.reportRescatadoCalls.length).toBe(1);
    expect(backend.reportRescatadoCalls[0]).toMatchObject({
      personId: "cccccccc-0000-4000-8000-000000000003",
      channel: { plataforma: "telegram", chatId: String(CHAT_ID) },
    });
  });

  it("reportRescatado success shows queued confirmation to user", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend({ reportRescatadoStatus: "queued" });
    const sessions = new Map<number, unknown>();

    await handleUpdate(
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          text: "/reportar_rescatado cccccccc-0000-4000-8000-000000000003",
        },
      },
      {
        transport,
        backend: backend as unknown as Parameters<typeof handleUpdate>[1]["backend"],
        sessions: {
          get: (id: number) => sessions.get(id) as never,
          set: (id: number, state: unknown) => sessions.set(id, state),
        },
      },
    );

    const msgs = transport.forChat(CHAT_ID);
    expect(msgs.length).toBeGreaterThan(0);
    // Message must not contain PII
    const allText = transport.allText();
    expect(allText).not.toContain("cccccccc-0000-4000-8000-000000000003");
  });

  it("reportRescatado backend failure shows generic error message", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend({ failReportRescatado: true });
    const sessions = new Map<number, unknown>();

    await handleUpdate(
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          text: "/reportar_rescatado cccccccc-0000-4000-8000-000000000003",
        },
      },
      {
        transport,
        backend: backend as unknown as Parameters<typeof handleUpdate>[1]["backend"],
        sessions: {
          get: (id: number) => sessions.get(id) as never,
          set: (id: number, state: unknown) => sessions.set(id, state),
        },
      },
    );

    // Should show a user-friendly error, not throw
    const msgs = transport.forChat(CHAT_ID);
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("normal text update does NOT call reportRescatado", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    const sessions = new Map<number, unknown>();

    await handleUpdate(textUpdate(CHAT_ID, "hola como estas"), {
      transport,
      backend: backend as unknown as Parameters<typeof handleUpdate>[1]["backend"],
      sessions: {
        get: (id: number) => sessions.get(id) as never,
        set: (id: number, state: unknown) => sessions.set(id, state),
      },
    });

    expect(backend.reportRescatadoCalls.length).toBe(0);
  });
});
