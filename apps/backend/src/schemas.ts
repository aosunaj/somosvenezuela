import { idSchema, tipoBusquedaSchema } from "core";
import { z } from "zod";

// Esquemas zod propios de la capa HTTP (query string y path params).
// Las entidades del dominio (person/search) se validan con los *CreateSchema de core;
// aqui solo van las formas que existen unicamente en el transporte HTTP.

/**
 * Query de GET /search.
 * - `q`    : termino de busqueda (obligatorio; difuso via pg_trgm).
 * - `zona` : filtro opcional por zona.
 * - `tipo` : objetivo; por defecto "persona". "mascota" aun no soportado (Fase 6).
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "Indica un termino de busqueda."),
  zona: z.string().trim().min(1).optional(),
  tipo: tipoBusquedaSchema.optional().default("persona"),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Path params con un id uuid del dominio (p. ej. DELETE /persons/:id). */
export const idParamsSchema = z.object({
  id: idSchema,
});
export type IdParams = z.infer<typeof idParamsSchema>;
