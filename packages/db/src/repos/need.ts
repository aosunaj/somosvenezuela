import { z } from "zod";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de necesidades por zona (mapa de la emergencia).
//   - ESCRITURA -> tabla base `needs` (service_role salta RLS).
//   - LECTURA PUBLICA -> SOLO la vista `needs_public` (sin columnas sensibles).
//
// Los tipos de fila se definen aqui (no en el types.ts compartido) para no tocar
// archivos de otros recursos. Espejan migrations/0001_init.sql (tabla needs) y
// migrations/0002_rls_policies.sql (vista needs_public).

// ── Enum de urgencia ─────────────────────────────────────────────────────────

/** Urgencia de una necesidad. Espeja la constraint SQL `urgencia in (...)`. */
export const urgenciaSchema = z.enum(["baja", "media", "alta", "critica"]);
export type Urgencia = z.infer<typeof urgenciaSchema>;

// ── Tipos de fila ────────────────────────────────────────────────────────────

/** Fila de la vista publica `needs_public`: sin columnas sensibles. */
export interface NeedPublicRow {
  id: string;
  zone_id: string;
  tipo: string;
  urgencia: Urgencia;
  descripcion: string | null;
  updated_at: string;
}

/** Necesidad publica del dominio (vista de mapa). Igual que la fila de la vista. */
export type PublicNeed = NeedPublicRow;

/** Columnas seleccionables de `needs_public` (orden y nombres exactos de la vista). */
const NEED_PUBLIC_COLUMNS =
  "id, zone_id, tipo, urgencia, descripcion, updated_at" as const;

// ── Validacion de entrada (zod) ──────────────────────────────────────────────

/** Entrada de creacion de necesidad (asociada a una zona existente). */
export const needCreateSchema = z.object({
  zone_id: z.uuid(),
  tipo: z.string().trim().min(1),
  urgencia: urgenciaSchema,
  descripcion: z.string().trim().min(1).nullable().optional(),
});
export type NeedCreate = z.infer<typeof needCreateSchema>;

// ── Repositorio ──────────────────────────────────────────────────────────────

export interface NeedRepo {
  /**
   * LECTURA PUBLICA. Lista necesidades desde la vista needs_public.
   * Si se pasa zoneId, filtra por esa zona; si no, devuelve todas.
   */
  listPublicByZone(zoneId?: string, limit?: number): Promise<PublicNeed[]>;
  /** ESCRITURA. Crea una necesidad en la tabla base. Devuelve la proyeccion publica. */
  create(input: NeedCreate): Promise<PublicNeed>;
}

/** Construye el repositorio de necesidades sobre un cliente Supabase de servicio. */
export function createNeedRepo(client: DbClient): NeedRepo {
  return {
    async listPublicByZone(zoneId?: string, limit = 200): Promise<PublicNeed[]> {
      // SOLO la vista publica: nunca la tabla base.
      let query = client
        .from("needs_public")
        .select(NEED_PUBLIC_COLUMNS);

      if (zoneId !== undefined && zoneId !== "") {
        query = query.eq("zone_id", zoneId);
      }

      const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(limit)
        .returns<NeedPublicRow[]>();

      if (error) throw new DbError(`No se pudo listar necesidades publicas: ${error.message}`, error.code);
      return data ?? [];
    },

    async create(input: NeedCreate): Promise<PublicNeed> {
      // Validacion de entrada externa (zod) antes de tocar la BD.
      const data = needCreateSchema.parse(input);

      const insert = {
        zone_id: data.zone_id,
        tipo: data.tipo,
        urgencia: data.urgencia,
        descripcion: data.descripcion ?? null,
      };

      const { data: row, error } = await client
        .from("needs")
        .insert(insert)
        .select(NEED_PUBLIC_COLUMNS)
        .single<NeedPublicRow>();

      if (error) throw new DbError(`No se pudo crear la necesidad: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de necesidad no devolvio fila.");
      return row;
    },
  };
}
