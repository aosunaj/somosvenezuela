import { ownedPersonSchema, plataformaCanalSchema, type PlataformaCanal } from "core";
import { z } from "zod";
import type { ChannelLinkRepo, PersonRepo } from "db";
import { sensitiveRouteRateLimit } from "../rate-limit.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Ruta de "MIS REGISTROS" por canal: lista los registros que el DUENO creo desde su
// canal (plataforma + chatId), para que elija cual marcar/borrar SIN pegar codigos.
//
// SEGURIDAD/PRIVACIDAD (guardrail #1): la respuesta es la vista del dueno
// (`OwnedPerson`): id + datos para reconocerlo + estado. NUNCA contact_id ni dato de
// contacto. La identidad es el propio canal (mismo modelo de confianza que el borrado
// y el rescatado seguros): quien controla el chat ve SOLO sus propios registros.
//
// No devuelve 403 si el canal es desconocido o no tiene registros: responde una lista
// VACIA. Asi el bot puede decir "no tienes registros aqui" sin revelar nada de nadie.
//
// Para no tocar deps.ts, recibe sus repos (todos de `db`) por parametro explicito.

export interface PersonsMineDeps {
  /** Helper de vinculo: resuelve el contacto dueno de un canal. */
  channelLinkRepo: ChannelLinkRepo;
  /** Repo de personas: lista los registros ligados al contacto (vista del dueno). */
  personRepo: PersonRepo;
}

// Credenciales de propiedad del canal. Aceptadas en el body; con respaldo por
// headers (x-plataforma / x-chat-id) para clientes que no envian cuerpo.
const ownershipBodySchema = z
  .object({
    plataforma: plataformaCanalSchema,
    chatId: z.string().trim().min(1),
  })
  .strict();

/** Lee la prueba de propiedad del body o, en su defecto, de las cabeceras. */
function readOwnership(
  body: unknown,
  headers: Record<string, unknown>,
): { plataforma: PlataformaCanal; chatId: string } | null {
  // 1) Preferimos el body si trae algo.
  if (body !== undefined && body !== null && Object.keys(body as object).length > 0) {
    const parsed = ownershipBodySchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  }

  // 2) Respaldo por headers.
  const rawPlataforma = headers["x-plataforma"];
  const rawChatId = headers["x-chat-id"];
  const plataforma = Array.isArray(rawPlataforma) ? rawPlataforma[0] : rawPlataforma;
  const chatId = Array.isArray(rawChatId) ? rawChatId[0] : rawChatId;

  const parsed = ownershipBodySchema.safeParse({ plataforma, chatId });
  return parsed.success ? parsed.data : null;
}

// La respuesta es SIEMPRE la vista del dueno (sin contacto). Lista vacia = sin registros.
const mineResponseSchema = z.object({
  persons: z.array(ownedPersonSchema),
});

/**
 * Registra POST /persons/mine-by-channel.
 *
 * Body: { plataforma, chatId } (o cabeceras x-plataforma / x-chat-id). Resuelve el
 * contacto dueno del canal y devuelve sus registros (vista del dueno). Sin prueba de
 * propiedad valida, o canal desconocido, responde { persons: [] } (nunca 403).
 */
export function registerPersonsMineRoutes(app: FastifyInstance, deps: PersonsMineDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.route({
    method: "POST",
    url: "/persons/mine-by-channel",
    // Rate limit ESTRICTO (guardrail #6): lectura sensible por canal (anti-enumeracion).
    config: sensitiveRouteRateLimit,
    schema: {
      response: { 200: mineResponseSchema },
    },
    handler: async (request, reply) => {
      const ownership = readOwnership(request.body, request.headers as Record<string, unknown>);
      if (ownership === null) {
        // Sin prueba de propiedad valida: lista vacia (no revelamos nada).
        return reply.code(200).send({ persons: [] });
      }

      const contactId = await deps.channelLinkRepo.findContactByChannel(
        ownership.plataforma,
        ownership.chatId,
      );
      if (contactId === null) {
        // Canal desconocido: el usuario no tiene registros ligados aqui.
        return reply.code(200).send({ persons: [] });
      }

      const persons = await deps.personRepo.listByContact(contactId);
      return reply.code(200).send({ persons });
    },
  });
}
