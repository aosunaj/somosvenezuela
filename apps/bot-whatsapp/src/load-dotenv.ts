import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

// Carga el .env de la RAIZ del monorepo a process.env solo si existe (desarrollo
// local). Mismo patron que packages/db/src/loadDotenv.ts y el bot de Telegram: en
// produccion (Railway/Render) y en CI las variables vienen del entorno real y no hay
// .env -> no-op. NUNCA imprime valores.

const __dirname = dirname(fileURLToPath(import.meta.url));
/** .env en la raiz del repo (este archivo vive en apps/bot-whatsapp/src). */
const ROOT_ENV = resolve(__dirname, "../../../.env");

export function loadDotenvIfPresent(): void {
  // process.loadEnvFile existe desde Node 20.12; si no esta, no-op.
  if (typeof process.loadEnvFile !== "function") return;
  if (existsSync(ROOT_ENV)) {
    process.loadEnvFile(ROOT_ENV);
  }
}
