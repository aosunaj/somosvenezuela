// Barrel de repositorios de la capa de datos.
// Cada repo se construye con un cliente Supabase de servicio (inyectado).

export * from "./person.js";
export * from "./pet.js";
export * from "./search.js";
export * from "./contact.js";
export * from "./channel.js";

import type { DbClient } from "../client.js";
import { createChannelRepo, type ChannelRepo } from "./channel.js";
import { createContactRepo, type ContactRepo } from "./contact.js";
import { createPersonRepo, type PersonRepo } from "./person.js";
import { createPetRepo, type PetRepo } from "./pet.js";
import { createSearchRepo, type SearchRepo } from "./search.js";

/** Conjunto de repositorios de la capa de datos. */
export interface Repos {
  persons: PersonRepo;
  pets: PetRepo;
  searches: SearchRepo;
  /** SENSIBLE: solo backend. */
  contacts: ContactRepo;
  /** SENSIBLE: solo backend. */
  channels: ChannelRepo;
}

/**
 * Construye todos los repositorios sobre un mismo cliente Supabase de servicio.
 * Punto unico de cableado para el backend.
 */
export function createRepos(client: DbClient): Repos {
  return {
    persons: createPersonRepo(client),
    pets: createPetRepo(client),
    searches: createSearchRepo(client),
    contacts: createContactRepo(client),
    channels: createChannelRepo(client),
  };
}
