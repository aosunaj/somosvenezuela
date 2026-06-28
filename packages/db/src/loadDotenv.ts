import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

// Carga el .env de la raiz del monorepo a process.env SOLO si el archivo existe
// (desarrollo local). En produccion (Railway/Render) y en CI las variables vienen
// del entorno real y no hay .env: en ese caso esta funcion no hace nada.
//
// Objetivo: que `pnpm verify` y los scripts db:* funcionen en local con solo poner
// el .env, sin tener que exportar variables a mano. NUNCA imprime valores.

const __dirname = dirname(fileURLToPath(import.meta.url));
/** .env en la raiz del repo (este archivo vive en packages/db/src). */
const ROOT_ENV = resolve(__dirname, "../../../.env");

export function loadDotenvIfPresent(): void {
  // process.loadEnvFile existe desde Node 20.12; si no esta, no-op (exportar a mano).
  if (typeof process.loadEnvFile !== "function") return;
  if (existsSync(ROOT_ENV)) {
    process.loadEnvFile(ROOT_ENV);
  }
}
