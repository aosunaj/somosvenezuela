import { describe, expect, it } from "vitest";
import {
  handleUnifiedEntryUpdate,
  type UnifiedEntryHandlerDeps,
} from "../handlers/unified-entry.js";

// Tests TDD para el handler del flujo unificado buscar/registrar (Slice U).
// Verifica la orquestacion del flujo: texto recibido → busqueda en backend →
// presentacion de candidatos → suscripcion al caso (B-1 dedup).
// Datos 100% sinteticos — sin PII real.

const CHAT_ID = 42000;
const SYNTH_CASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** Fake transport que captura mensajes enviados. */
class FakeTransport {
  readonly sent: Array<{ chatId: number; text: string; buttons?: unknown }> = [];

  async sendMessage(chatId: number, text: string, buttons?: unknown): Promise<void> {
    this.sent.push({ chatId, text, buttons });
  }

  allText(): string {
    return this.sent.map((m) => m.text).join("\n");
  }
}

/** Candidato sintetico de busqueda (vista publica, sin PII de contacto). */
function syntheticCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: SYNTH_CASE_ID,
    nombre: "Persona Sintetica",
    apellidos: null,
    edad: 30,
    zona: "Zona Norte",
    descripcion: null,
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: "2026-06-28T00:00:00.000Z",
    score: 0.9,
    ...overrides,
  };
}

/** Fake backend con busqueda configurable. */
class FakeBackend {
  searchPersonsResults: unknown[] = [];
  searchPetResults: unknown[] = [];
  subscribeInterestCalls: Array<{ caseId: string; domain: string }> = [];
  failSearch = false;
  failSubscribe = false;

  async searchPersonsUnified(_query: string): Promise<unknown[]> {
    if (this.failSearch) throw new Error("search failed (synth)");
    return this.searchPersonsResults;
  }

  async searchPetsUnified(_query: string): Promise<unknown[]> {
    if (this.failSearch) throw new Error("search failed (synth)");
    return this.searchPetResults;
  }

  async subscribeToCase(caseId: string, domain: string): Promise<{ ok: boolean }> {
    this.subscribeInterestCalls.push({ caseId, domain });
    if (this.failSubscribe) return { ok: false };
    return { ok: true };
  }
}

/** Fake session store. */
class FakeSessionStore {
  private sessions = new Map<number, unknown>();
  get(chatId: number): unknown | undefined { return this.sessions.get(chatId); }
  set(chatId: number, state: unknown): void { this.sessions.set(chatId, state); }
}

/** Arma UnifiedEntryState inicial para personas. */
function personState() {
  return {
    flow: "unified_entry" as const,
    domain: "person" as const,
    step: "collecting" as const,
    draft: {},
  };
}

/** Arma UnifiedEntryState inicial para mascotas. */
function petState() {
  return {
    flow: "unified_entry" as const,
    domain: "pet" as const,
    step: "collecting" as const,
    draft: {},
  };
}

/** Update de texto de Telegram. */
function textUpdate(chatId: number, text: string): unknown {
  return {
    update_id: 1,
    message: { chat: { id: chatId }, text },
  };
}

function makeDeps(transport: FakeTransport, backend: FakeBackend, sessions: FakeSessionStore): UnifiedEntryHandlerDeps {
  return {
    transport: transport as unknown as UnifiedEntryHandlerDeps["transport"],
    backend: backend as unknown as UnifiedEntryHandlerDeps["backend"],
    sessions: sessions as unknown as UnifiedEntryHandlerDeps["sessions"],
  };
}

