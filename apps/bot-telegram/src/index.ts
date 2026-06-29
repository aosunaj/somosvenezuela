import process from "node:process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
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

// Punto de entrada del bot de Telegram. Funciona en DOS modos segun el entorno:
//
//   • WEBHOOK (produccion): si hay una URL publica (WEBHOOK_URL o, en Render, la
//     automatica RENDER_EXTERNAL_URL), registramos un webhook en Telegram y
//     recibimos cada update como un POST entrante. CLAVE en hosting gratuito: ese
//     POST DESPIERTA al servicio dormido, asi que el bot no queda muerto tras los
//     ~15 min de inactividad del plan free (a diferencia del long polling, que no
//     recibe trafico entrante y por eso se dormia para siempre).
//
//   • LONG POLLING (local/dev): si no hay URL publica, caemos al bucle getUpdates.
//     Comodo para desarrollo sin tunel; en local el sueño del host no aplica.
//
// El token NUNCA se loggea: solo se usa para construir URLs de la API de Telegram.
// No hay reglas de negocio aqui: el dialogo entero vive en la maquina de `core`.

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
  // URL publica para el webhook. OPCIONAL: si falta, se intenta RENDER_EXTERNAL_URL.
  WEBHOOK_URL: z.url().optional(),
  // En Render (web service) esta variable la inyecta la plataforma con la URL publica.
  RENDER_EXTERNAL_URL: z.url().optional(),
  // Secreto del webhook: viaja en el header X-Telegram-Bot-Api-Secret-Token de cada
  // POST y lo validamos. OPCIONAL pero MUY recomendado (sin el, cualquiera que adivine
  // la URL podria inyectar updates falsos). Nunca se imprime.
  WEBHOOK_SECRET: z.string().min(1).optional(),
});

interface Env {
  readonly telegramBotToken: string;
  readonly backendUrl: string;
  readonly serviceToken?: string;
  readonly pollIntervalMs: number;
  /** URL publica del propio bot (sin barra final). Si existe, corremos en modo webhook. */
  readonly publicUrl?: string;
  readonly webhookSecret?: string;
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
  // La URL publica explicita gana; si no, usamos la que Render inyecta.
  const publicUrlRaw = parsed.data.WEBHOOK_URL ?? parsed.data.RENDER_EXTERNAL_URL;

  // SEGURIDAD (fail-closed): en modo webhook (hay URL publica) el secreto es
  // OBLIGATORIO. Sin el, cualquiera que adivine la URL podria inyectar updates
  // falsos (impersonar usuarios, disparar borrados). Preferimos NO arrancar antes
  // que aceptar POSTs sin verificar.
  if (publicUrlRaw !== undefined && parsed.data.WEBHOOK_SECRET === undefined) {
    console.error(
      "[bot-telegram] WEBHOOK_SECRET es obligatorio cuando hay URL publica (modo webhook). " +
        "Configuralo para que solo Telegram pueda enviar updates.",
    );
    process.exit(1);
  }

  // exactOptionalPropertyTypes: solo incluimos las opcionales cuando tienen valor.
  return {
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    backendUrl: parsed.data.BACKEND_URL,
    pollIntervalMs: parsed.data.NOTIFICATIONS_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS,
    ...(parsed.data.SERVICE_TOKEN !== undefined ? { serviceToken: parsed.data.SERVICE_TOKEN } : {}),
    ...(publicUrlRaw !== undefined ? { publicUrl: publicUrlRaw.replace(/\/+$/, "") } : {}),
    ...(parsed.data.WEBHOOK_SECRET !== undefined ? { webhookSecret: parsed.data.WEBHOOK_SECRET } : {}),
  };
}

// ── Constantes de Telegram ────────────────────────────────────────────────────

const TELEGRAM_API_BASE = "https://api.telegram.org";
/** Ruta donde recibimos los POST del webhook de Telegram. El secreto va en header. */
const WEBHOOK_PATH = "/telegram/webhook";
/** Segundos de espera del long poll en cada getUpdates (lado servidor). */
const LONG_POLL_TIMEOUT_SECONDS = 30;
/** Tope de tamaño del cuerpo de un POST de webhook (defensa simple ante abuso). */
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

// ── Modo webhook ──────────────────────────────────────────────────────────────

/**
 * Registra el webhook en Telegram apuntando a nuestra URL publica. `secret_token`
 * hace que Telegram incluya ese valor en el header de cada POST, que validamos.
 * `drop_pending_updates` descarta la cola acumulada mientras el bot estuvo caido
 * (arranque limpio). Si falla, propagamos para que el arranque avise claro.
 */
async function configureWebhook(
  token: string,
  url: string,
  secret: string | undefined,
): Promise<void> {
  const body: Record<string, unknown> = {
    url,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  };
  if (secret !== undefined) body["secret_token"] = secret;

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // No incluimos el cuerpo (podria reflejar la URL con token).
    throw new Error(`setWebhook fallo con estado ${res.status}`);
  }
}

/** Elimina el webhook (modo local: getUpdates da 409 si hay uno activo). */
async function deleteWebhook(token: string): Promise<void> {
  await fetch(`${TELEGRAM_API_BASE}/bot${token}/deleteWebhook`, { method: "POST" });
}

/**
 * Compara el secreto del header en tiempo constante. Hasheamos ambos lados a 32
 * bytes fijos (sha256) antes de comparar: asi `timingSafeEqual` nunca filtra la
 * longitud del secreto esperado (evita la fuga por early-return de un check de
 * longitud).
 */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Normaliza un header que puede venir como string o array. */
