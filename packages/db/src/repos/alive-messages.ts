import {
  aliveMessageCreateSchema,
  type AliveMessage,
  type AliveMessageCreate,
} from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import type { AliveMessageRow } from "../types.js";

// Repositorio de mensajes "estoy vivo" (alive_messages).
//
// GUARDRAIL: autor_nombre es un nombre libre del autor — NUNCA un contact_id ni
// dato de contacto. El dominio devuelto (AliveMessage) no contiene contact_id.
// RLS deny-all: el cliente DEBE ser service_role.

/** Mapa de fila BD (snake_case) al tipo de dominio (camelCase). */
function rowToAliveMessage(row: AliveMessageRow): AliveMessage {
  return {
    id: row.id,
    autorNombre: row.autor_nombre,
    tipo: row.tipo as AliveMessage["tipo"],
    contenido: row.contenido,
    zona: row.zona,
    personId: row.person_id,
    entregado: row.entregado,
    createdAt: row.created_at,
  };
}

export interface AliveMessagesRepo {
  /** ESCRITURA. Crea un mensaje "estoy vivo". Devuelve el registro de dominio. */
  create(input: AliveMessageCreate): Promise<AliveMessage>;
  /** LECTURA. Obtiene un mensaje por id (null si no existe). */
  getById(id: string): Promise<AliveMessage | null>;
  /**
   * LECTURA. Lista los mensajes NO entregados de una persona (entregado=false).
   * Se usa al confirmar un match: se entregan todos los mensajes pendientes.
   */
  getPendingByPersonId(personId: string): Promise<AliveMessage[]>;
  /** ESCRITURA. Marca el mensaje como entregado (entregado=true). */
  markDelivered(id: string): Promise<void>;
  // NOTE: deleteByAuthor is intentionally absent from Slice 1.
  // The signature promised ownership verification but ignored the param (deceptive contract).
  // It returns in a later slice with a real ownership column + check.
}

/** Construye el repositorio sobre un cliente Supabase de servicio. */
export function createAliveMessagesRepo(client: DbClient): AliveMessagesRepo {
  return {
    async create(input: AliveMessageCreate): Promise<AliveMessage> {
      // Validate external input with Zod before touching the DB.
      const data = aliveMessageCreateSchema.parse(input);

      const insert = {
        autor_nombre: data.autorNombre,
        tipo: data.tipo,
        contenido: data.contenido,
        zona: data.zona ?? null,
        person_id: data.personId ?? null,
        // entregado defaults to false (schema default); created_at defaults to now().
      };

      const { data: row, error } = await client
        .from("alive_messages")
        .insert(insert)
        .select("*")
        .single<AliveMessageRow>();

      if (error)
        throw new DbError(
          `No se pudo crear el mensaje de vida: ${error.message}`,
          error.code,
        );
      if (!row) throw new DbError("Insert de alive_message no devolvió fila.");
      return rowToAliveMessage(row);
    },

    async getById(id: string): Promise<AliveMessage | null> {
      const { data, error } = await client
        .from("alive_messages")
        .select("*")
        .eq("id", id)
        .maybeSingle<AliveMessageRow>();

      if (error)
        throw new DbError(
          `No se pudo obtener el mensaje de vida: ${error.message}`,
          error.code,
        );
      return data ? rowToAliveMessage(data) : null;
    },

    async getPendingByPersonId(personId: string): Promise<AliveMessage[]> {
      const { data, error } = await client
        .from("alive_messages")
        .select("*")
        .eq("person_id", personId)
        .eq("entregado", false)
        .order("created_at", { ascending: true })
        .returns<AliveMessageRow[]>();

      if (error)
        throw new DbError(
          `No se pudieron obtener mensajes pendientes: ${error.message}`,
          error.code,
        );
      return (data ?? []).map(rowToAliveMessage);
    },

    async markDelivered(id: string): Promise<void> {
      const { error } = await client
        .from("alive_messages")
        .update({ entregado: true })
        .eq("id", id);

      if (error)
        throw new DbError(
          `No se pudo marcar el mensaje como entregado: ${error.message}`,
          error.code,
        );
    },
  };
}
