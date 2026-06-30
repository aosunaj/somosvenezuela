import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { RescatadoDeps } from "../services/rescatado.js";
import { reportRescatado } from "../services/rescatado.js";

// Ruta POST /rescatado (Slice D).
//
// Recibe el reporte de que una persona registrada fue encontrada/rescatada.
// Delega en reportRescatado() para la logica de routing (menor/fallecida/normal).
//
// PRIVACIDAD: ninguna respuesta expone PII. channel_id son UUIDs internos.
// GUARDRAIL #4: a_salvo NUNCA automatico. El servicio solo encola.

const bodySchema = z
  .object({
    /** UUID de la persona registrada (quien fue encontrada). */
    personId: z.string().uuid(),
    /** UUID de la busqueda activa que genero el reencuentro. */
    searchId: z.string().uuid(),
    /** Canal interno del registrante (quien tiene el registro). */
    registrantChannelId: z.string().uuid().optional(),
    /** Canal interno del buscador activo (quien reporta el rescatado). */
    searcherChannelId: z.string().uuid(),
    /** Estado actual del registrante, si se conoce. */
    registrantEstado: z.string().optional(),
    /** ID de consent_session existente para este match (guard de carrera). */
    existingConsentId: z.string().uuid().optional(),
  })
  .strict();

const responseSchema = z
  .object({
    ok: z.literal(true),
    outcome: z.enum(["queued", "human_review", "consent_pending", "operator_queue"]),
    consentSessionId: z.string().uuid().optional(),
  })
  .strict();

/** Registra las rutas de rescatado sobre la instancia Fastify dada. */
export function registerRescatadoRoutes(
  app: FastifyInstance,
  deps: RescatadoDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /rescatado — reporte de persona encontrada
  typed.route({
    method: "POST",
    url: "/rescatado",
    schema: {
      body: bodySchema,
      response: { 200: responseSchema },
    },
    handler: async (request, reply) => {
      const {
        personId,
        searchId,
        searcherChannelId,
        registrantChannelId,
        registrantEstado,
        existingConsentId,
      } = request.body;

      const result = await reportRescatado(deps, {
        personId,
        searchId,
        searcherChannelId,
        // Explicitly exclude undefined values to satisfy exactOptionalPropertyTypes
        ...(registrantChannelId !== undefined ? { registrantChannelId } : {}),
        ...(registrantEstado !== undefined ? { registrantEstado } : {}),
        ...(existingConsentId !== undefined ? { existingConsentId } : {}),
      });

      return reply.code(200).send({
        ok: true,
        outcome: result.outcome,
        ...(result.consentSessionId !== undefined
          ? { consentSessionId: result.consentSessionId }
          : {}),
      });
    },
  });
}
