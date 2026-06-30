import { z } from "zod";
import { plataformaCanalSchema, type PlataformaCanal } from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import type { ChannelRow } from "../types.js";
import { createContactRepo } from "./contact.js";
import { createChannelRepo } from "./channel.js";

// Helper de VINCULO usuario <-> canal. INTERNO (contacts/channels SENSIBLES con
// RLS: solo service_role). Resuelve dos operaciones que cruzan ambas tablas:
//
//   1) ensureChannel: dado un canal de mensajeria (plataforma + chat_id), asegura
//      que exista un contact y su channel (opt_in) para poder NOTIFICAR despues.
//      Idempotente por (plataforma, chat_id): si ya hay canal, reutiliza su contacto.
//   2) findContactByChannel: dado (plataforma, chat_id) devuelve el contact_id
//      dueno, o null. Sirve para AUTORIZAR el borrado seguro (el dueno del canal es
//      el unico que puede borrar la persona ligada a su contacto).
//
// Reutiliza contactRepo/channelRepo para la escritura (sin duplicar inserts). La
// busqueda por (plataforma, chat_id) NO existe en channelRepo, asi que el acceso
// minimo de lectura se replica aqui (no se tocan los repos existentes).

/** Entrada para asegurar un vinculo contacto<->canal. */
export const ensureChannelSchema = z
  .object({
    contactId: z.uuid().optional(),
    plataforma: plataformaCanalSchema,
    chatId: z.string().trim().min(1),
    telefono: z.string().trim().min(1).optional(),
  })
  .strict();
export type EnsureChannelInput = z.infer<typeof ensureChannelSchema>;

/** Identificadores del vinculo resuelto. SENSIBLE: solo uso interno. */
export interface ChannelLink {
  contactId: string;
  channelId: string;
}

export interface ChannelLinkRepo {
  /**
   * Asegura contact + channel para (plataforma, chatId). Idempotente: si el canal
   * ya existe lo reutiliza (junto a su contacto); si no, crea contacto (con
   * telefono opcional) y canal con opt_in=true. Devuelve { contactId, channelId }.
   */
  ensureChannel(input: EnsureChannelInput): Promise<ChannelLink>;
  /**
   * Resuelve el contacto dueno de un canal (plataforma, chatId), o null. Usado para
   * AUTORIZAR el borrado seguro (derecho al olvido por el propio dueno).
   */
  findContactByChannel(
    plataforma: PlataformaCanal,
    chatId: string,
  ): Promise<string | null>;
  /**
   * Resuelve el channel_id (UUID interno) de un canal (plataforma, chatId), o null.
   * Las rutas by-channel (relay close, rescatado) reciben (plataforma, chatId) del
   * bot y necesitan el UUID interno para operar sin exponer PII (guardrail #1).
   */
  findChannelIdByChannel(
    plataforma: PlataformaCanal,
    chatId: string,
  ): Promise<string | null>;
}

/** Construye el helper de vinculo sobre un cliente Supabase de servicio. */
export function createChannelLinkRepo(client: DbClient): ChannelLinkRepo {
  const contacts = createContactRepo(client);
  const channels = createChannelRepo(client);

  /** Lectura minima de un canal por (plataforma, chat_id). Devuelve la fila o null. */
  async function findChannelRow(
    plataforma: PlataformaCanal,
    chatId: string,
  ): Promise<ChannelRow | null> {
    const { data, error } = await client
      .from("channels")
      .select("*")
      .eq("plataforma", plataforma)
      .eq("chat_id", chatId)
      .maybeSingle<ChannelRow>();

    if (error) throw new DbError(`No se pudo resolver el canal: ${error.message}`, error.code);
    return data ?? null;
  }

  return {
    async ensureChannel(input: EnsureChannelInput): Promise<ChannelLink> {
      const data = ensureChannelSchema.parse(input);

      // 1) Si el canal ya existe, reutiliza contacto + canal (idempotencia).
      const existing = await findChannelRow(data.plataforma, data.chatId);
      if (existing !== null) {
        return { contactId: existing.contact_id, channelId: existing.id };
      }

      // 2) Resuelve el contacto: el indicado, o uno nuevo. Un contacto necesita al
      //    menos telefono o email; si no llega telefono, se usa el chat_id como
      //    identificador interno de transporte (SENSIBLE, nunca publico) para no
      //    crear contactos sin ningun dato de alcance.
      const contactId =
        data.contactId ??
        (await contacts.create({ telefono: data.telefono ?? data.chatId })).id;

      // 3) Crea el canal vinculado, con opt_in habilitado para poder notificar.
      const channel = await channels.create({
        contact_id: contactId,
        plataforma: data.plataforma,
        chat_id: data.chatId,
        opt_in: true,
      });

      return { contactId, channelId: channel.id };
    },

    async findContactByChannel(
      plataforma: PlataformaCanal,
      chatId: string,
    ): Promise<string | null> {
      const row = await findChannelRow(plataforma, chatId);
      return row?.contact_id ?? null;
    },

    async findChannelIdByChannel(
      plataforma: PlataformaCanal,
      chatId: string,
    ): Promise<string | null> {
      const row = await findChannelRow(plataforma, chatId);
      return row?.id ?? null;
    },
  };
}
