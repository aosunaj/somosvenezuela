import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppDeps } from "../src/deps.js";
import type { Search } from "core";

// Tests para la lógica de es_menor server-side en POST /searches (judgment-r3 item 5).
//
// El backend DEBE establecer es_menor=true server-side si isMinorByContactId retorna
// true para el buscador_contact_id, INDEPENDIENTEMENTE de lo que el cliente envíe.
// La auto-declaración del buscador puede AÑADIR señal de menor (true es true), pero
// un false del cliente no puede cancelar un true del server (conservativo siempre).

const SYNTH_CONTACT = "d0000001-0000-4000-8000-000000000001";
const SYNTH_CHANNEL = "e0000001-0000-4000-8000-000000000001";
const SYNTH_SEARCH_ID = "f0000001-0000-4000-8000-000000000001";

function makeSearch(overrides: Partial<Search> = {}): Search {
  return {
    id: SYNTH_SEARCH_ID,
    tipo: "persona",
    target_nombre: "Juan Prueba",
    target_descripcion: null,
    zona: null,
    buscador_contact_id: SYNTH_CONTACT,
    es_menor: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeDeps(isMinorResult = false): AppDeps {
  return {
    personRepo: {
      searchPersonsPublic: vi.fn().mockResolvedValue([]),
      isMinorById: vi.fn().mockResolvedValue(false),
      getVerificationStatus: vi.fn().mockResolvedValue(null),
    } as unknown as AppDeps["personRepo"],
    searchRepo: {
      create: vi.fn().mockImplementation(async (input) =>
        makeSearch({ es_menor: input.es_menor ?? false }),
      ),
      isMinorByContactId: vi.fn().mockResolvedValue(isMinorResult),
    } as unknown as AppDeps["searchRepo"],
    petRepo: {} as AppDeps["petRepo"],
    petSearchRepo: {} as AppDeps["petSearchRepo"],
    zoneRepo: {} as AppDeps["zoneRepo"],
    needRepo: {} as AppDeps["needRepo"],
    channelLinkRepo: {
      ensureChannel: vi.fn().mockResolvedValue({
        contactId: SYNTH_CONTACT,
        channelId: SYNTH_CHANNEL,
      }),
    } as unknown as AppDeps["channelLinkRepo"],
    channelRepo: {} as AppDeps["channelRepo"],
    notificationRepo: {
      create: vi.fn().mockResolvedValue({ id: "n-1" }),
    } as unknown as AppDeps["notificationRepo"],
    matchRepo: {
      create: vi.fn().mockResolvedValue({ id: "m-1" }),
      listBySearch: vi.fn().mockResolvedValue([]),
    } as unknown as AppDeps["matchRepo"],
    secureDeleteRepo: {} as AppDeps["secureDeleteRepo"],
    personStateAuditRepo: {} as AppDeps["personStateAuditRepo"],
    relayRepo: {} as AppDeps["relayRepo"],
    auditRepo: {
      writeRouteDecision: vi.fn().mockResolvedValue(undefined),
      writeConsentStateChange: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppDeps["auditRepo"],
    consentRepo: {} as AppDeps["consentRepo"],
    autoMatchThreshold: 0.85,
    serviceToken: "test-token",
  };
}

describe("POST /searches — es_menor server-side (judgment-r3 item 5)", () => {
  it("cuando isMinorByContactId=true, crea la busqueda con es_menor=true ignorando el false del cliente", async () => {
    const deps = makeDeps(true); // isMinorByContactId = true
    const app = await buildApp(deps);

    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: {
        tipo: "persona",
        target_nombre: "Juan Prueba",
        es_menor: false, // cliente dice false
        channel: {
          plataforma: "telegram",
          chatId: "12345",
        },
      },
    });

    expect(res.statusCode).toBe(201);

    const createCall = (deps.searchRepo as { create: ReturnType<typeof vi.fn> }).create;
    const callArgs = createCall.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    // El server debe haber establecido es_menor=true (override del cliente)
    expect(callArgs?.es_menor).toBe(true);
  });

  it("cuando isMinorByContactId=false y el cliente envia es_menor=true, se preserva el true (additive)", async () => {
    const deps = makeDeps(false);
    const app = await buildApp(deps);

    const res = await app.inject({
      method: "POST",
      url: "/searches",
      payload: {
        tipo: "persona",
        target_nombre: "Maria Prueba",
        es_menor: true, // cliente dice true
        channel: {
          plataforma: "telegram",
          chatId: "67890",
        },
      },
    });

    expect(res.statusCode).toBe(201);

    const createCall = (deps.searchRepo as { create: ReturnType<typeof vi.fn> }).create;
    const callArgs = createCall.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    // true cliente + false server = true (OR conservativo)
    expect(callArgs?.es_menor).toBe(true);
  });

  it("sin canal, no llama isMinorByContactId (no hay buscador_contact_id)", async () => {
    const deps = makeDeps(false);
    const app = await buildApp(deps);

    await app.inject({
      method: "POST",
      url: "/searches",
      payload: {
        tipo: "persona",
        target_nombre: "Carlos Prueba",
        es_menor: false,
        // sin channel
      },
    });

    const isMinorCall = (deps.searchRepo as { isMinorByContactId: ReturnType<typeof vi.fn> }).isMinorByContactId;
    expect(isMinorCall).not.toHaveBeenCalled();
  });
});
