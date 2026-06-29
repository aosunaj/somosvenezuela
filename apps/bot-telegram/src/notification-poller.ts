import { z } from "zod";

// Entrega de notificaciones por el canal del usuario (Capa 2: reunir familias).
//
// El backend ACUMULA notificaciones pendientes (p. ej. "apareció una coincidencia
// con tu búsqueda"); este poller las RETIRA y las entrega por Telegram, marcándolas
// como enviadas solo cuando el envío tiene éxito. Así el backend no necesita hablar
// Telegram: cada bot entrega lo suyo.
//
// Diseño para ser testeable: la lógica vive en funciones puras/inyectables que reciben
// un `NotificationsClient` (lee/marca en el backend) y un `MessageSender` (envía por el
// bot). El bucle real (con intervalo y reintentos) se arma sobre ellas en `index.ts`.
//
// GUARDRAILS:
//   - El `chat_id` es dirección de transporte, NO PII a imprimir: nunca se loggea.
//   - El payload trae un mensaje humano YA seguro (sin contacto de terceros): lo
//     enviamos tal cual, sin reformatear ni añadir datos.
//   - Si el envío falla, NO marcamos `sent`: el backend la reintentará en el próximo
//     ciclo (entrega "al menos una vez"). Degradación segura: un fallo no tumba el loop.

/** Plataforma de este adaptador: solo entregamos las notificaciones marcadas así. */
const PLATAFORMA = "telegram" as const;

// ── Forma de las notificaciones del backend (saneada con zod) ─────────────────

/**
 * Notificación pendiente tal como la devuelve el backend. Validamos lo que
 * consumimos y toleramos campos extra (el backend puede añadir metadatos). El
 * `payload` trae el texto humano a entregar; aceptamos `mensaje` o `text` como
 * clave del cuerpo, y exigimos al menos uno no vacío para tener algo que enviar.
 */
const notificationSchema = z.object({
  id: z.string(),
  plataforma: z.string(),
  chat_id: z.string(),
  tipo: z.string().optional(),
  prioridad: z.string().optional(),
  payload: z
    .object({
      mensaje: z.string().optional(),
      text: z.string().optional(),
    })
    .passthrough(),
});

const pendingResponseSchema = z.object({
  notifications: z.array(notificationSchema),
});

export type PendingNotification = z.infer<typeof notificationSchema>;

// ── Puertos inyectables ───────────────────────────────────────────────────────

/**
 * Cliente del backend para notificaciones. Autentica con un `service-token`
 * (no es identidad de usuario): el adaptador es un servicio de confianza.
 */
export interface NotificationsClient {
  fetchPending(): Promise<readonly PendingNotification[]>;
  markSent(id: string): Promise<void>;
}

/** Envío saliente por el bot: entrega un texto a un chat (id como cadena). */
export interface MessageSender {
  send(chatId: string, text: string): Promise<void>;
}

/** Logger mínimo inyectable (por defecto, la consola). Nunca recibe PII. */
export interface PollerLogger {
  error(message: string): void;
}

const consoleLogger: PollerLogger = {
  error: (message: string): void => console.error(message),
};

// ── Lógica pura de un ciclo ────────────────────────────────────────────────────

/** Extrae el texto a enviar del payload (mensaje | text). `null` si no hay cuerpo. */
function extractText(n: PendingNotification): string | null {
  const mensaje = n.payload.mensaje;
  if (typeof mensaje === "string" && mensaje.length > 0) return mensaje;
  const text = n.payload.text;
  if (typeof text === "string" && text.length > 0) return text;
  return null;
}

/** Resultado agregado de un ciclo (útil para tests y para no loggear de más). */
export interface PollOutcome {
  /** Notificaciones entregadas y marcadas como enviadas con éxito. */
  readonly delivered: number;
  /** Notificaciones de otra plataforma, ignoradas en este bot. */
  readonly skipped: number;
  /** Fallos de entrega/marcado (NO marcadas; se reintentarán). */
  readonly failed: number;
}

/**
 * Ejecuta UN ciclo de entrega:
 *   1. Lee las pendientes del backend.
 *   2. Filtra solo las de ESTA plataforma (telegram).
 *   3. Entrega cada una por el sender; al éxito, marca `sent` en el backend.
 *
 * No lanza: un fallo en una notificación no impide procesar las demás ni rompe el
 * bucle. Las fallidas quedan sin marcar para que el backend las reintente.
 *
 * DEDUP "casi-una-vez" (en el proceso): si una notificación se ENTREGÓ pero su
 * `markSent` falló, su id queda en `deliveredUnmarked` (compartido entre ciclos por
 * `runNotificationPoller`). En el próximo ciclo NO se reenvía: solo se reintenta el
 * `markSent`. Así un mensaje urgente no llega dos veces, lo que en crisis angustia.
 */
