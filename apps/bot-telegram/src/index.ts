import process from "node:process";
import { z } from "zod";
import { loadDotenvIfPresent } from "./load-dotenv.js";
import { HttpTelegramTransport } from "./http-telegram-transport.js";
import { HttpBackendClient } from "./http-backend-client.js";
import { InMemorySessionStore } from "./session-store.js";
import { handleUpdate, type UpdateDeps } from "./handle-update.js";
import { getUpdatesResponseSchema } from "./telegram-types.js";
import {
  DEFAULT_POLL_INTERVAL_MS,
  HttpNotificationsClient,
  runNotificationPoller,
  type MessageSender,
} from "./notification-poller.js";

// Punto de entrada del bot de Telegram (long polling).
//
// 1. Carga el .env de la raiz (solo en local).
// 2. Valida con zod las variables necesarias; falla CLARO si falta alguna,
//    SIN imprimir su valor (guardrail #6: secretos fuera de logs).
// 3. Construye las implementaciones reales (transporte, backend, sesiones).
// 4. Corre el bucle getUpdates -> handleUpdate, avanzando el offset.
//
// No hay reglas de negocio aqui: el dialogo entero esta en la maquina de `core`.

// ── Validacion de entorno ────────────────────────────────────────────────────

const envSchema = z.object({
  // El token del bot es secreto: se valida que exista y no este vacio, nunca se imprime.
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN es obligatorio"),
  // URL del backend (spec 01). Debe ser una URL valida.
  BACKEND_URL: z.url("BACKEND_URL debe ser una URL valida"),
  // Token de servicio para leer/marcar notificaciones del backend. OPCIONAL: si no
  // esta, el bot funciona igual pero NO entrega notificaciones (el poller no arranca).
  SERVICE_TOKEN: z.string().min(1).optional(),
  // Intervalo del poller de notificaciones en ms. OPCIONAL: por defecto 5000.
  NOTIFICATIONS_POLL_INTERVAL_MS: z.coerce.number().int().positive().optional(),
});

interface Env {
  readonly telegramBotToken: string;
  readonly backendUrl: string;
  readonly serviceToken?: string;
  readonly pollIntervalMs: number;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Solo listamos QUE variable falla, jamas su valor.
    const faltantes = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    console.error(
      `[bot-telegram] Configuracion invalida. Revisa estas variables de entorno: ${faltantes}`,
    );
    process.exit(1);
  }
  const base = {
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    backendUrl: parsed.data.BACKEND_URL,
    pollIntervalMs: parsed.data.NOTIFICATIONS_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS,
  };
  // exactOptionalPropertyTypes: solo incluimos serviceToken cuando es una cadena.
  return parsed.data.SERVICE_TOKEN === undefined
    ? base
    : { ...base, serviceToken: parsed.data.SERVICE_TOKEN };
}

// ── Long polling ─────────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = "https://api.telegram.org";
/** Segundos de espera del long poll en cada getUpdates (lado servidor). */
const LONG_POLL_TIMEOUT_SECONDS = 30;

/**
 * Bucle infinito de long polling: pide updates, los procesa y avanza el offset.
 * Ante un fallo de red espera un poco y reintenta (degradacion segura: el bot no
 * muere por un corte puntual). El token vive en la URL y nunca se loggea.
 */
async function runPolling(token: string, deps: UpdateDeps): Promise<void> {
  const getUpdatesUrl = `${TELEGRAM_API_BASE}/bot${token}/getUpdates`;
  let offset = 0;

  for (;;) {
    try {
      const res = await fetch(getUpdatesUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offset, timeout: LONG_POLL_TIMEOUT_SECONDS }),
      });
      if (!res.ok) {
        // No incluimos el cuerpo (podria reflejar la URL con token).
        throw new Error(`getUpdates fallo con estado ${res.status}`);
      }

      const json: unknown = await res.json();
      const parsed = getUpdatesResponseSchema.safeParse(json);
      if (!parsed.success) {
        await delay(1000);
        continue;
      }

      for (const update of parsed.data.result) {
        // Avanzamos el offset SIEMPRE (incluso si el update se ignora), para no
        // reprocesar el mismo update en el siguiente poll.
        offset = Math.max(offset, update.update_id + 1);
        await handleUpdate(update, deps);
      }
    } catch (error) {
      // Error de red/Telegram: avisamos sin volcar el detalle y reintentamos.
      console.error("[bot-telegram] Error en el bucle de polling; reintentando.", String(error));
      await delay(1000);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Arranque ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadDotenvIfPresent();
  const env = loadEnv();

  const transport = new HttpTelegramTransport(env.telegramBotToken);
  const deps: UpdateDeps = {
    transport,
    backend: new HttpBackendClient(env.backendUrl),
    sessions: new InMemorySessionStore(),
  };

  // Arrancamos el poller de notificaciones EN PARALELO al long polling (si hay token
  // de servicio). El sender adapta el chat_id (cadena del backend) al chatId numerico
  // que usa Telegram; si no es numerico, lo descartamos sin loggear el valor.
  if (env.serviceToken !== undefined) {
    const sender: MessageSender = {
      send: async (chatId: string, text: string): Promise<void> => {
        const numericChatId = Number(chatId);
        if (!Number.isInteger(numericChatId)) {
          throw new Error("chat_id de notificacion no es un id numerico de Telegram");
        }
        await transport.sendMessage(numericChatId, text);
      },
    };
    const notifications = new HttpNotificationsClient(env.backendUrl, env.serviceToken);
    // No esperamos esta promesa: corre indefinidamente junto al long polling.
    void runNotificationPoller(notifications, sender, env.pollIntervalMs);
    console.log("[bot-telegram] Poller de notificaciones iniciado.");
  } else {
    console.log(
      "[bot-telegram] SERVICE_TOKEN ausente: no se entregaran notificaciones (poller desactivado).",
    );
  }

  console.log("[bot-telegram] Bot iniciado. Escuchando mensajes por long polling.");
  await runPolling(env.telegramBotToken, deps);
}

main().catch((error) => {
  console.error("[bot-telegram] Fallo fatal al iniciar el bot.", String(error));
  process.exit(1);
});
