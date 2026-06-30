import { describe, expect, it } from "vitest";
import type { NotificationRepo } from "db";
import type {
  CheckRiskAlertDeps,
  CheckRiskAlertInput,
} from "../src/services/risk-alerts.js";
import { checkRiskAlert } from "../src/services/risk-alerts.js";

// Tests de checkRiskAlert (Slice E — heuristica de fan-out).
// Strict TDD — estos tests se escriben ANTES de la implementacion (RED).
//
// PRIVACIDAD CRITICA: el payload de la alerta al operador contiene SOLO
// searcher_id + count + ventana. NUNCA phone, nombre, ubicacion.
//
// La alerta es ADVISORY: nunca interrumpe relays existentes ni gatea el flujo.

const SYNTH_SEARCHER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SYNTH_OPERATOR_CHANNEL = "bbbbbbbb-0000-4000-8000-000000000002";

interface CreatedNotification {
  channel_id: string;
  tipo: string;
  payload: Record<string, unknown>;
}

function makeFakeNotificationRepo(): NotificationRepo & {
  created: CreatedNotification[];
} {
  const created: CreatedNotification[] = [];
  return {
    created,
    async create(input) {
      created.push({
        channel_id: input.channel_id,
        tipo: input.tipo,
        payload: input.payload as Record<string, unknown>,
      });
    },
    async listPending() {
      return [];
    },
    async markSent() {},
    async markFailed() {},
  };
}

function makeBaseDeps(overrides: Partial<CheckRiskAlertDeps> = {}): CheckRiskAlertDeps {
  return {
    notificationRepo: makeFakeNotificationRepo(),
    operatorChannelId: SYNTH_OPERATOR_CHANNEL,
    autoFanoutThreshold: 3,
    ...overrides,
  };
}

function makeInput(overrides: Partial<CheckRiskAlertInput> = {}): CheckRiskAlertInput {
  return {
    searcherId: SYNTH_SEARCHER_ID,
    consentCountLast24h: 0,
    windowHours: 24,
    ...overrides,
  };
}

// ── Umbral no alcanzado → sin alerta ─────────────────────────────────────────

describe("checkRiskAlert — sin alerta bajo umbral", () => {
  it("count < threshold → no envia notificacion", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo, autoFanoutThreshold: 3 });

    const result = await checkRiskAlert(deps, makeInput({ consentCountLast24h: 2 }));

    expect(result.alertSent).toBe(false);
    expect(notifRepo.created).toHaveLength(0);
  });

  it("count === 0 → sin alerta", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo });

    const result = await checkRiskAlert(deps, makeInput({ consentCountLast24h: 0 }));

    expect(result.alertSent).toBe(false);
    expect(notifRepo.created).toHaveLength(0);
  });
});

// ── Umbral alcanzado o superado → alerta al operador ─────────────────────────

describe("checkRiskAlert — alerta al operador en fan-out", () => {
  it("count === threshold → envia alerta", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo, autoFanoutThreshold: 3 });

    const result = await checkRiskAlert(deps, makeInput({ consentCountLast24h: 3 }));

    expect(result.alertSent).toBe(true);
    expect(notifRepo.created).toHaveLength(1);
  });

  it("count > threshold → envia alerta", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo, autoFanoutThreshold: 3 });

    const result = await checkRiskAlert(deps, makeInput({ consentCountLast24h: 10 }));

    expect(result.alertSent).toBe(true);
    expect(notifRepo.created).toHaveLength(1);
  });

  it("la alerta se envia al operador (operatorChannelId), no al buscador", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo, autoFanoutThreshold: 3 });

    await checkRiskAlert(deps, makeInput({ consentCountLast24h: 5 }));

    expect(notifRepo.created[0]?.channel_id).toBe(SYNTH_OPERATOR_CHANNEL);
  });

  it("tipo de notificacion es 'alerta'", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo, autoFanoutThreshold: 3 });

    await checkRiskAlert(deps, makeInput({ consentCountLast24h: 5 }));

    expect(notifRepo.created[0]?.tipo).toBe("alerta");
  });
});

// ── PRIVACIDAD CRITICA: payload no contiene PII ───────────────────────────────

describe("checkRiskAlert — payload solo contiene searcher_id + count + ventana (SIN PII)", () => {
  it("payload contiene searcherId, count y windowHours", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo, autoFanoutThreshold: 3 });

    await checkRiskAlert(deps, makeInput({ consentCountLast24h: 5, windowHours: 24 }));

    const payload = notifRepo.created[0]?.payload as {
      searcherId?: string;
      count?: number;
      windowHours?: number;
    };
    expect(payload?.searcherId).toBe(SYNTH_SEARCHER_ID);
    expect(payload?.count).toBe(5);
    expect(payload?.windowHours).toBe(24);
  });

  it("payload NO contiene phone, nombre ni ubicacion", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo, autoFanoutThreshold: 3 });

    await checkRiskAlert(deps, makeInput({ consentCountLast24h: 5 }));

    const payload = notifRepo.created[0]?.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("phone");
    expect(payload).not.toHaveProperty("nombre");
    expect(payload).not.toHaveProperty("ubicacion");
    expect(payload).not.toHaveProperty("chatId");
  });
});

// ── Advisory: nunca interrumpe relays existentes ──────────────────────────────

describe("checkRiskAlert — advisory, nunca gatea", () => {
  it("alerta enviada pero resultado no bloquea flujo (no lanza, no modifica estado)", async () => {
    const notifRepo = makeFakeNotificationRepo();
    const deps = makeBaseDeps({ notificationRepo: notifRepo, autoFanoutThreshold: 3 });

    // Debe completarse sin lanzar, aunque el count sea muy alto
    await expect(
      checkRiskAlert(deps, makeInput({ consentCountLast24h: 999 })),
    ).resolves.toBeDefined();
  });

  it("si operatorChannelId es null → no lanza (sin operador configurado)", async () => {
    const deps = makeBaseDeps({ operatorChannelId: null });

    const result = await checkRiskAlert(deps, makeInput({ consentCountLast24h: 5 }));
    // Sin canal de operador, no puede enviar alerta pero no debe lanzar
    expect(result.alertSent).toBe(false);
  });
});
