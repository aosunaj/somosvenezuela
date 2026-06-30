import { describe, expect, it, vi } from "vitest";
import { handleUpdate } from "../src/handle-update.js";
import type { UpdateDeps } from "../src/handle-update.js";
import type { ActiveRelayInfo } from "../src/ports.js";

// Tests del handler /compartir_contacto en el bot-telegram (PR7).
//
// /compartir_contacto: comando global (como /cancelar) que pide al backend
// el revelado bilateral del contacto en el relay activo del canal.
//
// Comportamiento esperado:
//   - Si NO hay relay activo: mensaje de error amable (no hay conexion activa).
//   - Si hay relay activo: llama requestRelayReveal y muestra el mensaje segun status.
//   - Backend falla: mensaje de error amable, sin filtrar detalles.
//
// Datos sinteticos: sin PII real.

const RELAY_ID = "e0000007-0000-4000-8000-000000000007";
const CHAT_ID = 7_000_001;

function makeUpdate(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: CHAT_ID, type: "private" },
      date: 0,
      text,
    },
  };
}

function makeDeps(opts: {
  activeRelay?: ActiveRelayInfo | null;
  revealThrows?: boolean;
} = {}): UpdateDeps {
  const activeRelay =
    opts.activeRelay !== undefined
      ? opts.activeRelay
      : { relayId: RELAY_ID, otherChannelId: "other-ch" };

  return {
    transport: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    sessions: {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    },
    backend: {
      getActiveRelay: vi.fn().mockResolvedValue(activeRelay),
      requestRelayReveal: opts.revealThrows
        ? vi.fn().mockRejectedValue(new Error("backend error"))
        : vi.fn().mockResolvedValue(undefined),
      forwardRelayMessage: vi.fn(),
      closeRelay: vi.fn(),
      respondConsent: vi.fn(),
      sweepConsent: vi.fn(),
      createPerson: vi.fn(),
      registerPerson: vi.fn(),
      registerPet: vi.fn(),
      deleteByChannel: vi.fn(),
      markFoundByChannel: vi.fn(),
      listMyPersons: vi.fn(),
      searchPersons: vi.fn(),
      searchPets: vi.fn(),
      requestReunion: vi.fn(),
      reunionConsent: vi.fn(),
      listZones: vi.fn(),
      listNeeds: vi.fn(),
      reportRescatado: vi.fn(),
    },
  };
}

describe("/compartir_contacto handler (bot-telegram)", () => {
  it("llama requestRelayReveal con el relay activo y envia mensaje de exito", async () => {
    const deps = makeDeps();
    await handleUpdate(makeUpdate("/compartir_contacto"), deps);

    expect(
      (deps.backend as { requestRelayReveal: ReturnType<typeof vi.fn> })
        .requestRelayReveal,
    ).toHaveBeenCalledOnce();

    const calls = (
      deps.transport as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage.mock.calls as Array<[number, string]>;
    expect(calls.length).toBeGreaterThan(0);
    // El mensaje no debe contener datos de contacto de la otra parte
    for (const [, msg] of calls) {
      expect(msg).not.toMatch(/\+58|0412|0414|0416|0424|0426/);
    }
  });

  it("si no hay relay activo: envia mensaje de error amable sin llamar requestRelayReveal", async () => {
    const deps = makeDeps({ activeRelay: null });
    await handleUpdate(makeUpdate("/compartir_contacto"), deps);

    expect(
      (deps.backend as { requestRelayReveal: ReturnType<typeof vi.fn> })
        .requestRelayReveal,
    ).not.toHaveBeenCalled();

    const calls = (
      deps.transport as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage.mock.calls as Array<[number, string]>;
    expect(calls.length).toBe(1);
    // Mensaje amable, sin PII
    expect(calls[0]![1]).toBeTruthy();
  });

  it("si el backend lanza: envia mensaje de error amable y no propaga el error", async () => {
    const deps = makeDeps({ revealThrows: true });
    // No debe lanzar
    await expect(
      handleUpdate(makeUpdate("/compartir_contacto"), deps),
    ).resolves.not.toThrow();

    const calls = (
      deps.transport as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage.mock.calls as Array<[number, string]>;
    expect(calls.length).toBe(1);
    expect(calls[0]![1]).toBeTruthy();
  });

  it("el comando /compartir_contacto con @bot sigue funcionando", async () => {
    const deps = makeDeps();
    await handleUpdate(makeUpdate("/compartir_contacto@somosvenezuelabot"), deps);

    expect(
      (deps.backend as { requestRelayReveal: ReturnType<typeof vi.fn> })
        .requestRelayReveal,
    ).toHaveBeenCalledOnce();
  });
});
