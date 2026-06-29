import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/client.js";
import {
  createNotificationRepo,
  type NotificationRow,
} from "../src/repos/notification.js";

// Tests de notificationRepo con un fake DbClient PROPIO (no toca fakes compartidos).
// Simula una cola en memoria: create -> listPending -> markSent. Datos SINTETICOS.
//
// FIX W1 (guardrail #1): listPending(limit, plataforma) debe FILTRAR EN BD por la
// plataforma del canal con un inner join (`channels!inner(plataforma)` +
// eq("channels.plataforma", ...)), para no exponer chat_id de una plataforma a otra.

const SYNTH_CONTACT_ID = "c0000000-0000-4000-8000-000000000001";
const SYNTH_CHANNEL_ID = "e0000000-0000-4000-8000-000000000001";

interface Capture {
  fromRelations: string[];
  updates: Array<{ values: Record<string, unknown>; id: string }>;
  eqFilters: Array<{ column: string; value: unknown }>;
  selectedColumns: string[];
}

/** Fila de prueba con la plataforma de su canal anotada (lo que el join resolveria). */
interface SeededRow {
  readonly row: NotificationRow;
  readonly plataforma: "telegram" | "whatsapp";
}

/**
 * Fake DbClient con una "tabla" en memoria de notificaciones. Soporta insert+single,
 * select+eq(estado)+order+limit (listPending) y update+eq(id) (markSent/markFailed).
 * Para FIX W1, modela el inner join: cuando el repo filtra por
 * `channels.plataforma`, el fake usa la plataforma anotada de cada fila.
 */
