import { z } from "zod";
import { plataformaCanalSchema } from "core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppDeps } from "../deps.js";
import { apiError } from "../errors.js";
import { BOT_SECRET_HEADER, isBotSecretValid } from "../security.js";

// Rutas del relay de mensajes (Model B — relay_sessions).
//
// POST /relay/:id/close — la parte que quiere terminar cierra el relay.
//   Notifica al otro lado con un mensaje de relay cerrado (sin PII).
//
// El reveal bilateral (POST /relay/:id/reveal) se implementa en PR4.
//
// PRIVACIDAD: ninguna respuesta expone PII. El cliente envía (plataforma, chatId)
// — el mismo patrón by-channel que delete-secure/mark-found-secure/persons-mine —
// y el backend resuelve el channel_id (UUID interno) server-side. El bot NUNCA
// conoce ni envía channel_id.

/**
 * Schema del body de POST /relay/:id/close. Exportado para tests de CONTRATO:
 * el cliente del bot debe producir un payload que valide contra este schema real.
 */
export const relayCloseBodySchema = z
  .object({
    /** Identidad de canal de quien solicita el cierre (plataforma + chatId). */
    channel: z
      .object({
        plataforma: plataformaCanalSchema,
        chatId: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

const closeResponseSchema = z.object({ ok: z.literal(true) }).strict();
const errorResponseSchema = z.object({ error: z.string(), message: z.string() }).strict();

export function registerRelayRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /relay/:id/close — cierra el relay y notifica al otro lado.
  typed.route({
    method: "POST",
    url: "/relay/:id/close",
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: relayCloseBodySchema,
      response: { 200: closeResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
    },
    handler: async (request, reply) => {
      // AUTH (Modelo B): exigir el secreto compartido bot<->backend. FAIL-CLOSED
      // cuando deps.botSecret esta configurado; header faltante/incorrecto -> 401.
      if (!isBotSecretValid(request.headers[BOT_SECRET_HEADER], deps.botSecret)) {
        return reply.code(401).send(apiError("unauthorized", "Secreto de bot invalido."));
      }

      const { id: relayId } = request.params;
      const { channel } = request.body;

      // Resolver el channel_id interno desde (plataforma, chatId). Sin canal
      // resuelto no hay relay que cerrar → 404 (no revelamos detalles).
      const channelId = await deps.channelLinkRepo.findChannelIdByChannel(
        channel.plataforma,
        channel.chatId,
      );
      if (channelId === null) {
        return reply.code(404).send(apiError("not_found", "Relay no encontrado o ya cerrado."));
      }

      // Confirmar que hay un relay activo para este canal antes de cerrar.
      const relay = await deps.relayRepo.getActiveRelay(channelId);
      if (!relay || relay.relayId !== relayId) {
        return reply.code(404).send(apiError("not_found", "Relay no encontrado o ya cerrado."));
      }

      // Cerrar el relay.
      await deps.relayRepo.closeRelay(relayId);

      // Notificar al otro lado que la conexion fue cerrada.
      await deps.notificationRepo.create({
        channel_id: relay.otherChannelId,
        tipo: "info",
        prioridad: "normal",
        payload: {
          mensaje: [
            "La otra parte cerró la conexión.",
            "Si necesitás continuar la búsqueda, podés registrar otro aviso.",
          ].join("\n"),
        },
      });

      return reply.code(200).send({ ok: true });
    },
  });
}
