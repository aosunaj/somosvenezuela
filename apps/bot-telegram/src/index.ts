import process from "node:process";
import { z } from "zod";
import { loadDotenvIfPresent } from "./load-dotenv.js";
import { HttpTelegramTransport } from "./http-telegram-transport.js";
import { HttpBackendClient } from "./http-backend-client.js";
import { InMemorySessionStore } from "./session-store.js";
import { handleUpdate, type UpdateDeps } from "./handle-update.js";
import { getUpdatesResponseSchema } from "./telegram-types.js";

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
});

function loadEnv(): { telegramBotToken: string; backendUrl: string } {
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
  return {
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    backendUrl: parsed.data.BACKEND_URL,
  };
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

  const deps: UpdateDeps = {
    transport: new HttpTelegramTransport(env.telegramBotToken),
    backend: new HttpBackendClient(env.backendUrl),
    sessions: new InMemorySessionStore(),
  };

  console.log("[bot-telegram] Bot iniciado. Escuchando mensajes por long polling.");
  await runPolling(env.telegramBotToken, deps);
}

main().catch((error) => {
  console.error("[bot-telegram] Fallo fatal al iniciar el bot.", String(error));
  process.exit(1);
});
