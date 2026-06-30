import type { EstadoPersona, EstadoVerificacion, FuenteDato } from "core";

// Mapas de presentacion: traducen los enums del dominio a textos en espanol y a
// clases Tailwind. Funciones/datos PUROS (sin estado, sin red): viven en la capa
// de presentacion. No contienen reglas de negocio.

/** Etiqueta legible para cada estado de una persona. */
export const ESTADO_LABEL: Record<EstadoPersona, string> = {
  desaparecida: "Desaparecida",
  encontrada_viva: "Encontrada con vida",
  encontrada_herida: "Encontrada herida",
  fallecida: "Fallecida",
  reunida: "Reunida con su familia",
  a_salvo: "A salvo",
};

/** Clases Tailwind (badge) por estado, con suficiente contraste. */
export const ESTADO_BADGE_CLASS: Record<EstadoPersona, string> = {
  desaparecida: "bg-amber-100 text-amber-900 ring-amber-300",
  encontrada_viva: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  encontrada_herida: "bg-orange-100 text-orange-900 ring-orange-300",
  fallecida: "bg-slate-200 text-slate-900 ring-slate-400",
  reunida: "bg-sky-100 text-sky-900 ring-sky-300",
  a_salvo: "bg-teal-100 text-teal-900 ring-teal-300",
};

/** Etiqueta legible para el nivel de verificacion. */
export const VERIFICACION_LABEL: Record<EstadoVerificacion, string> = {
  verificada: "Verificada",
  sin_verificar: "Sin verificar",
};

/** Clases Tailwind (badge) por verificacion. */
export const VERIFICACION_BADGE_CLASS: Record<EstadoVerificacion, string> = {
  verificada: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  sin_verificar: "bg-slate-100 text-slate-700 ring-slate-300",
};

/** Etiqueta legible para el origen del dato. */
export const FUENTE_LABEL: Record<FuenteDato, string> = {
  propia: "Reporte propio",
  cruz_roja: "Cruz Roja",
  ocha: "OCHA",
  hospital: "Hospital",
  refugio: "Refugio",
  plataforma_aliada: "Plataforma aliada",
};

/** Convierte el score [0..1] a un porcentaje entero legible (0..100). */
export function scoreToPercent(score: number): number {
  const clamped = Math.min(1, Math.max(0, score));
  return Math.round(clamped * 100);
}

/** Edad legible: "32 anos" o un guion cuando no se conoce. */
export function formatEdad(edad: number | null): string {
  if (edad === null) {
    return "Edad no indicada";
  }
  return edad === 1 ? "1 ano" : `${edad} anos`;
}
