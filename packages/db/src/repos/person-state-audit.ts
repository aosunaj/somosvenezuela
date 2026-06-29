import type { EstadoPersona } from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de AUDITORIA de cambios de estado de personas (guardrail #8). INTERNO.
//
// Registra QUIEN y CUANDO provoco una transicion de estado sensible (rescatado,
// y a futuro borrado/fallecida/reunida). Escribe en la tabla `person_state_changes`
// (RLS deny-all; solo backend service_role). No contiene logica de negocio: solo
// persiste el evento que la capa de aplicacion ya decidio registrar.

/** Datos de un evento de cambio de estado a registrar. */
export interface PersonStateChangeInput {
  /** Persona cuyo estado cambia. */
  personId: string;
  /** Estado nuevo tras la transicion (obligatorio). */
  estadoNuevo: EstadoPersona;
  /**
   * Estado anterior. Opcional: si el flujo no lo leyo, se deja null (la columna lo
   * permite). En el rescatado se deja null para no anadir una lectura extra.
   */
  estadoAnterior?: EstadoPersona | null;
  /**
   * Contacto que provoco el cambio (QUIEN). En el rescatado por canal es el dueno
   * del canal que ya resolvio la autorizacion. Null si no se conoce.
   */
  changedByContactId?: string | null;
}

export interface PersonStateAuditRepo {
  /**
   * Inserta UNA fila de auditoria del cambio de estado. `changed_at` lo fija el
   * DEFAULT now() del esquema (no lo pasamos para que sea la hora de la BD).
   */
  record(input: PersonStateChangeInput): Promise<void>;
}

/** Construye el repositorio de auditoria sobre un cliente Supabase de servicio. */
export function createPersonStateAuditRepo(client: DbClient): PersonStateAuditRepo {
  return {
    async record(input: PersonStateChangeInput): Promise<void> {
      const insert = {
        person_id: input.personId,
        estado_nuevo: input.estadoNuevo,
        estado_anterior: input.estadoAnterior ?? null,
        changed_by_contact_id: input.changedByContactId ?? null,
        // changed_at lo pone el DEFAULT now() del esquema (hora de la BD).
      };

      const { error } = await client.from("person_state_changes").insert(insert);
      if (error) {
        throw new DbError(
          `No se pudo registrar la auditoria de cambio de estado: ${error.message}`,
          error.code,
        );
      }
    },
  };
}
