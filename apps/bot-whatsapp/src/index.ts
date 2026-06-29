import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { z } from "zod";
import { loadDotenvIfPresent } from "./load-dotenv.js";
import { HttpWhatsAppTransport } from "./http-whatsapp-transport.js";
import { HttpBackendClient } from "./http-backend-client.js";
import { InMemorySessionStore } from "./session-store.js";
import { handleUpdate, type UpdateDeps } from "./handle-update.js";
import { verifySignature } from "./verify-signature.js";
import {
  DEFAULT_POLL_INTERVAL_MS,
  HttpNotificationsClient,
  runNotificationPoller,
  type MessageSender,
} from "./notification-poller.js";

// Punto de entrada del bot de WhatsApp (webhook con servidor http nativo de Node).
//
// 1. Carga el .env de la raiz (solo en local).
// 2. Valida con zod las variables necesarias; falla CLARO si falta alguna, SIN
//    imprimir su valor (guardrail #6: secretos fuera de logs).
// 3. Construye las implementaciones reales (transporte, backend, sesiones).
// 4. Expone GET/POST /webhook:
//    - GET  : verificacion de suscripcion de Meta (hub.mode/hub.verify_token) ->
//             responde hub.challenge.
//    - POST : verifica la FIRMA (X-Hub-Signature-256) sobre el cuerpo CRUDO; si no
//             coincide -> 401. Si coincide -> pasa el payload a handleUpdate y 200.
//
// No hay reglas de negocio aqui: el dialogo entero esta en la maquina de `core`.
// Se usa el http nativo (sin Fastify) porque necesitamos el cuerpo CRUDO exacto para
// verificar el HMAC, y eso es mas directo y con menos dependencias asi.

// ── Validacion de entorno ────────────────────────────────────────────────────

const envSchema = z.object({
  // Token de acceso de la WhatsApp Cloud API. Secreto: se valida que exista, nunca se imprime.
  WHATSAPP_TOKEN: z.string().min(1, "WHATSAPP_TOKEN es obligatorio"),
  // Id del numero de telefono emisor (de la app de Meta).
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, "WHATSAPP_PHONE_NUMBER_ID es obligatorio"),
  // Token que elegimos nosotros para la verificacion GET del webhook.
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "WHATSAPP_VERIFY_TOKEN es obligatorio"),
  // App Secret de la app de Meta: con el se verifica la firma de cada POST. Secreto.
  WHATSAPP_APP_SECRET: z.string().min(1, "WHATSAPP_APP_SECRET es obligatorio"),
  // URL del backend (spec 01). Debe ser una URL valida.
  BACKEND_URL: z.url("BACKEND_URL debe ser una URL valida"),
  // Token de servicio para leer/marcar notificaciones del backend. OPCIONAL: si no
  // esta, el bot funciona igual pero NO entrega notificaciones (el poller no arranca).
  SERVICE_TOKEN: z.string().min(1).optional(),
  // Intervalo del poller de notificaciones en ms. OPCIONAL: por defecto 5000.
  NOTIFICATIONS_POLL_INTERVAL_MS: z.coerce.number().int().positive().optional(),
});

interface Env {
  readonly whatsappToken: string;
  readonly phoneNumberId: string;
  readonly verifyToken: string;
  readonly appSecret: string;
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
      `[bot-whatsapp] Configuracion invalida. Revisa estas variables de entorno: ${faltantes}`,
    );
    process.exit(1);
  }
  const base = {
    whatsappToken: parsed.data.WHATSAPP_TOKEN,
    phoneNumberId: parsed.data.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: parsed.data.WHATSAPP_VERIFY_TOKEN,
    appSecret: parsed.data.WHATSAPP_APP_SECRET,
    backendUrl: parsed.data.BACKEND_URL,
    pollIntervalMs: parsed.data.NOTIFICATIONS_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS,
  };
  // exactOptionalPropertyTypes: solo incluimos serviceToken cuando es una cadena.
  return parsed.data.SERVICE_TOKEN === undefined
    ? base
    : { ...base, serviceToken: parsed.data.SERVICE_TOKEN };
}

// ── Servidor webhook ─────────────────────────────────────────────────────────

