import { z } from "zod";
import {
  estadoPersonaSchema,
  estadoVerificacionSchema,
  fuenteDatoSchema,
  plataformaCanalSchema,
} from "./enums.js";

// Esquemas zod del dominio, alineados con migrations/0001_init.sql y con la
// clasificacion de privacidad de docs/data-model.md.
//
// Convencion:
//   - `*CreateSchema`  : entrada que envia un canal al registrar (input minimo).
//   - `*Schema`        : registro completo del dominio (lo que vive en la BD).
//   - `Public*`        : vista publica, SIN datos de contacto (guardrail #1).
//
// `contact_id` es INTERNO: presente en el registro completo, jamas en la vista publica.

// ── Primitivas reutilizables ────────────────────────────────────────────────

/** uuid de la BD (gen_random_uuid). */
export const idSchema = z.uuid();

/**
 * Edad valida: 0..129 o null. Espeja la constraint SQL
 * `edad is null or (edad >= 0 and edad < 130)`.
 */
export const edadSchema = z
  .number()
  .int()
  .min(0)
  .max(129)
  .nullable();

const nombreObligatorio = z.string().trim().min(1);
const textoOpcional = z.string().trim().min(1).nullable();
const urlOpcional = z.url().nullable();

// ── Person ──────────────────────────────────────────────────────────────────

/**
 * Entrada de creacion de persona (lo que envia un canal).
 * No incluye id, estado, verificacion ni timestamps: los fija el dominio/BD.
 * `contact_id` es opcional aqui porque el contacto se resuelve/crea aparte;
 * nunca es un dato publico.
 */
export const personCreateSchema = z.object({
  nombre: nombreObligatorio,
  apellidos: textoOpcional.optional(),
  edad: edadSchema.optional(),
  zona: textoOpcional.optional(),
  descripcion: textoOpcional.optional(),
  foto_url: urlOpcional.optional(),
  fuente: fuenteDatoSchema.optional(),
  contact_id: idSchema.nullable().optional(),
});
export type PersonCreate = z.infer<typeof personCreateSchema>;

