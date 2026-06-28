import { getApiBase } from "./http.ts";

// Capa de acceso a la API REST del backend para el mapa de zonas y necesidades
// (GET /zones, GET /needs?zoneId=).
//
// Las tablas `zones` y `needs` no exponen datos de contacto ni PII: solo estado
// operativo de cada zona y sus necesidades por urgencia (guardrail: "sin datos
// personales en el mapa", spec 04). Por eso estos tipos se declaran aqui y no
// derivan de las vistas publicas de "core".

/** Niveles de urgencia de una necesidad, de menor a mayor prioridad. */
export type Urgencia = "baja" | "media" | "alta" | "critica";

/** Una zona afectada con su posicion (puede faltar) y estado operativo. */
export interface Zone {
  id: string;
  nombre: string;
  /** Latitud; null cuando aun no se ha geolocalizado la zona. */
  lat: number | null;
  /** Longitud; null cuando aun no se ha geolocalizado la zona. */
  lng: number | null;
  /** Estado operativo libre de la zona (p. ej. "evacuada"); puede faltar. */
  estado: string | null;
  updated_at: string;
}

/** Una necesidad declarada en una zona, con su nivel de urgencia. */
export interface Need {
  id: string;
  zone_id: string;
  tipo: string;
  urgencia: Urgencia;
  descripcion: string | null;
  updated_at: string;
}

interface ZonesResponse {
  zones: Zone[];
}

interface NeedsResponse {
  needs: Need[];
}

/**
 * Llama a GET /zones y devuelve las zonas.
 * Lanza un Error con mensaje amable si la respuesta no es correcta.
 */
export async function fetchZones(options?: {
  signal?: AbortSignal;
}): Promise<Zone[]> {
  const url = `${getApiBase()}/zones`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options?.signal ?? null,
  });

  if (!response.ok) {
    throw new Error(`No pudimos cargar las zonas (${response.status}).`);
  }

  const data = (await response.json()) as ZonesResponse;
  return Array.isArray(data.zones) ? data.zones : [];
}

/**
 * Llama a GET /needs?zoneId=... y devuelve las necesidades de una zona.
 * Lanza un Error con mensaje amable si la respuesta no es correcta.
 */
export async function fetchNeeds(
  zoneId: string,
  options?: { signal?: AbortSignal },
): Promise<Need[]> {
  const url = new URL(`${getApiBase()}/needs`);
  url.searchParams.set("zoneId", zoneId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options?.signal ?? null,
  });

  if (!response.ok) {
    throw new Error(`No pudimos cargar las necesidades (${response.status}).`);
  }

  const data = (await response.json()) as NeedsResponse;
  return Array.isArray(data.needs) ? data.needs : [];
}