const WEBHOOK_PATH = "/webhook";
/** Puerto del servidor; por defecto 3001 (configurable por PORT). */
const DEFAULT_PORT = 3001;

/** Lee el cuerpo CRUDO de la peticion como Buffer (necesario para el HMAC). */
function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Verificacion GET de la suscripcion del webhook (la hace Meta al configurar la app):
 *   GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * Si el modo es `subscribe` y el token coincide con WHATSAPP_VERIFY_TOKEN, devolvemos
 * el `hub.challenge` en texto plano y 200. En cualquier otro caso, 403.
 */
function handleVerification(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  verifyToken: string,
): void {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge !== null) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(challenge);
    return;
  }
  res.writeHead(403, { "content-type": "text/plain" });
  res.end("Forbidden");
}

/**
 * POST entrante de eventos. Verifica la firma sobre el cuerpo CRUDO antes de tocar el
 * contenido (guardrail #6). Responde 200 incluso si el JSON es invalido o el evento no
 * nos interesa: handleUpdate ignora con seguridad lo que no encaja, y Meta reintenta si
 * no recibe 2xx, por lo que tras validar la firma confirmamos la recepcion.
 */
async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  env: Env,
  deps: UpdateDeps,
): Promise<void> {
  const rawBody = await readRawBody(req);
  const signature = headerValue(req, "x-hub-signature-256");

  if (!verifySignature(rawBody, signature, env.appSecret)) {
    // Origen no verificado: no procesamos nada. No revelamos el motivo exacto.
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("Unauthorized");
    return;
  }

  // La firma es valida: parseamos y delegamos. Cualquier error de forma lo absorbe
  // handleUpdate (no lanza); confirmamos 200 para que Meta no reintente en bucle.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("OK");
    return;
  }

  await handleUpdate(payload, deps);
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("OK");
}

/** Toma un header como string (los headers de node pueden ser string | string[]). */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

function buildServer(env: Env, deps: UpdateDeps) {
  return createServer((req, res) => {
    // `req.url` es relativo; el host solo se usa para parsear la query.
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname !== WEBHOOK_PATH) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
      return;
    }

    if (req.method === "GET") {
      handleVerification(req, res, url, env.verifyToken);
      return;
    }

    if (req.method === "POST") {
      handlePost(req, res, env, deps).catch((error) => {
        // Nunca volcamos detalle sensible; respondemos 500 generico.
        console.error("[bot-whatsapp] Error procesando el webhook.", String(error));
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end("Internal Server Error");
        }
      });
      return;
    }

    res.writeHead(405, { "content-type": "text/plain" });
    res.end("Method Not Allowed");
  });
}

// ── Arranque ─────────────────────────────────────────────────────────────────

function resolvePort(): number {
  const raw = process.env["PORT"];
  if (raw === undefined) return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PORT;
}

function main(): void {
  loadDotenvIfPresent();
  const env = loadEnv();

  const transport = new HttpWhatsAppTransport(env.whatsappToken, env.phoneNumberId);
  const deps: UpdateDeps = {
    transport,
    backend: new HttpBackendClient(env.backendUrl),
    sessions: new InMemorySessionStore(),
  };

  // Arrancamos el poller de notificaciones EN PARALELO al servidor webhook (si hay
  // token de servicio). El wa_id ya es una cadena, asi que el sender envuelve el
  // transporte directamente, sin conversion.
  if (env.serviceToken !== undefined) {
    const sender: MessageSender = {
      send: (chatId: string, text: string): Promise<void> =>
        transport.sendMessage(chatId, text),
    };
    const notifications = new HttpNotificationsClient(env.backendUrl, env.serviceToken);
    // No esperamos esta promesa: corre indefinidamente junto al servidor webhook.
    void runNotificationPoller(notifications, sender, env.pollIntervalMs);
    console.log("[bot-whatsapp] Poller de notificaciones iniciado.");
  } else {
    console.log(
      "[bot-whatsapp] SERVICE_TOKEN ausente: no se entregaran notificaciones (poller desactivado).",
    );
  }

  const port = resolvePort();
  const server = buildServer(env, deps);
  server.listen(port, () => {
    console.log(`[bot-whatsapp] Webhook escuchando en el puerto ${port} (ruta ${WEBHOOK_PATH}).`);
  });
}

main();
