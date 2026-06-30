import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppDeps } from "../deps.js";
import { apiError } from "../errors.js";

// Rutas del relay de mensajes (Model B — relay_sessions).
//
// POST /relay/:id/close — la parte que quiere terminar cierra el relay.
//   Notifica al otro lado con un mensaje de relay cerrado (sin PII).
//
// El reveal bilateral (POST /relay/:id/reveal) se implementa en PR4.
//
// PRIVACIDAD: ninguna respuesta expone PII.

const closeBodySchema = z
  .object({
    /** UUID del canal de quien solicita el cierre. */
    channelId: z.string().uuid(),
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
      body: closeBodySchema,
      response: { 200: closeResponseSchema, 404: errorResponseSchema },
    },
    handler: async (request, reply) => {
      const { id: relayId } = request.params;
      const { channelId } = request.body;

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