function makeFakeClient(
  store: NotificationRow[],
  capture: Capture,
  plataformaByChannel: ReadonlyMap<string, "telegram" | "whatsapp"> = new Map(),
): DbClient {
  let nextId = 1;

  const makeBuilder = (relation: string): Record<string, unknown> => {
    let mode: "select" | "insert" | "update" = "select";
    let insertValues: Record<string, unknown> | null = null;
    let updateValues: Record<string, unknown> | null = null;
    let estadoFilter: string | null = null;
    let idFilter: string | null = null;
    let plataformaFilter: string | null = null;

    const builder: Record<string, unknown> = {
      select: (columns?: string) => {
        if (typeof columns === "string") capture.selectedColumns.push(columns);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (values: Record<string, unknown>) => {
        mode = "insert";
        insertValues = values;
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        mode = "update";
        updateValues = values;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        capture.eqFilters.push({ column, value });
        if (column === "estado") estadoFilter = value as string;
        if (column === "id") idFilter = value as string;
        if (column === "channels.plataforma") plataformaFilter = value as string;
        // update se resuelve al encadenar .eq (no es thenable de otra forma aqui).
        if (mode === "update" && idFilter !== null && updateValues !== null) {
          const row = store.find((n) => n.id === idFilter);
          if (row) Object.assign(row, updateValues);
          capture.updates.push({ values: updateValues, id: idFilter });
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      returns: () => builder,
      single: () => {
        const row: NotificationRow = {
          id: `n${nextId++}`,
          contact_id: (insertValues?.["contact_id"] as string | null) ?? null,
          channel_id: (insertValues?.["channel_id"] as string | null) ?? null,
          tipo: (insertValues?.["tipo"] as NotificationRow["tipo"]) ?? "info",
          prioridad:
            (insertValues?.["prioridad"] as NotificationRow["prioridad"]) ?? "normal",
          payload: insertValues?.["payload"] ?? null,
          estado: "pendiente",
          created_at: "2026-01-01T00:00:00.000Z",
        };
        store.push(row);
        return Promise.resolve({ data: row, error: null });
      },
      // listPending: thenable que resuelve las pendientes. Aplica el filtro de estado
      // y, si se filtra por plataforma del canal, el inner join (excluye sin canal).
      then: (resolve: (v: unknown) => unknown) => {
        const data = store.filter((n) => {
          if (estadoFilter !== null && n.estado !== estadoFilter) return false;
          if (plataformaFilter !== null) {
            if (n.channel_id === null) return false; // inner join excluye sin canal
            if (plataformaByChannel.get(n.channel_id) !== plataformaFilter) return false;
          }
          return true;
        });
        return resolve({ data, error: null });
      },
    };
    void relation;
    return builder;
  };

  const client = {
    from(relation: string) {
      capture.fromRelations.push(relation);
      return makeBuilder(relation);
    },
  };
  return client as unknown as DbClient;
}

function emptyCapture(): Capture {
  return { fromRelations: [], updates: [], eqFilters: [], selectedColumns: [] };
}

describe("notificationRepo: ciclo create -> listPending -> markSent", () => {
  it("crea una notificacion pendiente, la lista y la marca enviada", async () => {
    const store: NotificationRow[] = [];
    const capture = emptyCapture();
    const repo = createNotificationRepo(makeFakeClient(store, capture));

    const created = await repo.create({
      contact_id: SYNTH_CONTACT_ID,
      channel_id: SYNTH_CHANNEL_ID,
      tipo: "match",
      prioridad: "alta",
      payload: { person_id: "a0000000-0000-4000-8000-000000000001" },
    });

    expect(created.estado).toBe("pendiente");
    expect(capture.fromRelations).toContain("notifications");

    const pending = await repo.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(created.id);
    // listPending filtra por estado='pendiente'.
    expect(capture.eqFilters).toContainEqual({ column: "estado", value: "pendiente" });

    await repo.markSent(created.id);
    expect(store[0]?.estado).toBe("enviada");

    // Tras enviar, ya no aparece en pendientes.
    const afterSent = await repo.listPending();
    expect(afterSent).toHaveLength(0);
  });

  it("markFailed marca la notificacion como fallida", async () => {
    const store: NotificationRow[] = [];
    const capture = emptyCapture();
    const repo = createNotificationRepo(makeFakeClient(store, capture));

    const created = await repo.create({ tipo: "info" });
    await repo.markFailed(created.id);

    expect(store[0]?.estado).toBe("fallida");
    expect(capture.updates).toContainEqual({ values: { estado: "fallida" }, id: created.id });
  });

  it("create rechaza tipo invalido (zod)", async () => {
    const repo = createNotificationRepo(makeFakeClient([], emptyCapture()));
    await expect(
      // @ts-expect-error tipo fuera del enum: la validacion zod debe rechazarlo.
      repo.create({ tipo: "spam" }),
    ).rejects.toThrow();
  });
});

describe("notificationRepo.listPending: filtro por plataforma (FIX W1)", () => {
  const CHANNEL_TG = "e0000000-0000-4000-8000-000000000001";
  const CHANNEL_WA = "e0000000-0000-4000-8000-000000000002";

  function seededStore(): NotificationRow[] {
    return [
      {
        id: "n-tg",
        contact_id: SYNTH_CONTACT_ID,
        channel_id: CHANNEL_TG,
        tipo: "match",
        prioridad: "alta",
        payload: { mensaje: "TG" },
        estado: "pendiente",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "n-wa",
        contact_id: SYNTH_CONTACT_ID,
        channel_id: CHANNEL_WA,
        tipo: "match",
        prioridad: "alta",
        payload: { mensaje: "WA" },
        estado: "pendiente",
        created_at: "2026-01-01T00:00:01.000Z",
      },
    ];
  }

  const plataformaByChannel = new Map<string, "telegram" | "whatsapp">([
    [CHANNEL_TG, "telegram"],
    [CHANNEL_WA, "whatsapp"],
  ]);

  it("sin plataforma: NO usa join (select '*') y lista todas las pendientes", async () => {
    const capture = emptyCapture();
    const repo = createNotificationRepo(
      makeFakeClient(seededStore(), capture, plataformaByChannel),
    );

    const result = await repo.listPending();

    expect(capture.selectedColumns).toContain("*");
    expect(capture.selectedColumns).not.toContain("*, channels!inner(plataforma)");
    expect(result.map((n) => n.id).sort()).toEqual(["n-tg", "n-wa"]);
  });

  it("plataforma=telegram: arma inner join, filtra channels.plataforma y excluye whatsapp", async () => {
    const capture = emptyCapture();
    const repo = createNotificationRepo(
      makeFakeClient(seededStore(), capture, plataformaByChannel),
    );

    const result = await repo.listPending(50, "telegram");

    // Inner join de PostgREST para filtrar por la plataforma del canal.
    expect(capture.selectedColumns).toContain("*, channels!inner(plataforma)");
    expect(capture.eqFilters).toContainEqual({ column: "estado", value: "pendiente" });
    expect(capture.eqFilters).toContainEqual({
      column: "channels.plataforma",
      value: "telegram",
    });
    // Solo la de telegram: la de whatsapp queda fuera (no exponemos su chat_id).
    expect(result.map((n) => n.id)).toEqual(["n-tg"]);
  });

  it("plataforma=whatsapp: excluye las de telegram", async () => {
    const capture = emptyCapture();
    const repo = createNotificationRepo(
      makeFakeClient(seededStore(), capture, plataformaByChannel),
    );

    const result = await repo.listPending(50, "whatsapp");

    expect(capture.eqFilters).toContainEqual({
      column: "channels.plataforma",
      value: "whatsapp",
    });
    expect(result.map((n) => n.id)).toEqual(["n-wa"]);
  });
});
