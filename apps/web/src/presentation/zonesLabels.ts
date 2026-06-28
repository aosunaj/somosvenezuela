import type { Urgencia } from "../api/zones.ts";

// Mapas de presentacion para el mapa de zonas y necesidades: traducen la urgencia
// a textos en espanol y a clases Tailwind. Datos PUROS (sin estado, sin red).

/** Etiqueta legible para cada nivel de urgencia. */
export const URGENCIA_LABEL: Record<Urgencia, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  critica: "Critica",
};

/**
 * Clases Tailwind (badge) por urgencia, de menor a mayor, con suficiente
 * contraste: el color comunica prioridad de un vistazo.
 */
export const URGENCIA_BADGE_CLASS: Record<Urgencia, string> = {
  baja: "bg-slate-100 text-slate-700 ring-slate-300",
  media: "bg-amber-100 text-amber-900 ring-amber-300",
  alta: "bg-orange-100 text-orange-900 ring-orange-300",
  critica: "bg-rose-100 text-rose-900 ring-rose-300",
};

/** Color hexadecimal del marcador del mapa por la urgencia mas alta de la zona. */
export const URGENCIA_MARKER_COLOR: Record<Urgencia, string> = {
  baja: "#64748b", // slate-500
  media: "#d97706", // amber-600
  alta: "#ea580c", // orange-600
  critica: "#e11d48", // rose-600
};

/** Orden de prioridad de menor a mayor; util para resaltar la mas critica. */
export const URGENCIA_ORDER: Record<Urgencia, number> = {
  baja: 0,
  media: 1,
  alta: 2,
  critica: 3,
};
