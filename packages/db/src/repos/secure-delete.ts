import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de BORRADO SEGURO (derecho al olvido del propio dueno). INTERNO.
//
// CRITICO (guardrail #1/#5 derecho al borrado): el borrado por canal lo autoriza el
// dueno del canal. Esta capa encapsula dos operaciones de datos que la ruta NO debe
// implementar a mano:
//
//   1) getPersonContactId: lee SOLO el contact_id de una persona (tabla base), para
//      comprobar que pertenece al contacto dueno del canal. No expone mas datos.
//   2) deletePersonAndOwner: borra la persona y, si tiene contacto, ese contacto.
//      Por las FK del esquema: borrar el contacto CASCADEA sus channels
//      (channels.contact_id on delete cascade) y deja notifications a null
//      (channel_id on delete set null) sin huerfanos sensibles. La persona se borra
//      explicitamente porque persons.contact_id es on delete SET NULL (no cascade):
//      borrar solo el contacto dejaria la persona viva sin contacto.

/** Fila minima de persona para autorizar el borrado: solo el contacto ligado. */
interface PersonContactRow {
  contact_id: string | null;
}

export interface SecureDeleteRepo {
  /**
   * Devuelve el contact_id de una persona (o null si la persona no existe o no
   * tiene contacto). Lectura INTERNA minima: no devuelve ningun otro campo.
   */
  getPersonContactId(personId: string): Promise<string | null>;
  /**
   * Borra la persona y, si lo tiene, su contacto (arrastrando channels por FK y
   * limpiando notifications). Derecho al olvido sin dejar huerfanos sensibles.
   */
  deletePersonAndOwner(personId: string, contactId: string | null): Promise<void>;
}

/** Construye el repositorio de borrado seguro sobre un cliente Supabase de servicio. */
export function createSecureDeleteRepo(client: DbClient): SecureDeleteRepo {
  return {
    async getPersonContactId(personId: string): Promise<string | null> {
      const { data, error } = await client
        .from("persons")
        .select("contact_id")
        .eq("id", personId)
        .maybeSingle<PersonContactRow>();

      if (error) throw new DbError(`No se pudo resolver la persona: ${error.message}`, error.code);
      return data?.contact_id ?? null;
    },

    async deletePersonAndOwner(
      personId: string,
      contactId: string | null,
    ): Promise<void> {
      // 1) Borra la persona (persons.contact_id es SET NULL, no cascade).
      const { error: personError } = await client
        .from("persons")
        .delete()
        .eq("id", personId);
      if (personError) {
        throw new DbError(`No se pudo borrar la persona: ${personError.message}`, personError.code);
      }

      // 2) Borra el contacto dueno: CASCADEA channels y limpia notifications.
      if (contactId !== null) {
        const { error: contactError } = await client
          .from("contacts")
          .delete()
          .eq("id", contactId);
        if (contactError) {
          throw new DbError(`No se pudo borrar el contacto: ${contactError.message}`, contactError.code);
        }
      }
    },
  };
}
