import { z } from "zod";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";
import type { ContactRow } from "../types.js";

// Repositorio de contactos. SENSIBLE (PII: telefono/email).
//
// CRITICO (guardrail #1): los datos de contacto NUNCA son publicos. Este repo es
// de uso EXCLUSIVO del backend (service_role). NO expone metodos "publicos" ni
// vistas; no existe proyeccion publica de un contacto. Solo se usa para notificar
// internamente. La web/bots jamas leen estas filas.

/** Tipo de dominio de un contacto (interno). Definido aqui: core no lo expone (es sensible). */
export interface Contact {
  id: string;
  telefono: string | null;
  email: string | null;
  solo_uso_interno: boolean;
  created_at: string;
}

/** Entrada de creacion de contacto. Al menos telefono o email debe venir. */
export const contactCreateSchema = z
  .object({
    telefono: z.string().trim().min(1).nullable().optional(),
    email: z.email().nullable().optional(),
  })
  .refine(
    (c) => Boolean(c.telefono) || Boolean(c.email),
    "Un contacto necesita al menos telefono o email.",
  );
export type ContactCreate = z.infer<typeof contactCreateSchema>;

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    telefono: row.telefono,
    email: row.email,
    solo_uso_interno: row.solo_uso_interno,
    created_at: row.created_at,
  };
}

export interface ContactRepo {
  /** ESCRITURA INTERNA. Crea un contacto. Solo backend. */
  create(input: ContactCreate): Promise<Contact>;
  /** LECTURA INTERNA. Obtiene un contacto por id. Solo backend; nunca a clientes publicos. */
  getById(id: string): Promise<Contact | null>;
  /** BORRADO (derecho al olvido). Elimina el contacto por id. */
  remove(id: string): Promise<void>;
}

/** Construye el repositorio de contactos sobre un cliente Supabase de servicio. */
export function createContactRepo(client: DbClient): ContactRepo {
  return {
    async create(input: ContactCreate): Promise<Contact> {
      const data = contactCreateSchema.parse(input);
      const insert = {
        telefono: data.telefono ?? null,
        email: data.email ?? null,
      };

      const { data: row, error } = await client
        .from("contacts")
        .insert(insert)
        .select("*")
        .single<ContactRow>();

      if (error) throw new DbError(`No se pudo crear el contacto: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de contacto no devolvio fila.");
      return rowToContact(row);
    },

    async getById(id: string): Promise<Contact | null> {
      const { data, error } = await client
        .from("contacts")
        .select("*")
        .eq("id", id)
        .maybeSingle<ContactRow>();

      if (error) throw new DbError(`No se pudo obtener el contacto: ${error.message}`, error.code);
      return data ? rowToContact(data) : null;
    },

    async remove(id: string): Promise<void> {
      const { error } = await client.from("contacts").delete().eq("id", id);
      if (error) throw new DbError(`No se pudo borrar el contacto: ${error.message}`, error.code);
    },
  };
}
