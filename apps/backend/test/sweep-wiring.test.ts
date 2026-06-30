import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// [TDD-RED] Tests for sweep wiring pattern and consent repo extension.
//
// judgment-r3 item 11: sweepExpiredConsents is a STANDALONE backend task,
// registered via setInterval at Fastify boot. NOT in the Telegram poller.
//
// Verifies:
//   1. The SweepExpiredConsentsDeps interface works with consent repo methods.
//   2. The setInterval wiring pattern is safe (best-effort, non-blocking).

describe("Sweep wiring — setInterval pattern", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sweepExpiredConsents fires on each interval tick", async () => {
    const { sweepExpiredConsents } = await import("../src/services/sweep.js");

    let callCount = 0;
    const deps = {
      notificationRepo: {
        async create() {},
      },
      async getExpiredPendingConsents() {
        callCount++;
        return [];
      },
      async markConsentExpired(_id: string) {},
    };

    const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const intervalId = setInterval(async () => {
      await sweepExpiredConsents(deps).catch(() => undefined);
    }, SWEEP_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(callCount).toBe(1);

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(callCount).toBe(2);

    clearInterval(intervalId);
  });

  it("sweep interval does not throw when sweep fails (best-effort)", async () => {
    const { sweepExpiredConsents } = await import("../src/services/sweep.js");

    let callCount = 0;
    const deps = {
      notificationRepo: {
        async create() {},
      },
      async getExpiredPendingConsents() {
        callCount++;
        throw new Error("BD error simulado");
      },
      async markConsentExpired(_id: string) {},
    };

    const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const intervalId = setInterval(async () => {
      await sweepExpiredConsents(deps).catch(() => undefined);
    }, SWEEP_INTERVAL_MS);

    // Does not throw — just advances time and verifies the call happened
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(callCount).toBe(1);

    clearInterval(intervalId);
  });
});
