import { z } from "zod";
import { plataformaCanalSchema, type PlataformaCanal } from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import type { ChannelRow } from "../types.js";

// Repositorio de canales (vinculo contacto <-> mensajeria). SENSIBLE (chat_id).
//
// CRITICO (guardrail #1): un canal liga a una persona con su chat de Telegram/
// WhatsApp; chat_id es PII de transporte. Uso EXCLUSIVO del backend (service_role)
// para entregar notificaciones. NO hay metodos "publicos" ni vista publica.

/** Tipo de dominio de un canal (interno). Sensible: core no lo expone. */
export interface Channel {
  id: string;
  contact_id: string;
  plataforma: PlataformaCanal;
  chat_id: string;
  opt_in: boolean;
  created_at: string;
}

/** Entrada de creacion de canal. */
export const channelCreateSchema = z.object({
  contact_id: z.uuid(),
  plataforma: plataformaCanalSchema,
  chat_id: z.string().trim().min(1),
  opt_in: z.boolean().optional(),
});
export type ChannelCreate = z.infer<typeof channelCreateSchema>;

function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    contact_id: row.contact_id,
    plataforma: row.plataforma,
    chat_id: row.chat_id,
    opt_in: row.opt_in,
    created_at: row.created_at,
  };
}

/**
 * Direccion de transporte de un canal: SOLO (plataforma, chat_id). Es lo minimo
 * que un bot necesita para entregar; NO incluye contact_id ni telefono. Sirve para
 * enriquecer la cola de notificaciones sin reintroducir PII de contacto.
 */
export interface ChannelTransport {
  plataforma: PlataformaCanal;
  chat_id: string;
}

export interface ChannelRepo {
  /** ESCRITURA INTERNA. Crea un canal para un contacto. Solo backend. */
  create(input: ChannelCreate): Promise<Channel>;
  /** LECTURA INTERNA. Lista los canales de un contacto (para notificar). Solo backend. */
  listByContact(contactId: string): Promise<Channel[]>;
  /**
   * LECTURA INTERNA. Resuelve la direccion de transporte (plataforma, chat_id) de
   * un canal por id, o null. Solo expone lo necesario para entregar; NO contact_id.
   */
  getTransport(id: string): Promise<ChannelTransport | null>;
  /** BORRADO (derecho al olvido). Elimina un canal por id. */
  remove(id: string): Promise<void>;
}

/** Construye el repositorio de canales sobre un cliente Supabase de servicio. */
export function createChannelRepo(client: DbClient): ChannelRepo {
  return {
    async create(input: ChannelCreate): Promise<Channel> {
      const data = channelCreateSchema.parse(input);
      const insert = {
        contact_id: data.contact_id,
        plataforma: data.plataforma,
        chat_id: data.chat_id,
        opt_in: data.opt_in ?? true,
      };

      const { data: row, error } = await client
        .from("channels")
        .insert(insert)
        .select("*")
        .single<ChannelRow>();

      if (error) throw new DbError(`No se pudo crear el canal: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de canal no devolvio fila.");
      return rowToChannel(row);
    },

    async listByContact(contactId: string): Promise<Channel[]> {
      const { data, error } = await client
        .from("channels")
        .select("*")
        .eq("contact_id", contactId)
        .returns<ChannelRow[]>();

      if (error) throw new DbError(`No se pudieron listar los canales: ${error.message}`, error.code);
      return (data ?? []).map(rowToChannel);
    },

    async getTransport(id: string): Promise<ChannelTransport | null> {
      // Selecciona SOLO la direccion de transporte: jamas contact_id ni telefono.
      const { data, error } = await client
        .from("channels")
        .select("plataforma, chat_id")
        .eq("id", id)
        .maybeSingle<ChannelTransport>();

      if (error) throw new DbError(`No se pudo resolver el canal: ${error.message}`, error.code);
      return data ?? null;
    },

    async remove(id: string): Promise<void> {
      const { error } = await client.from("channels").delete().eq("id", id);
      if (error) throw new DbError(`No se pudo borrar el canal: ${error.message}`, error.code);
    },
  };
}
