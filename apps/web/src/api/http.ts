// Utilidades compartidas de la capa de acceso a la API REST del backend.
//
// Centraliza como se resuelve la URL base (VITE_BACKEND_URL) para que todas las
// llamadas (busqueda de personas, mascotas, zonas, necesidades) la construyan
// igual y de forma predecible.

/**
 * URL base del backend. Se lee de VITE_BACKEND_URL; si falta, se usa el backend
 * local de desarrollo (ver README de apps/web).
 */
const DEFAULT_BACKEND_URL = "http://localhost:3000";

export function getBackendUrl(): string {
  const fromEnv = import.meta.env.VITE_BACKEND_URL;
  return typeof fromEnv === "string" && fromEnv.length > 0
    ? fromEnv
    : DEFAULT_BACKEND_URL;
}

/** Quita la barra final para construir URLs de forma predecible. */
export function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Base ya saneada (sin barra final) para componer rutas. */
export function getApiBase(): string {
  return trimTrailingSlash(getBackendUrl());
}