function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Lee el cuerpo de la peticion como texto, con tope de tamaño. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_WEBHOOK_BODY_BYTES) {
        reject(new Error("cuerpo de webhook demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Configuracion del servidor HTTP: si atiende el webhook y con que secreto. */
interface ServerOptions {
  /** true solo en modo webhook; en polling NO se procesa ningun POST entrante. */
  readonly webhookEnabled: boolean;
  /** Secreto a validar en el header. En modo webhook siempre esta definido (loadEnv). */
  readonly secret: string | undefined;
}

/**
 * Maneja cada peticion HTTP: si es el POST del webhook (y estamos en modo webhook),
 * valida el secreto, sanea el cuerpo y procesa el update; cualquier otra ruta —y todo
 * en modo polling— responde 200 (health para el host). SIEMPRE respondemos 200 ante un
 * update valido (aunque falle el proceso) para que Telegram no reintente en bucle.
 */
async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: UpdateDeps,
  options: ServerOptions,
): Promise<void> {
  if (options.webhookEnabled && req.method === "POST" && req.url === WEBHOOK_PATH) {
    // Fail-closed: sin un secreto valido NO procesamos. En modo webhook el secreto
    // es obligatorio (loadEnv), asi que esto solo rechaza POSTs no autenticados.
    if (
      options.secret === undefined ||
      !secretMatches(headerValue(req.headers["x-telegram-bot-api-secret-token"]), options.secret)
    ) {
      res.writeHead(401);
      res.end();
      return;
    }

    let update: unknown;
    try {
      update = JSON.parse(await readBody(req));
    } catch {
      // Cuerpo invalido o demasiado grande: 200 para cortar reintentos.
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    try {
      await handleUpdate(update, deps);
    } catch (error) {
      console.error("[bot-telegram] Error procesando un update; se ignora.", String(error));
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  // Health / cualquier otra ruta: 200 para satisfacer el binding de puerto del host.
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
}

// ── Long polling (fallback local) ─────────────────────────────────────────────

/**
 * Bucle infinito de long polling: pide updates, los procesa y avanza el offset.
 * Solo se usa en local (sin URL publica). Ante un fallo de red espera y reintenta.
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

// ── Servidor HTTP (webhook + health) ──────────────────────────────────────────

function resolvePort(): number {
  const raw = process.env["PORT"];
  return raw !== undefined && Number.isInteger(Number(raw)) ? Number(raw) : 3002;
}

/**
 * Levanta el servidor HTTP. En modo webhook procesa los POST de Telegram; en modo
 * polling solo sirve health (el dialogo va por el bucle de getUpdates en paralelo).
 */
function startServer(deps: UpdateDeps, options: ServerOptions): void {
  const port = resolvePort();
  const server = createServer((req, res) => {
    void handleHttpRequest(req, res, deps, options);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[bot-telegram] Servidor escuchando en el puerto ${port}.`);
  });
}

// ── Poller de notificaciones (comun a ambos modos) ────────────────────────────

/**
 * Arranca el poller de notificaciones en paralelo (si hay token de servicio). El
 * sender adapta el chat_id (cadena del backend) al chatId numerico de Telegram.
 * NOTA: en modo webhook, el servicio dormido solo se despierta con trafico entrante,
 * asi que entre mensajes el poller puede pausarse y las notificaciones llegar con
 * algo de retraso. Es el compromiso del plan gratuito.
 */
function startNotificationsPoller(env: Env, transport: HttpTelegramTransport): void {
  if (env.serviceToken === undefined) {
    console.log(
      "[bot-telegram] SERVICE_TOKEN ausente: no se entregaran notificaciones (poller desactivado).",
    );
    return;
  }
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
  // No esperamos esta promesa: corre indefinidamente junto al servidor/polling.
  void runNotificationPoller(notifications, sender, env.pollIntervalMs);
  console.log("[bot-telegram] Poller de notificaciones iniciado.");
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

  if (env.publicUrl !== undefined) {
    // ── Modo webhook (produccion): el POST entrante despierta al servicio ──
    // abrir puerto ANTES de registrar el webhook. El secreto es obligatorio aqui.
    startServer(deps, { webhookEnabled: true, secret: env.webhookSecret });
    startNotificationsPoller(env, transport);

    const webhookUrl = `${env.publicUrl}${WEBHOOK_PATH}`;
    await configureWebhook(env.telegramBotToken, webhookUrl, env.webhookSecret);
    console.log("[bot-telegram] Bot iniciado en modo WEBHOOK. Escuchando updates entrantes.");
    return;
  }

  // ── Modo long polling (local/dev): no hay URL publica ──
  // Servidor SOLO health: en polling no se procesa ningun POST entrante (cerrado).
  startServer(deps, { webhookEnabled: false, secret: undefined });
  startNotificationsPoller(env, transport);
  // Por si quedo un webhook registrado (mismo token): getUpdates daria 409 con uno activo.
  await deleteWebhook(env.telegramBotToken);
  console.log("[bot-telegram] Bot iniciado en modo LONG POLLING. Escuchando mensajes.");
  await runPolling(env.telegramBotToken, deps);
}

main().catch((error) => {
  console.error("[bot-telegram] Fallo fatal al iniciar el bot.", String(error));
  process.exit(1);
});
