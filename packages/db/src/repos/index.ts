// Barrel de repositorios de la capa de datos.
// Cada repo se construye con un cliente Supabase de servicio (inyectado).

export * from "./person.js";
export * from "./pet.js";
export * from "./pet-extra.js";
export * from "./search.js";
export * from "./contact.js";
export * from "./channel.js";
export * from "./channel-link.js";
export * from "./notification.js";
export * from "./secure-delete.js";
export * from "./zone.js";
export * from "./need.js";

import type { DbClient } from "../client.js";
import { createChannelRepo, type ChannelRepo } from "./channel.js";
import {
  createChannelLinkRepo,
  type ChannelLinkRepo,
} from "./channel-link.js";
import { createContactRepo, type ContactRepo } from "./contact.js";
import {
  createNotificationRepo,
  type NotificationRepo,
} from "./notification.js";
import { createPersonRepo, type PersonRepo } from "./person.js";
import { createPetRepo, type PetRepo } from "./pet.js";
import { createPetSearchRepo, type PetSearchRepo } from "./pet-extra.js";
import { createZoneRepo, type ZoneRepo } from "./zone.js";
import { createNeedRepo, type NeedRepo } from "./need.js";
import { createSearchRepo, type SearchRepo } from "./search.js";
import {
  createSecureDeleteRepo,
  type SecureDeleteRepo,
} from "./secure-delete.js";

/** Conjunto de repositorios de la capa de datos. */
export interface Repos {
  persons: PersonRepo;
  pets: PetRepo;
  /** Busqueda difusa publica de mascotas (RPC pg_trgm). */
  petSearch: PetSearchRepo;
  searches: SearchRepo;
  /** Zonas afectadas (lectura publica + alta por voluntarios). */
  zones: ZoneRepo;
  /** Necesidades por zona (lectura publica + alta por voluntarios). */
  needs: NeedRepo;
  /** SENSIBLE: solo backend. */
  contacts: ContactRepo;
  /** SENSIBLE: solo backend. */
  channels: ChannelRepo;
  /** SENSIBLE: solo backend. Vinculo contacto<->canal (opt_in) para notificar. */
  channelLinks: ChannelLinkRepo;
  /** INTERNO: solo backend. Cola de notificaciones para el worker/bot. */
  notifications: NotificationRepo;
  /** INTERNO: solo backend. Borrado seguro por el dueno (derecho al olvido). */
  secureDelete: SecureDeleteRepo;
}

/**
 * Construye todos los repositorios sobre un mismo cliente Supabase de servicio.
 * Punto unico de cableado para el backend.
 */
export function createRepos(client: DbClient): Repos {
  return {
    persons: createPersonRepo(client),
    pets: createPetRepo(client),
    petSearch: createPetSearchRepo(client),
    searches: createSearchRepo(client),
    zones: createZoneRepo(client),
    needs: createNeedRepo(client),
    contacts: createContactRepo(client),
    channels: createChannelRepo(client),
    channelLinks: createChannelLinkRepo(client),
    notifications: createNotificationRepo(client),
    secureDelete: createSecureDeleteRepo(client),
  };
}
