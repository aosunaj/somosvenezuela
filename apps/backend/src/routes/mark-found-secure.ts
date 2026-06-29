import { z } from "zod";
import { plataformaCanalSchema, type PlataformaCanal } from "core";
import type {
  ChannelLinkRepo,
  PersonRepo,
  PersonStateAuditRepo,
  SecureDeleteRepo,
} from "db";
import { apiError } from "../errors.js";
import { idParamsSchema } from "../schemas.js";
import { sensitiveRouteRateLimit } from "../rate-limit.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Ruta de RESCATADO SEGURO por canal (el propio dueno reporta "aparecio con vida").
//
// Misma autorizacion que el BORRADO SEGURO: el solicitante prueba la PROPIEDAD
// demostrando que controla el canal (plataforma + chatId) ligado al contacto de
// esa persona. Si coincide -> marca estado=encontrada_viva, verificacion=sin_verificar
// y responde 200. Si NO -> 403. No se filtra si la persona existe.
//
// CRITICO (guardrail #4 / proteccion de menores): NUNCA fija 'verificada'. Un reporte
// del dueno SUGIERE, no confirma; la confirmacion oficial por entidad verificada es
// un paso aparte fuera de alcance. MEJORA FUTURA: distinguir encontrada_herida.
//
// Para no tocar deps.ts, recibe sus repos (todos de `db`) por parametro explicito.

export interface MarkFoundSecureDeps {
  /** Helper de vinculo: resuelve el contacto dueno de un canal. */
  channelLinkRepo: ChannelLinkRepo;
  /** Lectura del contacto ligado a la persona (autorizacion por propiedad). */
  secureDeleteRepo: SecureDeleteRepo;
  /** Repo de personas: aplica el cambio de estado (markFound). */
  personRepo: PersonRepo;
  /** Auditoria de cambios de estado sensibles (guardrail #8): quien + cuando. */
  personStateAuditRepo: PersonStateAuditRepo;
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

/**
 * Registra POST /persons/:id/found-by-channel.
 *
 * Autoriza por PROPIEDAD del canal: findContactByChannel(plataforma, chatId) debe
 * coincidir con el contact_id de la persona. 200 si autorizado, 403 si no.
 */
export function registerMarkFoundSecureRoutes(
  app: FastifyInstance,
  deps: MarkFoundSecureDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.route({
    method: "POST",
    url: "/persons/:id/found-by-channel",
    // Rate limit ESTRICTO (guardrail #6): operacion sensible por canal. Solo se
    // aplica si el plugin global esta registrado (ver app.ts); en tests sin plugin
    // es un no-op.
    config: sensitiveRouteRateLimit,
    schema: {
      params: idParamsSchema,
    },
    handler: async (request, reply) => {
      const ownership = readOwnership(request.body, request.headers as Record<string, unknown>);
      if (ownership === null) {
        // Sin prueba de propiedad valida: no autorizado (no revelamos detalles).
        return reply
          .code(403)
          .send(apiError("forbidden", "No autorizado para actualizar este registro."));
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
          .send(apiError("forbidden", "No autorizado para actualizar este registro."));
      }

      // Reporte del dueno: encontrada con vida, SIN verificar (nunca 'verificada').
      await deps.personRepo.markFound(personId);

      // Auditoria del cambio sensible (guardrail #8: quien + cuando + estado nuevo).
      // QUIEN = el contacto dueno del canal que acaba de pasar la autorizacion.
      // CUANDO lo fija la BD (default now()). Dejamos estado_anterior nulo: leerlo
      // exigiria una consulta extra y el repo `markFound` no lo devuelve; el evento
      // ya identifica al autor, el instante y el estado resultante. Se registra DESPUES
      // del cambio para no auditar transiciones que no llegaron a aplicarse.
      await deps.personStateAuditRepo.record({
        personId,
        estadoNuevo: "encontrada_viva",
        changedByContactId: ownerContactId,
      });

      return reply.code(200).send({ ok: true });
    },
  });
}
