import { describe, expect, it } from "vitest";
import {
  pollOnce,
  type MessageSender,
  type NotificationsClient,
  type PendingNotification,
  type PollerLogger,
} from "../src/notification-poller.js";

// Pruebas de la logica pura del poller de notificaciones (sin red ni timers).
// Espejo de los del bot de Telegram: verifican que entrega solo lo de su plataforma,
// marca como enviado solo tras un envio exitoso, y degrada con seguridad ante fallos.

// ── Dobles en memoria ──────────────────────────────────────────────────────────

class FakeNotificationsClient implements NotificationsClient {
  readonly marked: string[] = [];
  readonly markAttempts: string[] = [];
  #pending: PendingNotification[];
  #failMark: Set<string>;
  readonly #failFetch: boolean;

  constructor(
    pending: PendingNotification[],
    opts: { failMark?: readonly string[]; failFetch?: boolean } = {},
  ) {
    this.#pending = pending;
    this.#failMark = new Set(opts.failMark ?? []);
    this.#failFetch = opts.failFetch ?? false;
  }

  async fetchPending(): Promise<readonly PendingNotification[]> {
    if (this.#failFetch) throw new Error("backend caido (sintetico)");
    return this.#pending;
  }

  async markSent(id: string): Promise<void> {
    this.markAttempts.push(id);
    if (this.#failMark.has(id)) throw new Error("marcado fallido (sintetico)");
    this.marked.push(id);
  }

  /** Permite que un id que antes fallaba al marcar ahora tenga exito. */
  stopFailingMark(id: string): void {
    this.#failMark.delete(id);
  }
}

interface SentMessage {
  readonly chatId: string;
  readonly text: string;
}

class FakeSender implements MessageSender {
  readonly sent: SentMessage[] = [];
  readonly #failFor: Set<string>;

  constructor(failForChatIds: readonly string[] = []) {
    this.#failFor = new Set(failForChatIds);
  }

  async send(chatId: string, text: string): Promise<void> {
    if (this.#failFor.has(chatId)) throw new Error("envio fallido (sintetico)");
    this.sent.push({ chatId, text });
  }
}

/** Logger silencioso: no queremos ruido en la salida de los tests. */
const silentLogger: PollerLogger = { error: (): void => undefined };

// chat_id sintetico (wa_id como cadena, numero internacional sin +, no PII real).
const WA_A = "10000000001";
const WA_B = "10000000002";

function notif(
  overrides: Partial<PendingNotification> & { id: string },
): PendingNotification {
  return {
    plataforma: "whatsapp",
    chat_id: WA_A,
    payload: { mensaje: "Hay una novedad sobre tu busqueda." },
    ...overrides,
  };
}

describe("pollOnce", () => {
  it("entrega cada notificacion de whatsapp y la marca como enviada", async () => {
    const client = new FakeNotificationsClient([
      notif({ id: "n1", chat_id: WA_A }),
      notif({ id: "n2", chat_id: WA_B }),
    ]);
    const sender = new FakeSender();

    const outcome = await pollOnce(client, sender, silentLogger);

    expect(outcome).toEqual({ delivered: 2, skipped: 0, failed: 0 });
    expect(sender.sent).toEqual([
      { chatId: WA_A, text: "Hay una novedad sobre tu busqueda." },
      { chatId: WA_B, text: "Hay una novedad sobre tu busqueda." },
    ]);
    expect(client.marked).toEqual(["n1", "n2"]);
  });

  it("ignora las notificaciones de otra plataforma (no las envia ni las marca)", async () => {
    const client = new FakeNotificationsClient([
      notif({ id: "n1", plataforma: "telegram" }),
      notif({ id: "n2", plataforma: "whatsapp" }),
    ]);
    const sender = new FakeSender();

    const outcome = await pollOnce(client, sender, silentLogger);

    expect(outcome).toEqual({ delivered: 1, skipped: 1, failed: 0 });
    expect(sender.sent.map((m) => m.chatId)).toEqual([WA_A]);
    expect(client.marked).toEqual(["n2"]);
  });

  it("acepta el cuerpo en payload.text ademas de payload.mensaje", async () => {
    const client = new FakeNotificationsClient([
      { id: "n1", plataforma: "whatsapp", chat_id: WA_A, payload: { text: "Texto alterno." } },
    ]);
    const sender = new FakeSender();

    await pollOnce(client, sender, silentLogger);

    expect(sender.sent).toEqual([{ chatId: WA_A, text: "Texto alterno." }]);
    expect(client.marked).toEqual(["n1"]);
  });

  it("NO marca como enviada si el envio falla (se reintentara)", async () => {
    const client = new FakeNotificationsClient([notif({ id: "n1", chat_id: WA_A })]);
    const sender = new FakeSender([WA_A]);

    const outcome = await pollOnce(client, sender, silentLogger);

    expect(outcome).toEqual({ delivered: 0, skipped: 0, failed: 1 });
    expect(sender.sent).toHaveLength(0);
    expect(client.marked).toHaveLength(0);
  });

  it("no crashea ni marca si fetchPending falla", async () => {
    const client = new FakeNotificationsClient([], { failFetch: true });
    const sender = new FakeSender();

    const outcome = await pollOnce(client, sender, silentLogger);

    expect(outcome).toEqual({ delivered: 0, skipped: 0, failed: 0 });
    expect(client.marked).toHaveLength(0);
  });

  it("cuenta como fallo si entrega pero no puede marcar", async () => {
    const client = new FakeNotificationsClient([notif({ id: "n1", chat_id: WA_A })], {
      failMark: ["n1"],
    });
    const sender = new FakeSender();

    const outcome = await pollOnce(client, sender, silentLogger);

    expect(outcome).toEqual({ delivered: 0, skipped: 0, failed: 1 });
    expect(sender.sent).toHaveLength(1);
    expect(client.marked).toHaveLength(0);
  });

  it("DEDUP (FIX S2): si markSent fallo, el siguiente ciclo NO reenvia y reintenta marcar", async () => {
    const client = new FakeNotificationsClient([notif({ id: "n1", chat_id: WA_A })], {
      failMark: ["n1"],
    });
    const sender = new FakeSender();
    // El set persiste entre ciclos (como en runNotificationPoller).
    const deliveredUnmarked = new Set<string>();

    // Ciclo 1: se entrega pero el marcado falla -> queda en el set, sin reenviar.
    const first = await pollOnce(client, sender, silentLogger, deliveredUnmarked);
    expect(first).toEqual({ delivered: 0, skipped: 0, failed: 1 });
    expect(sender.sent).toHaveLength(1);
    expect(deliveredUnmarked.has("n1")).toBe(true);

    // Ciclo 2: misma notificacion sigue pendiente, pero NO se reenvia; solo se
    // reintenta el marcado. Ahora dejamos que el marcado tenga exito.
    client.stopFailingMark("n1");
    const second = await pollOnce(client, sender, silentLogger, deliveredUnmarked);

    // send NO se volvio a llamar: una sola entrega en total.
    expect(sender.sent).toHaveLength(1);
    // El marcado se reintento (2 intentos) y el segundo tuvo exito.
    expect(client.markAttempts).toEqual(["n1", "n1"]);
    expect(client.marked).toEqual(["n1"]);
    expect(second).toEqual({ delivered: 1, skipped: 0, failed: 0 });
    expect(deliveredUnmarked.has("n1")).toBe(false);
  });
});
