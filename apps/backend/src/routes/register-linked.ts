import { z } from "zod";
import { fuenteDatoSchema, plataformaCanalSchema } from "core";
import type { ChannelLinkRepo, PersonRepo } from "db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Ruta de ALTA VINCULADA (adaptador FINO): registra una persona y la liga al canal
// de mensajeria que la reporto, para poder NOTIFICAR despues por ese canal.
//
// SEGURIDAD/PRIVACIDAD (guardrail #1): el cuerpo trae datos de canal SENSIBLES
// (chat_id, telefono). La respuesta NUNCA devuelve contacto ni canal: solo el
// personId. El contacto/canal viven en tablas con RLS (solo service_role).
//
// Para no tocar deps.ts, este registrador recibe los repos que necesita (PersonRepo
// y ChannelLinkRepo, ambos de `db`) por parametro explicito.

// Dependencias propias de esta ruta (no se modifica AppDeps).
export interface RegisterLinkedDeps {
  /** Repositorio de personas (escritura en tabla base con contact_id). */
  personRepo: PersonRepo;
  /** Helper de vinculo contacto<->canal (crea/reutiliza contact + channel). */
  channelLinkRepo: ChannelLinkRepo;
}

// Persona SIN contacto: el contact_id lo resuelve el vinculo, no el cliente.
// estado/verificacion los fija el dominio/BD (guardrails #3/#4); no se aceptan.
const personSinContactoSchema = z
  .object({
    nombre: z.string().trim().min(1),
    apellidos: z.string().trim().min(1).nullable().optional(),
    edad: z.number().int().min(0).max(129).nullable().optional(),
    zona: z.string().trim().min(1).nullable().optional(),
    descripcion: z.string().trim().min(1).nullable().optional(),
    fuente: fuenteDatoSchema.optional(),
  })
  .strict();

const channelSchema = z
  .object({
    plataforma: plataformaCanalSchema,
    chatId: z.string().trim().min(1),
    telefono: z.string().trim().min(1).optional(),
  })
  .strict();

export const registerPersonBodySchema = z
  .object({
    person: personSinContactoSchema,
    channel: channelSchema,
  })
  .strict();

// Respuesta minima: SOLO el id de la persona. Nunca contacto ni canal.
const registerPersonResponseSchema = z.object({
  personId: z.uuid(),
});

/**
 * Registra POST /register-person.
 *
 * Body: { person: PersonCreate-sin-contacto, channel: { plataforma, chatId, telefono? } }.
 * Flujo: asegura el vinculo (contact + channel, opt_in) -> crea la persona con ese
 * contact_id -> responde 201 { personId }. La respuesta NO incluye contacto/canal.
 */
export function registerRegisterLinkedRoutes(
  app: FastifyInstance,
  deps: RegisterLinkedDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.route({
    method: "POST",
    url: "/register-person",
    schema: {
      body: registerPersonBodySchema,
      response: { 201: registerPersonResponseSchema },
    },
    handler: async (request, reply) => {
      const { person, channel } = request.body;

      // 1) Vinculo contacto<->canal (SENSIBLE; nunca sale en la respuesta).
      const { contactId } = await deps.channelLinkRepo.ensureChannel({
        plataforma: channel.plataforma,
        chatId: channel.chatId,
        telefono: channel.telefono,
      });

      // 2) Alta de persona ligada al contacto resuelto.
      const persona = await deps.personRepo.create({
        nombre: person.nombre,
        apellidos: person.apellidos ?? undefined,
        edad: person.edad ?? undefined,
        zona: person.zona ?? undefined,
        descripcion: person.descripcion ?? undefined,
        fuente: person.fuente,
        contact_id: contactId,
      });

      // 3) Respuesta minima: solo el id. Sin contacto ni canal (guardrail #1).
      return reply.code(201).send({ personId: persona.id });
    },
  });
}