describe("handleUnifiedEntryUpdate", () => {
  it("retorna false si la sesion no esta en flujo unified_entry", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    const sessions = new FakeSessionStore();
    // No sesion = flujo idle (la maquina normal lo maneja)
    sessions.set(CHAT_ID, { flow: "idle" });
    const deps = makeDeps(transport, backend, sessions);

    const result = await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "hola"), deps);
    expect(result).toBe(false);
  });

  it("retorna false si el update no es un mensaje de texto", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    const sessions = new FakeSessionStore();
    sessions.set(CHAT_ID, personState());
    const deps = makeDeps(transport, backend, sessions);

    // Update sin campo message
    const result = await handleUnifiedEntryUpdate({ update_id: 1 }, deps);
    expect(result).toBe(false);
  });

  it("retorna true y ejecuta busqueda cuando recibe texto en collecting", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    backend.searchPersonsResults = [syntheticCandidate()];
    const sessions = new FakeSessionStore();
    sessions.set(CHAT_ID, personState());
    const deps = makeDeps(transport, backend, sessions);

    const result = await handleUnifiedEntryUpdate(
      textUpdate(CHAT_ID, "Maria norte"),
      deps,
    );
    expect(result).toBe(true);
    // Debe enviar al menos un mensaje (la pregunta de confirmacion)
    expect(transport.sent.length).toBeGreaterThan(0);
  });

  it("la respuesta de confirmacion no expone PII (sin telefono de 10+ digitos)", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    // El candidato sintetico NO debe tener ningun campo de contacto
    backend.searchPersonsResults = [
      syntheticCandidate({ contact_id: "must-not-appear", channel_id: "must-not-appear" }),
    ];
    const sessions = new FakeSessionStore();
    sessions.set(CHAT_ID, personState());
    const deps = makeDeps(transport, backend, sessions);

    await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "Maria norte"), deps);
    const allText = transport.allText();
    expect(allText).not.toMatch(/\d{10,}/);
    expect(allText).not.toContain("must-not-appear");
  });

  it("cuando no hay resultados de busqueda, pregunta si quiere registrar", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    backend.searchPersonsResults = []; // sin coincidencias
    const sessions = new FakeSessionStore();
    sessions.set(CHAT_ID, personState());
    const deps = makeDeps(transport, backend, sessions);

    await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "nombre imaginario"), deps);
    const allText = transport.allText();
    expect(allText).toMatch(/registrar|registro/i);
  });

  it("B-1 dedup: la suscripcion al caso NO menciona relay ni otro buscador", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    backend.searchPersonsResults = [syntheticCandidate()];
    const sessions = new FakeSessionStore();
    sessions.set(CHAT_ID, personState());
    const deps = makeDeps(transport, backend, sessions);

    // Primer paso: text -> busqueda -> candidato presentado
    await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "Maria norte"), deps);

    // Segundo paso: confirmar "si"
    await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "si"), deps);

    // Tercer paso: el backend llama a subscribeToCase
    expect(backend.subscribeInterestCalls.length).toBe(1);
    expect(backend.subscribeInterestCalls[0]!.caseId).toBe(SYNTH_CASE_ID);

    // La respuesta NO debe mencionar "otro buscador" ni "contacto del buscador"
    const allText = transport.allText();
    expect(allText).not.toMatch(/otro buscador|contacto del buscador|relay/i);
  });

  it("flujo completo mascota: texto → busqueda → confirma Si → suscripcion", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    const mascotaCandidate = syntheticCandidate({
      nombre: "Firulais Sintetico",
      tipo: "perro",
      raza: "mestizo",
    });
    backend.searchPetResults = [mascotaCandidate];
    const sessions = new FakeSessionStore();
    sessions.set(CHAT_ID, petState());
    const deps = makeDeps(transport, backend, sessions);

    // Texto libre sobre la mascota
    await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "perro mestizo zona norte"), deps);
    // La respuesta debe mencionar mascota
    expect(transport.allText()).toMatch(/mascota/i);

    // Confirmar que es la misma mascota
    await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "si"), deps);

    // Se llama subscribeToCase con el dominio "pet"
    expect(backend.subscribeInterestCalls.length).toBe(1);
    expect(backend.subscribeInterestCalls[0]!.caseId).toBe(SYNTH_CASE_ID);
  });

  it("no_match + confirmacion → transiciona al flujo register de la maquina", async () => {
    const transport = new FakeTransport();
    const backend = new FakeBackend();
    backend.searchPersonsResults = []; // sin coincidencias
    const sessions = new FakeSessionStore();
    sessions.set(CHAT_ID, personState());
    const deps = makeDeps(transport, backend, sessions);

    // Texto → sin resultados → pregunta si quiere registrar
    await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "nombre que no existe"), deps);

    // Responde "si" → debe transicionar al flujo register
    await handleUnifiedEntryUpdate(textUpdate(CHAT_ID, "si"), deps);

    // El nuevo estado debe ser el flujo register
    const newState = sessions.get(CHAT_ID) as { flow: string };
    expect(newState.flow).toBe("register");

    // Se debe pedir el nombre
    expect(transport.allText()).toMatch(/nombre/i);
  });
});
