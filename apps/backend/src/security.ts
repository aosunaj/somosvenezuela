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
