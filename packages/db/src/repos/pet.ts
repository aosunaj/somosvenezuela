import {
  DEFAULT_FUENTE,
  petCreateSchema,
  type Pet,
  type PetCreate,
  type PublicPet,
} from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import { publicRowToPublicPet, rowToPet } from "../mappers.js";
import {
  PET_PUBLIC_COLUMNS,
  type PetPublicRow,
  type PetRow,
} from "../types.js";

// Repositorio de mascotas.
//   - ESCRITURA -> tabla base `pets`.
//   - LECTURA PUBLICA -> SOLO la vista `pets_public` (sin contact_id).

export interface PetRepo {
  /** ESCRITURA. Crea una mascota en la tabla base. Devuelve el registro completo (interno). */
  create(input: PetCreate): Promise<Pet>;
  /** LECTURA PUBLICA. Lista mascotas desde la vista pets_public (sin contacto). */
  listPublic(limit?: number): Promise<PublicPet[]>;
  /** LECTURA PUBLICA. Obtiene una mascota publica por id (null si no existe). */
  getPublic(id: string): Promise<PublicPet | null>;
  /** BORRADO. Elimina la mascota de la tabla base por id. */
  remove(id: string): Promise<void>;
}

/** Construye el repositorio de mascotas sobre un cliente Supabase de servicio. */
export function createPetRepo(client: DbClient): PetRepo {
  return {
    async create(input: PetCreate): Promise<Pet> {
      const data = petCreateSchema.parse(input);

      const insert = {
        nombre: data.nombre ?? null,
        tipo: data.tipo ?? null,
        raza: data.raza ?? null,
        zona: data.zona ?? null,
        foto_url: data.foto_url ?? null,
        fuente: data.fuente ?? DEFAULT_FUENTE,
        contact_id: data.contact_id ?? null,
      };

      const { data: row, error } = await client
        .from("pets")
        .insert(insert)
        .select("*")
        .single<PetRow>();

      if (error) throw new DbError(`No se pudo crear la mascota: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de mascota no devolvio fila.");
      return rowToPet(row);
    },

    async listPublic(limit = 50): Promise<PublicPet[]> {
      const { data, error } = await client
        .from("pets_public")
        .select(PET_PUBLIC_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<PetPublicRow[]>();

      if (error) throw new DbError(`No se pudo listar mascotas publicas: ${error.message}`, error.code);
      return (data ?? []).map(publicRowToPublicPet);
    },

    async getPublic(id: string): Promise<PublicPet | null> {
      const { data, error } = await client
        .from("pets_public")
        .select(PET_PUBLIC_COLUMNS)
        .eq("id", id)
        .maybeSingle<PetPublicRow>();

      if (error) throw new DbError(`No se pudo obtener mascota publica: ${error.message}`, error.code);
      return data ? publicRowToPublicPet(data) : null;
    },

    async remove(id: string): Promise<void> {
      const { error } = await client.from("pets").delete().eq("id", id);
      if (error) throw new DbError(`No se pudo borrar la mascota: ${error.message}`, error.code);
    },
  };
}
