import { z } from "zod";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de zonas (mapa de la emergencia).
//   - ESCRITURA -> tabla base `zones` (service_role salta RLS).
//   - LECTURA PUBLICA -> SOLO la vista `zones_public` (oculta actualizado_por,
//     la identidad del voluntario que actualiza). Guardrail #1.
//
// Los tipos de fila se definen aqui (no en el types.ts compartido) para no tocar
// archivos de otros recursos. Espejan migrations/0001_init.sql (tabla zones) y
// migrations/0002_rls_policies.sql (vista zones_public).

// ── Tipos de fila ────────────────────────────────────────────────────────────

/** Fila de la vista publica `zones_public`: sin actualizado_por (identidad interna). */
export interface ZonePublicRow {
  id: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  estado: string | null;
  updated_at: string;
}

/** Zona publica del dominio (vista de mapa). Igual que la fila de la vista. */
export type PublicZone = ZonePublicRow;

/** Columnas seleccionables de `zones_public` (orden y nombres exactos de la vista). */
const ZONE_PUBLIC_COLUMNS =
  "id, nombre, lat, lng, estado, updated_at" as const;

// ── Validacion de entrada (zod) ──────────────────────────────────────────────

/** Coordenada opcional (lat/lng) o null. */
const coordenadaOpcional = z.number().nullable();

/**
 * Entrada de creacion de zona. `actualizado_por` (identidad del voluntario) es
 * interno: se acepta para auditoria pero NUNCA se devuelve en la vista publica.
 */
export const zoneCreateSchema = z.object({
  nombre: z.string().trim().min(1),
  lat: coordenadaOpcional.optional(),
  lng: coordenadaOpcional.optional(),
  estado: z.string().trim().min(1).nullable().optional(),
  actualizado_por: z.string().trim().min(1).nullable().optional(),
});
export type ZoneCreate = z.infer<typeof zoneCreateSchema>;

// ── Repositorio ──────────────────────────────────────────────────────────────

export interface ZoneRepo {
  /** LECTURA PUBLICA. Lista zonas desde la vista zones_public (sin actualizado_por). */
  listPublic(limit?: number): Promise<PublicZone[]>;
  /** ESCRITURA. Crea una zona en la tabla base. Devuelve la proyeccion publica. */
  create(input: ZoneCreate): Promise<PublicZone>;
}

/** Construye el repositorio de zonas sobre un cliente Supabase de servicio. */
export function createZoneRepo(client: DbClient): ZoneRepo {
  return {
    async listPublic(limit = 200): Promise<PublicZone[]> {
      // SOLO la vista publica: nunca la tabla base.
      const { data, error } = await client
        .from("zones_public")
        .select(ZONE_PUBLIC_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(limit)
        .returns<ZonePublicRow[]>();

      if (error) throw new DbError(`No se pudo listar zonas publicas: ${error.message}`, error.code);
      return data ?? [];
    },

    async create(input: ZoneCreate): Promise<PublicZone> {
      // Validacion de entrada externa (zod) antes de tocar la BD.
      const data = zoneCreateSchema.parse(input);

      const insert = {
        nombre: data.nombre,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        estado: data.estado ?? null,
        actualizado_por: data.actualizado_por ?? null,
      };

      // Insert en la tabla base; se devuelven SOLO las columnas publicas para que
      // actualizado_por no salga jamas en la respuesta (guardrail #1).
      const { data: row, error } = await client
        .from("zones")
        .insert(insert)
        .select(ZONE_PUBLIC_COLUMNS)
        .single<ZonePublicRow>();

      if (error) throw new DbError(`No se pudo crear la zona: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de zona no devolvio fila.");
      return row;
    },
  };
}
