import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/client.js";
import { createChannelLinkRepo } from "../src/repos/channel-link.js";

// Tests del helper de vinculo contacto<->canal con un fake DbClient PROPIO (no toca
// los fakes compartidos). Datos SINTETICOS (guardrail #1: sin PII real).

const SYNTH_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const SYNTH_CHANNEL_ID = "e0000000-0000-4000-8000-000000000001";

interface ChannelRowSeed {
  id: string;
  contact_id: string;
  plataforma: string;
  chat_id: string;
  opt_in: boolean;
  created_at: string;
}

interface Captured {
  inserts: Array<{ relation: string; values: Record<string, unknown> }>;
  fromRelations: string[];
}

/**
 * Fake DbClient parametrizable: `existingChannel` simula que el canal ya existe
 * (idempotencia). Captura inserts para aserciones. La cadena fluida cubre solo lo
 * que channel-link y los repos contact/channel usan.
 */
function makeFakeClient(
  existingChannel: ChannelRowSeed | null,
  captured: Captured,
): DbClient {
  const makeBuilder = (relation: string): Record<string, unknown> => {
    let pendingInsert: Record<string, unknown> | null = null;

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      insert: (values: Record<string, unknown>) => {
        pendingInsert = values;
        captured.inserts.push({ relation, values });
        return builder;
      },
      // maybeSingle: usada por findChannelRow (channels) -> canal existente o null.
      maybeSingle: () =>
        Promise.resolve({
          data: relation === "channels" ? existingChannel : null,
          error: null,
        }),
      // single: usada tras insert por contact/channel repos -> devuelve fila creada.
      single: () => {
        if (relation === "contacts") {
          return Promise.resolve({
            data: { id: SYNTH_CONTACT_ID, ...(pendingInsert ?? {}) },
            error: null,
          });
        }
        if (relation === "channels") {
          return Promise.resolve({
            data: {
              id: SYNTH_CHANNEL_ID,
              contact_id: (pendingInsert?.["contact_id"] as string) ?? SYNTH_CONTACT_ID,
              plataforma: (pendingInsert?.["plataforma"] as string) ?? "telegram",
              chat_id: (pendingInsert?.["chat_id"] as string) ?? "chat",
              opt_in: (pendingInsert?.["opt_in"] as boolean) ?? true,
              created_at: "2026-01-01T00:00:00.000Z",
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  };

  const client = {
    from(relation: string) {
      captured.fromRelations.push(relation);
      return makeBuilder(relation);
    },
  };
  return client as unknown as DbClient;
}

describe("channelLinkRepo.ensureChannel", () => {
  it("crea contact + channel (opt_in) cuando el canal no existe", async () => {
    const captured: Captured = { inserts: [], fromRelations: [] };
    const repo = createChannelLinkRepo(makeFakeClient(null, captured));

    const link = await repo.ensureChannel({
      plataforma: "telegram",
      chatId: "tg-12345",
      telefono: "+580000000000",
    });

    expect(link.contactId).toBe(SYNTH_CONTACT_ID);
    expect(link.channelId).toBe(SYNTH_CHANNEL_ID);

    // Inserto un contacto y un canal.
    const contactInsert = captured.inserts.find((i) => i.relation === "contacts");
    const channelInsert = captured.inserts.find((i) => i.relation === "channels");
    expect(contactInsert?.values).toMatchObject({ telefono: "+580000000000" });
    expect(channelInsert?.values).toMatchObject({
      contact_id: SYNTH_CONTACT_ID,
      plataforma: "telegram",
      chat_id: "tg-12345",
      opt_in: true,
    });
  });

  it("reutiliza contacto y canal existentes (idempotente, no inserta)", async () => {
    const captured: Captured = { inserts: [], fromRelations: [] };
    const existing: ChannelRowSeed = {
      id: SYNTH_CHANNEL_ID,
      contact_id: SYNTH_CONTACT_ID,
      plataforma: "telegram",
      chat_id: "tg-12345",
      opt_in: true,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const repo = createChannelLinkRepo(makeFakeClient(existing, captured));

    const link = await repo.ensureChannel({ plataforma: "telegram", chatId: "tg-12345" });

    expect(link).toEqual({ contactId: SYNTH_CONTACT_ID, channelId: SYNTH_CHANNEL_ID });
    expect(captured.inserts).toHaveLength(0);
  });

  it("usa el chatId como identificador de contacto si no llega telefono", async () => {
    const captured: Captured = { inserts: [], fromRelations: [] };
    const repo = createChannelLinkRepo(makeFakeClient(null, captured));

    await repo.ensureChannel({ plataforma: "whatsapp", chatId: "wa-999" });

    const contactInsert = captured.inserts.find((i) => i.relation === "contacts");
    expect(contactInsert?.values).toMatchObject({ telefono: "wa-999" });
  });
});

describe("channelLinkRepo.findContactByChannel", () => {
  it("resuelve el contacto dueno del canal", async () => {
    const existing: ChannelRowSeed = {
      id: SYNTH_CHANNEL_ID,
      contact_id: SYNTH_CONTACT_ID,
      plataforma: "telegram",
      chat_id: "tg-12345",
      opt_in: true,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const repo = createChannelLinkRepo(
      makeFakeClient(existing, { inserts: [], fromRelations: [] }),
    );

    const contactId = await repo.findContactByChannel("telegram", "tg-12345");
    expect(contactId).toBe(SYNTH_CONTACT_ID);
  });

  it("devuelve null si el canal no existe", async () => {
    const repo = createChannelLinkRepo(
      makeFakeClient(null, { inserts: [], fromRelations: [] }),
    );

    const contactId = await repo.findContactByChannel("telegram", "desconocido");
    expect(contactId).toBeNull();
  });
});