/** Registro completo de persona (espeja la tabla `persons`). */
export const personSchema = z.object({
  id: idSchema,
  nombre: nombreObligatorio,
  apellidos: textoOpcional,
  edad: edadSchema,
  zona: textoOpcional,
  descripcion: textoOpcional,
  foto_url: urlOpcional,
  estado: estadoPersonaSchema,
  fuente: fuenteDatoSchema,
  verificacion: estadoVerificacionSchema,
  // INTERNO — nunca en respuestas publicas.
  contact_id: idSchema.nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Person = z.infer<typeof personSchema>;

/** Vista publica de persona: sin `contact_id` ni dato de contacto alguno. */
export const publicPersonSchema = personSchema.omit({ contact_id: true });
export type PublicPerson = z.infer<typeof publicPersonSchema>;

/**
 * Vista del DUENO sobre UNO de SUS registros, para listarlos y que elija cual
 * marcar/borrar TOCANDO un numero, sin tener que pegar codigos. Solo lo necesario
 * para reconocerlo (nombre, zona) mas el estado, y el `id` (interno, NO es PII de
 * contacto). NUNCA incluye `contact_id` ni dato de contacto alguno (guardrail #1).
 * A diferencia de la vista publica, SI puede incluir registros de menores: son del
 * propio dueno, que necesita poder gestionarlos (no se expone contacto en ningun caso).
 */
export const ownedPersonSchema = z.object({
  id: idSchema,
  nombre: nombreObligatorio,
  apellidos: textoOpcional,
  zona: textoOpcional,
  estado: estadoPersonaSchema,
});
export type OwnedPerson = z.infer<typeof ownedPersonSchema>;

// ── Pet ─────────────────────────────────────────────────────────────────────

/** Entrada de creacion de mascota. */
export const petCreateSchema = z.object({
  nombre: textoOpcional.optional(),
  tipo: textoOpcional.optional(),
  raza: textoOpcional.optional(),
  zona: textoOpcional.optional(),
  foto_url: urlOpcional.optional(),
  fuente: fuenteDatoSchema.optional(),
  contact_id: idSchema.nullable().optional(),
});
export type PetCreate = z.infer<typeof petCreateSchema>;

/** Registro completo de mascota (espeja la tabla `pets`). */
export const petSchema = z.object({
  id: idSchema,
  nombre: textoOpcional,
  tipo: textoOpcional,
  raza: textoOpcional,
  zona: textoOpcional,
  foto_url: urlOpcional,
  estado: estadoPersonaSchema,
  fuente: fuenteDatoSchema,
  verificacion: estadoVerificacionSchema,
  // INTERNO — nunca en respuestas publicas.
  contact_id: idSchema.nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Pet = z.infer<typeof petSchema>;

/** Vista publica de mascota: sin `contact_id`. */
export const publicPetSchema = petSchema.omit({ contact_id: true });
export type PublicPet = z.infer<typeof publicPetSchema>;

// ── Search ──────────────────────────────────────────────────────────────────

/** Objetivo de una busqueda. */
export const tipoBusquedaSchema = z.enum(["persona", "mascota"]);
export type TipoBusqueda = z.infer<typeof tipoBusquedaSchema>;

/**
 * Entrada de creacion de busqueda (quien busca a quien).
 * `buscador_contact_id` es SENSIBLE: se usa solo para notificar internamente.
 */
export const searchCreateSchema = z.object({
  tipo: tipoBusquedaSchema,
  target_nombre: textoOpcional.optional(),
  target_descripcion: textoOpcional.optional(),
  zona: textoOpcional.optional(),
  buscador_contact_id: idSchema.nullable().optional(),
  /** Señal de menor (auto-declarada o set por el server conservativamente). */
  es_menor: z.boolean().optional().default(false),
});
export type SearchCreate = z.infer<typeof searchCreateSchema>;

/** Registro completo de busqueda (espeja la tabla `searches`). */
export const searchSchema = z.object({
  id: idSchema,
  tipo: tipoBusquedaSchema,
  target_nombre: textoOpcional,
  target_descripcion: textoOpcional,
  zona: textoOpcional,
  // SENSIBLE — nunca en respuestas publicas.
  buscador_contact_id: idSchema.nullable(),
  /** Señal de menor conservativa. false por defecto; true si se detecta o declara. */
  es_menor: z.boolean().default(false),
  created_at: z.iso.datetime({ offset: true }),
});
export type Search = z.infer<typeof searchSchema>;

// ── Mapa: zonas y necesidades (vistas publicas) ──────────────────────────────
//
// Zonas (puntos de encuentro) y necesidades son LECTURA PUBLICA del mapa de la
// emergencia: no llevan contacto ni identidad interna (guardrail #1). Definimos su
// vista publica aqui (en core) para que la maquina de conversacion la muestre y los
// adaptadores la validen con zod, sin acoplarse al paquete `db`. Espejan las vistas
// `zones_public` / `needs_public` y las rutas GET /zones y GET /needs del backend.

/** Urgencia de una necesidad. Espeja la constraint SQL `urgencia in (...)`. */
export const urgenciaSchema = z.enum(["baja", "media", "alta", "critica"]);
export type Urgencia = z.infer<typeof urgenciaSchema>;

/** Vista publica de una zona (punto de encuentro). Espeja `zones_public`. */
export const publicZoneSchema = z.object({
  id: idSchema,
  nombre: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  estado: z.string().nullable(),
  updated_at: z.iso.datetime({ offset: true }),
});
export type PublicZone = z.infer<typeof publicZoneSchema>;

/** Vista publica de una necesidad por zona. Espeja `needs_public`. */
export const publicNeedSchema = z.object({
  id: idSchema,
  zone_id: idSchema,
  tipo: z.string(),
  urgencia: urgenciaSchema,
  descripcion: z.string().nullable(),
  updated_at: z.iso.datetime({ offset: true }),
});
export type PublicNeed = z.infer<typeof publicNeedSchema>;
