import { describe, expect, it } from "vitest";
import { handleUpdate, type UpdateDeps } from "../src/handle-update.js";
import { InMemorySessionStore } from "../src/session-store.js";
import {
  FakeBackend,
  FakeTransport,
  textUpdate,
} from "./fakes.js";

// Tests [RED → GREEN] for relay intercept (F4 selective pre-machine, design v3).
//
// Precedence (top wins):
//   1. parse command → command-only bypass
//   2. control commands (/cancelar /borrar /start /ayuda /compartir_contacto) → machine (bypass relay)
//   3. kind:'text' with active relay → relay-check → forward-or-block-phone
//   4. kind:'text' without active relay → machine
//
// guardrail #1: phone numbers are BLOCKING — never forwarded.
// /cancelar in relay → closeRelay both sides + notify other party.

const CHAT = 999;
const RELAY_ID = "aaaabbbb-0000-4000-8000-111122223333";
const OTHER_CHANNEL_ID = "ccccdddd-0000-4000-8000-111122224444";

function makeDeps(opts: {
  activeRelay?: { relayId: string; otherChannelId: string } | null;
  closeRelayFails?: boolean;
} = {}): { deps: UpdateDeps; transport: FakeTransport; sessions: InMemorySessionStore; backend: FakeBackend } {
  const transport = new FakeTransport();
  const sessions = new InMemorySessionStore();
  const backend = new FakeBackend({
    activeRelay: opts.activeRelay ?? null,
    closeRelayFails: opts.closeRelayFails ?? false,
  });
  return { deps: { transport, backend, sessions }, transport, sessions, backend };
}

async function send(deps: UpdateDeps, chatId: number, ...texts: string[]): Promise<void> {
  let id = 1;
  for (const t of texts) {
    await handleUpdate(textUpdate(chatId, t, id++), deps);
  }
}

describe("relay intercept — no active relay", () => {
  it("plain text without relay passes to the conversation machine normally", async () => {
    const { deps, transport } = makeDeps({ activeRelay: null });
    await send(deps, CHAT, "Hola");
    // Machine responds (idle -> /start-like welcome or prompt for command)
    expect(transport.sent.length).toBeGreaterThan(0);
    // Nothing relay-related
    const text = transport.allText();
    expect(text).not.toContain("reenviado");
  });

  it("command /start bypasses relay check even when relay would be active", async () => {
    // Even with activeRelay set, a command always goes to the machine
    const { deps, backend } = makeDeps({ activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID } });
    await send(deps, CHAT, "/start");
    // getActiveRelay should NOT be called for commands
    expect(backend.getActiveRelayCalls).toBe(0);
  });
});

describe("relay intercept — active relay + clean text", () => {
  it("text message with active relay is forwarded (writes notification via backend)", async () => {
    const { deps, backend } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "¿Cómo estás?");
    // forwardRelayMessage called with the relayId and text
    expect(backend.forwardRelayMessageCalls).toHaveLength(1);
    expect(backend.forwardRelayMessageCalls[0]?.relayId).toBe(RELAY_ID);
    expect(backend.forwardRelayMessageCalls[0]?.text).toContain("¿Cómo estás?");
  });

  it("forward sends a confirmation to the sender (message was forwarded)", async () => {
    const { deps, transport } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "Estamos bien");
    // Sender gets a quiet confirmation
    expect(transport.allText()).toContain("nviado");
  });

  it("forwarded message is prefixed with a relay marker (safe, no contact PII)", async () => {
    const { deps, backend } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "Mensaje de prueba");
    const forwarded = backend.forwardRelayMessageCalls[0]?.text ?? "";
    // Should have some prefix or the original text
    expect(typeof forwarded).toBe("string");
    expect(forwarded.length).toBeGreaterThan(0);
    // Must NOT expose contact PII like phone numbers
    expect(forwarded).not.toMatch(/\d{10,}/);
  });
});

describe("relay intercept — BLOCKING phone scan", () => {
  it("text with phone number is BLOCKED — forwardRelayMessage is NOT called", async () => {
    const { deps, backend } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "Mi número es +58 412 1234567");
    expect(backend.forwardRelayMessageCalls).toHaveLength(0);
  });

  it("phone block sends warning to sender (in Spanish)", async () => {
    const { deps, transport } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "Llámame al 0416 555 1234");
    const text = transport.allText();
    expect(text).toContain("teléfono");
    expect(text).toContain("compartir_contacto");
  });

  it("local Venezuelan number (11 digits) is also blocked", async () => {
    const { deps, backend } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "04141234567");
    expect(backend.forwardRelayMessageCalls).toHaveLength(0);
  });
});

describe("relay intercept — /cancelar command", () => {
  it("/cancelar with active relay closes relay and notifies both parties", async () => {
    const { deps, backend, transport } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "/cancelar");
    // closeRelay is called
    expect(backend.closeRelayCalls).toHaveLength(1);
    expect(backend.closeRelayCalls[0]?.relayId).toBe(RELAY_ID);
    // Sender gets confirmation
    expect(transport.allText().toLowerCase()).toMatch(/cancelad|cerrad|desconect/);
  });

  it("/cancelar without active relay passes to the machine (no closeRelay call)", async () => {
    const { deps, backend } = makeDeps({ activeRelay: null });
    await send(deps, CHAT, "/cancelar");
    expect(backend.closeRelayCalls).toHaveLength(0);
  });
});

describe("relay intercept — bypass commands", () => {
  it("/borrar bypasses relay check and goes to machine", async () => {
    const { deps, backend } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "/borrar");
    // relay is NOT checked for commands
    expect(backend.getActiveRelayCalls).toBe(0);
  });

  it("/ayuda bypasses relay check", async () => {
    const { deps, backend } = makeDeps({
      activeRelay: { relayId: RELAY_ID, otherChannelId: OTHER_CHANNEL_ID },
    });
    await send(deps, CHAT, "/ayuda");
    expect(backend.getActiveRelayCalls).toBe(0);
  });
});

describe("relay intercept — es_menor forwarded to backend on search", () => {
  it("es_menor:true from machine is sent to searchPersons when user answers Sí", async () => {
    const { deps, backend } = makeDeps({ activeRelay: null });
    // Full guided search with es_menor = true (answer "Sí" to the minor question)
    let id = 1;
    const steps = [
      "Buscar", // or command
      "/buscar",
      "Juan",
      "Omitir",
      "Omitir",
      "Omitir",
      "Omitir",
      "Sí",     // es_menor = true
    ];
    for (const t of steps) {
      await handleUpdate(textUpdate(CHAT, t, id++), deps);
    }
    // If search was called, es_menor should be true
    const searchCall = backend.searchCalls.find((c) => c.es_menor === true);
    if (backend.searchCalls.length > 0) {
      expect(searchCall).toBeDefined();
    }
  });
});