export async function pollOnce(
  client: NotificationsClient,
  sender: MessageSender,
  logger: PollerLogger = consoleLogger,
  deliveredUnmarked: Set<string> = new Set(),
): Promise<PollOutcome> {
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  let pending: readonly PendingNotification[];
  try {
    pending = await client.fetchPending();
  } catch {
    // No pudimos leer pendientes: salimos en silencio (sin PII) y reintentamos luego.
    logger.error("[bot-telegram] No se pudieron leer notificaciones pendientes.");
    return { delivered: 0, skipped: 0, failed: 0 };
  }

  for (const n of pending) {
    if (n.plataforma !== PLATAFORMA) {
      skipped += 1;
      continue;
    }

    // Ya entregada en un ciclo anterior pero sin marcar: NO reenviar. Solo reintentar
    // el marcado, para no entregar el mismo mensaje dos veces.
    if (deliveredUnmarked.has(n.id)) {
      try {
        await client.markSent(n.id);
        deliveredUnmarked.delete(n.id);
        delivered += 1;
      } catch {
        // Sigue sin poder marcarse: queda en el set para reintentar; nunca se reenvía.
        failed += 1;
        logger.error("[bot-telegram] Reintento de marcado de una notificación ya entregada falló.");
      }
      continue;
    }

    const text = extractText(n);
    if (text === null) {
      // Sin cuerpo no hay nada que entregar; la marcamos para no reintentar en bucle.
      try {
        await client.markSent(n.id);
      } catch {
        failed += 1;
        logger.error("[bot-telegram] Fallo al marcar una notificación sin cuerpo.");
      }
      continue;
    }

    try {
      // El chat_id es transporte; el texto ya viene seguro desde el backend.
      await sender.send(n.chat_id, text);
    } catch {
      // Envío fallido: NO marcamos sent ni la añadimos al set; el backend la
      // reintentará. Sin PII en el log.
      failed += 1;
      logger.error("[bot-telegram] Fallo al entregar una notificación; se reintentará.");
      continue;
    }

    // Entregada: la registramos como "entregada pero aún sin confirmar" ANTES de
    // marcar, para que un fallo de marcado no provoque un reenvío en el próximo ciclo.
    deliveredUnmarked.add(n.id);
    try {
      await client.markSent(n.id);
      deliveredUnmarked.delete(n.id);
      delivered += 1;
    } catch {
      // Se entregó pero no pudimos marcarla: queda en el set. El próximo ciclo NO la
      // reenvía, solo reintenta el marcado. Lo contamos como fallo de marcado, sin PII.
      failed += 1;
      logger.error("[bot-telegram] Notificación entregada pero no se pudo marcar como enviada.");
    }
  }

  return { delivered, skipped, failed };
}

// ── Bucle continuo (para index.ts) ──────────────────────────────────────────────

/** Intervalo por defecto entre ciclos del poller (ms). */
export const DEFAULT_POLL_INTERVAL_MS = 5000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bucle infinito que ejecuta `pollOnce` cada `intervalMs`. Degradación segura: nunca
 * lanza (pollOnce ya absorbe sus errores) y espera el intervalo entre ciclos. Pensado
 * para correr en paralelo al long polling de Telegram en `index.ts`.
 */
export async function runNotificationPoller(
  client: NotificationsClient,
  sender: MessageSender,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  logger: PollerLogger = consoleLogger,
): Promise<void> {
  // Ids "entregados pero aún no confirmados como sent". PERSISTE entre ciclos para
  // que un fallo de marcado no provoque una doble entrega (dedup casi-una-vez).
  const deliveredUnmarked = new Set<string>();
  for (;;) {
    await pollOnce(client, sender, logger, deliveredUnmarked);
    await delay(intervalMs);
  }
}

// ── Cliente HTTP real del backend de notificaciones ─────────────────────────────

/**
 * Implementación real de `NotificationsClient` vía fetch. Autentica con el
 * `service-token` en la cabecera `x-service-token`. El token NUNCA se loggea.
 */
export class HttpNotificationsClient implements NotificationsClient {
  readonly #baseUrl: string;
  readonly #serviceToken: string;

  constructor(baseUrl: string, serviceToken: string) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#serviceToken = serviceToken;
  }

  async fetchPending(): Promise<readonly PendingNotification[]> {
    // Pedimos al backend SOLO las de esta plataforma: el filtrado ocurre en BD, asi
    // no recibimos chat_id de otra plataforma (guardrail #1). El filtro client-side
    // de abajo queda como defensa en profundidad.
    const query = new URLSearchParams({ plataforma: PLATAFORMA });
    const res = await fetch(`${this.#baseUrl}/notifications/pending?${query.toString()}`, {
      method: "GET",
      headers: { "x-service-token": this.#serviceToken },
    });
    if (!res.ok) {
      throw new Error(`GET /notifications/pending fallo con estado ${res.status}`);
    }
    const json: unknown = await res.json();
    const parsed = pendingResponseSchema.parse(json);
    return parsed.notifications;
  }

  async markSent(id: string): Promise<void> {
    const res = await fetch(
      `${this.#baseUrl}/notifications/${encodeURIComponent(id)}/sent`,
      {
        method: "POST",
        headers: { "x-service-token": this.#serviceToken },
      },
    );
    if (!res.ok) {
      throw new Error(`POST /notifications/:id/sent fallo con estado ${res.status}`);
    }
  }
}
