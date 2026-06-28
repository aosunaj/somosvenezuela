import { z } from "zod";

// Enums del dominio, espejados EXACTAMENTE de migrations/0001_init.sql.
// No inventar valores: cualquier divergencia rompe la integridad con la BD.

/** estado_persona: ciclo de vida de una persona/mascota registrada. */
export const estadoPersonaSchema = z.enum([
  "desaparecida",
  "encontrada_viva",
  "encontrada_herida",
  "fallecida",
  "reunida",
]);
export type EstadoPersona = z.infer<typeof estadoPersonaSchema>;

/** fuente_dato: origen del registro. */
export const fuenteDatoSchema = z.enum([
  "propia",
  "cruz_roja",
  "ocha",
  "hospital",
  "refugio",
  "plataforma_aliada",
]);
export type FuenteDato = z.infer<typeof fuenteDatoSchema>;

/** estado_verificacion: nivel de confianza del registro. */
export const estadoVerificacionSchema = z.enum(["verificada", "sin_verificar"]);
export type EstadoVerificacion = z.infer<typeof estadoVerificacionSchema>;

/** plataforma_canal: canal de mensajeria por el que llega/se notifica. */
export const plataformaCanalSchema = z.enum(["telegram", "whatsapp"]);
export type PlataformaCanal = z.infer<typeof plataformaCanalSchema>;

// Valores por defecto al crear un registro (refuerzan los DEFAULT del esquema SQL
// y los guardrails: todo nace desaparecido y sin verificar).
export const DEFAULT_ESTADO: EstadoPersona = "desaparecida";
export const DEFAULT_VERIFICACION: EstadoVerificacion = "sin_verificar";
export const DEFAULT_FUENTE: FuenteDato = "propia";
