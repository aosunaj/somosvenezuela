import { timingSafeEqual } from "node:crypto";

// Utilidades de seguridad del backend.

/**
 * Compara dos cadenas en tiempo constante para no filtrar informacion del secreto
 * por el tiempo de comparacion (timing attack). Devuelve false si las longitudes
 * difieren (sin cortocircuito que dependa del contenido).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Header del secreto compartido bot<->backend para las rutas by-channel del Modelo B.
 * El bot lo envia en cada llamada a esas rutas; el backend lo compara con BOT_BACKEND_SECRET.
 */
export const BOT_SECRET_HEADER = "x-bot-secret";

/**
 * Verifica el secreto compartido bot<->backend para una ruta del Modelo B.
 *
 * FAIL-CLOSED cuando esta configurado: si `expected` tiene valor, el header
 * `provided` DEBE existir y coincidir (comparacion en tiempo constante); si falta o
 * no coincide -> false (la ruta responde 401, sin efecto). Si `expected` esta
 * vacio/indefinido (dev/test sin secreto), devuelve true para no romper el desarrollo
 * local; en produccion el secreto debe estar siempre configurado.
 *
 * `provided` admite el tipo crudo de los headers de Fastify (string | string[] |
 * undefined): un header repetido (array) se rechaza por seguridad.
 */
export function isBotSecretValid(
  provided: string | string[] | undefined,
  expected: string | undefined,
): boolean {
  // Sin secreto configurado: verificacion omitida (dev/test).
  if (expected === undefined || expected.length === 0) return true;
  // Configurado: exigir un unico header string que coincida en tiempo constante.
  if (typeof provided !== "string" || provided.length === 0) return false;
  return timingSafeEqualString(provided, expected);
}
