import { describe, expect, it } from "vitest";
import {
  handleMenuCallbackQuery,
  MENU_CALLBACK_PREFIX,
  type MenuCallbackDeps,
} from "../handlers/menu.js";

// Tests TDD para el handler del menu inline del bot Telegram (Slice M).
// Verifica que el handler despacha correctamente las entradas del menu inline
// a las acciones correspondientes. Datos sinteticos — sin PII real.

const CHAT_ID = 12345;
const CALLBACK_QUERY_ID = "test-callback-123";

/**
 * Helper: construye un Update de Telegram simulado que contiene un callback_query.
 * El handler espera el update completo (con la clave "callback_query" en el nivel raiz).
 */
function makeCallbackQuery(callbackData: string): unknown {
  return {
    update_id: 1,
    callback_query: {
      id: CALLBACK_QUERY_ID,
      from: { id: 999, is_bot: false, first_name: "Test" },
      message: {
        message_id: 1,
        chat: { id: CHAT_ID, type: "private" },
      },
      data: callbackData,
    },
  };
}

/** Fake transport para capturar mensajes enviados. */
class FakeTransport {
  readonly sent: Array<{ chatId: number; text: string; buttons?: unknown }> = [];
  answerCallbackQueryCalls: string[] = [];

  async sendMessage(chatId: number, text: string, buttons?: unknown): Promise<void> {
    this.sent.push({ chatId, text, buttons });
  }

  async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    this.answerCallbackQueryCalls.push(callbackQueryId);
  }

  allText(): string {
    return this.sent.map((m) => m.text).join("\n");
  }
}

/** Fake session store. */
class FakeSessionStore {
  private sessions = new Map<number, unknown>();
  get(chatId: number): unknown | undefined {
    return this.sessions.get(chatId);
  }
  set(chatId: number, state: unknown): void {
    this.sessions.set(chatId, state);
  }
}

function makeDeps(transport: FakeTransport, sessions: FakeSessionStore): MenuCallbackDeps {
  return {
    transport: transport as unknown as MenuCallbackDeps["transport"],
    sessions: sessions as unknown as MenuCallbackDeps["sessions"],
  };
}

describe("handleMenuCallbackQuery", () => {
  it("retorna false para callbackData que no es del menu", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const result = await handleMenuCallbackQuery(
      makeCallbackQuery("other:action"),
      deps,
    );
    expect(result).toBe(false);
    expect(transport.sent).toHaveLength(0);
  });

  it("retorna false para callbackData vacio", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const result = await handleMenuCallbackQuery(
      makeCallbackQuery(""),
      deps,
    );
    expect(result).toBe(false);
  });

  it("retorna true para menu:search_register_person y envia una respuesta", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const result = await handleMenuCallbackQuery(
      makeCallbackQuery(`${MENU_CALLBACK_PREFIX}search_register_person`),
      deps,
    );
    expect(result).toBe(true);
    expect(transport.sent.length).toBeGreaterThan(0);
  });

  it("menu:search_register_pet inicia flujo de mascota", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const result = await handleMenuCallbackQuery(
      makeCallbackQuery(`${MENU_CALLBACK_PREFIX}search_register_pet`),
      deps,
    );
    expect(result).toBe(true);
    expect(transport.sent.length).toBeGreaterThan(0);
    // El mensaje debe mencionar mascota
    expect(transport.allText()).toMatch(/mascota/i);
  });

  it("menu:meeting_points inicia el flujo de puntos de encuentro", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const result = await handleMenuCallbackQuery(
      makeCallbackQuery(`${MENU_CALLBACK_PREFIX}meeting_points`),
      deps,
    );
    expect(result).toBe(true);
  });

  it("menu:needs inicia el flujo de necesidades", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const result = await handleMenuCallbackQuery(
      makeCallbackQuery(`${MENU_CALLBACK_PREFIX}needs`),
      deps,
    );
    expect(result).toBe(true);
  });

  it("menu:delete_record inicia el flujo de borrar registro", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const result = await handleMenuCallbackQuery(
      makeCallbackQuery(`${MENU_CALLBACK_PREFIX}delete_record`),
      deps,
    );
    expect(result).toBe(true);
  });

  it("menu:help envia el mensaje de ayuda", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const result = await handleMenuCallbackQuery(
      makeCallbackQuery(`${MENU_CALLBACK_PREFIX}help`),
      deps,
    );
    expect(result).toBe(true);
    expect(transport.sent.length).toBeGreaterThan(0);
  });

  it("menu:person_rescued y menu:pet_rescued retornan true", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    const r1 = await handleMenuCallbackQuery(
      makeCallbackQuery(`${MENU_CALLBACK_PREFIX}person_rescued`),
      deps,
    );
    expect(r1).toBe(true);

    const transport2 = new FakeTransport();
    const sessions2 = new FakeSessionStore();
    const deps2 = makeDeps(transport2, sessions2);
    const r2 = await handleMenuCallbackQuery(
      makeCallbackQuery(`${MENU_CALLBACK_PREFIX}pet_rescued`),
      deps2,
    );
    expect(r2).toBe(true);
  });

  it("MENU_CALLBACK_PREFIX debe ser 'menu:'", () => {
    expect(MENU_CALLBACK_PREFIX).toBe("menu:");
  });

  it("no expone PII en ninguna respuesta del menu", async () => {
    const transport = new FakeTransport();
    const sessions = new FakeSessionStore();
    const deps = makeDeps(transport, sessions);

    for (const entry of ["search_register_person", "search_register_pet", "help", "delete_record", "needs"]) {
      await handleMenuCallbackQuery(
        makeCallbackQuery(`${MENU_CALLBACK_PREFIX}${entry}`),
        deps,
      );
    }
    const allText = transport.allText();
    // No debe contener numeros de telefono de 10+ digitos
    expect(allText).not.toMatch(/\d{10,}/);
  });
});
