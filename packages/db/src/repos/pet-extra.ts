import type { PublicPet } from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import { publicRowToPublicPet } from "../mappers.js";
import type { PetPublicRow } from "../types.js";

// Extension del repositorio de mascotas: busqueda publica difusa.
//
// Vive en un archivo aparte de pet.ts (que ya define create/listPublic/getPublic/
// remove) para no colisionar con otro flujo de trabajo. Mismo contrato de
// privacidad: la RPC search_pets_public lee SOLO la vista pets_public, por lo que
// los resultados llevan score, fuente y verificacion visibles y JAMAS contact_id
// (guardrail #1). Espeja searchPersonsPublic del repo de personas.

/** Datos de busqueda publica de mascotas (resultado con score). */
export interface PublicPetResult extends PublicPet {
  /** Similitud trigram [0..1]; mayor = mas probable. */
  score: number;
}

/** Fila devuelta por la RPC search_pets_public (vista publica + score). */
interface PetSearchRow extends PetPublicRow {
  score: number;
}

/** Repositorio de busqueda publica de mascotas. */
export interface PetSearchRepo {
  /** LECTURA PUBLICA. Busqueda difusa (pg_trgm) por nombre/tipo/raza/zona, ordenada por score. */
  searchPetsPublic(query: string, zona?: string): Promise<PublicPetResult[]>;
}

/** Construye el repositorio de busqueda de mascotas sobre un cliente Supabase de servicio. */
export function createPetSearchRepo(client: DbClient): PetSearchRepo {
  return {
    async searchPetsPublic(query: string, zona?: string): Promise<PublicPetResult[]> {
      // Busqueda difusa via RPC search_pets_public (lee la vista, ordena por score).
      const { data, error } = await client.rpc("search_pets_public", {
        q: query,
        zona_filtro: zona ?? null,
      });

      if (error) throw new DbError(`No se pudo buscar mascotas: ${error.message}`, error.code);

      // La RPC devuelve filas de la vista pets_public + score. Se tipa explicitamente
      // el shape conocido (no se usan tipos generados de la BD en esta fase).
      const rows = (data ?? []) as PetSearchRow[];
      return rows.map((row) => {
        const { score, ...publicRow } = row;
        return { ...publicRowToPublicPet(publicRow), score };
      });
    },
  };
}
