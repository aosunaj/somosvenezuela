import { z } from "zod";
import { plataformaCanalSchema, type PlataformaCanal } from "core";
import type { ChannelLinkRepo, SecureDeleteRepo } from "db";
import { apiError } from "../errors.js";
import { idParamsSchema } from "../schemas.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Ruta de BORRADO SEGURO por canal (derecho al olvido del propio dueno).
//
// Distinto del DELETE /persons/:id (auth de servicio): aqui el solicitante prueba
// la PROPIEDAD demostrando que controla el canal (plataforma + chatId) ligado al
// contacto de esa persona. Si coincide -> borra persona + contacto (cascada de
// canales) y responde 204. Si NO -> 403. No se filtra si la persona existe.
//
// Para no tocar deps.ts, recibe sus repos (ambos de `db`) por parametro explicito.

export interface DeleteSecureDeps {
  /** Helper de vinculo: resuelve el contacto dueno de un canal. */
  channelLinkRepo: ChannelLinkRepo;
  /** Borrado seguro: lee el contacto de la persona y borra sin huerfanos. */
  secureDeleteRepo: SecureDeleteRepo;
}

// Credenciales de propiedad del canal. Aceptadas en el body; con respaldo por
// headers (x-plataforma / x-chat-id) para clientes que no envian cuerpo en DELETE.
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

/**
 * Registra DELETE /persons/:id/by-channel.
 *
 * Autoriza por PROPIEDAD del canal: findContactByChannel(plataforma, chatId) debe
 * coincidir con el contact_id de la persona. 204 si autorizado, 403 si no.
 */
export function registerDeleteSecureRoutes(
  app: FastifyInstance,
  deps: DeleteSecureDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.route({
    method: "DELETE",
    url: "/persons/:id/by-channel",
    schema: {
      params: idParamsSchema,
    },
    handler: async (request, reply) => {
      const ownership = readOwnership(request.body, request.headers as Record<string, unknown>);
      if (ownership === null) {
        // Sin prueba de propiedad valida: no autorizado (no revelamos detalles).
        return reply
          .code(403)
          .send(apiError("forbidden", "No autorizado para borrar este registro."));
      }

      const personId = request.params.id;

      // Contacto dueno del canal probado y contacto ligado a la persona.
      const [ownerContactId, personContactId] = await Promise.all([
        deps.channelLinkRepo.findContactByChannel(ownership.plataforma, ownership.chatId),
        deps.secureDeleteRepo.getPersonContactId(personId),
      ]);

      // Autorizado SOLO si ambos resuelven al MISMO contacto. Si la persona no tiene
      // contacto, o el canal no existe, o no coinciden -> 403.
      const autorizado =
        ownerContactId !== null &&
        personContactId !== null &&
        ownerContactId === personContactId;

      if (!autorizado) {
        return reply
          .code(403)
          .send(apiError("forbidden", "No autorizado para borrar este registro."));
      }

      // Derecho al olvido: borra persona + contacto (cascada de canales).
      await deps.secureDeleteRepo.deletePersonAndOwner(personId, personContactId);
      return reply.code(204).send();
    },
  });
}
