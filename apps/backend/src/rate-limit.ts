import type { FastifyRequest } from "fastify";

// Configuracion de rate limiting (anti-abuso, guardrail #6).
//
// Centraliza los limites para que app.ts (limite GLOBAL) y las rutas sensibles
// (limite ESTRICTO por-ruta) hablen el mismo idioma y no se desincronicen.
//
// Dos capas de defensa:
//   1) Limite GLOBAL por IP (100/min): freno general anti-spam/anti-scraping sobre
//      toda la API (registro, busqueda, etc.).
//   2) Limite ESTRICTO por-ruta (10/min) en las operaciones SENSIBLES por canal
//      (borrado seguro y rescatado): un mismo dueno no necesita repetirlas a gran
//      ritmo; un ritmo alto huele a abuso o a fuerza bruta sobre la propiedad.
//
// El limite por-ruta SOLO se aplica si el plugin @fastify/rate-limit esta
// registrado (ver buildApp). En los tests que registran rutas con Fastify "a mano"
// (sin el plugin), este `config.rateLimit` es un no-op inofensivo.

/** Maximo global de peticiones por ventana y por IP. */
export const GLOBAL_RATE_LIMIT_MAX = 100 as const;

/** Maximo ESTRICTO por-ruta para endpoints sensibles por canal. */
export const SENSITIVE_RATE_LIMIT_MAX = 10 as const;

/** Ventana de tiempo comun para ambos limites. */
export const RATE_LIMIT_TIME_WINDOW = "1 minute" as const;

/** Forma de la opcion `config.rateLimit` por-ruta que entiende @fastify/rate-limit. */
export interface RouteRateLimitConfig {
  max: number;
  timeWindow: string;
}

/** Opcion `config` por-ruta con el limite estricto de endpoints sensibles. */
export interface SensitiveRouteConfig {
  rateLimit: RouteRateLimitConfig;
}

/**
 * Config por-ruta para los endpoints sensibles por canal (borrado seguro y
 * rescatado): limite estricto de SENSITIVE_RATE_LIMIT_MAX por ventana.
 */
export const sensitiveRouteRateLimit: SensitiveRouteConfig = {
  rateLimit: {
    max: SENSITIVE_RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_TIME_WINDOW,
  },
};

/**
 * Decide si el rate limiting debe estar ACTIVO al construir la app.
 *
 * Por defecto activo en cualquier entorno salvo en tests (`NODE_ENV==='test'`):
 * los 76 tests existentes ejercitan los endpoints muchas veces en rafagas y no
 * deben recibir 429. El test enfocado de 429 fuerza la activacion explicita por
 * opcion (no depende de este default).
 */
export function rateLimitEnabledByDefault(): boolean {
  return process.env["NODE_ENV"] !== "test";
}

/** Extrae la IP del cliente para la clave del rate limit (sin PII persistida). */
export function rateLimitKeyGenerator(request: FastifyRequest): string {
  return request.ip;
}
