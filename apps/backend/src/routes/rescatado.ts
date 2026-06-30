import { z } from "zod";
import { plataformaCanalSchema } from "core";
import type { ChannelLinkRepo } from "db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { RescatadoDeps } from "../services/rescatado.js";
import { reportRescatado } from "../services/rescatado.js";
import { apiError } from "../errors.js";
import { BOT_SECRET_HEADER, isBotSecretValid } from "../security.js";

// Ruta POST /rescatado (Slice D).
//
// Recibe el reporte de que una persona registrada fue encontrada/rescatada.
// Delega en reportRescatado() para la logica de routing (menor/fallecida/normal).
//
// CONTRATO (B3, judgment-r3): el cliente del bot envia { personId, channel } —
// el mismo patron by-channel que el resto de rutas. El backend resuelve el
// channel_id interno (searcherChannelId) Y el contact_id (searcherContactId) del
// buscador server-side, para que el gate de menores del lado buscador (A1) pueda
// evaluarse con datos reales en vez de omitirse.
//
// PRIVACIDAD: ninguna respuesta expone PII. channel_id son UUIDs internos.
// GUARDRAIL #4: a_salvo NUNCA automatico. El servicio solo encola.

const bodySchema = z
  .object({
    /** UUID de la persona registrada (quien fue encontrada). */
    personId: z.string().uuid(),
    /** Identidad de canal del buscador activo (quien reporta el rescatado). */
    channel: z
      .object({
        plataforma: plataformaCanalSchema,
        chatId: z.string().trim().min(1),
      })
      .strict(),
    /** UUID de la busqueda activa que genero el reencuentro (si se conoce). */
    searchId: z.string().uuid().optional(),
    /** Canal interno del registrante (quien tiene el registro). */
    registrantChannelId: z.string().uuid().optional(),
    /** Estado actual del registrante, si se conoce. */
    registrantEstado: z.string().optional(),
    /** ID de consent_session existente para este match (guard de carrera). */
    existingConsentId: z.string().uuid().optional(),
  })
  .strict();

/**
 * Schema del body de POST /rescatado. Exportado para tests de CONTRATO:
 * el cliente del bot debe producir un payload que valide contra este schema real.
 */
export const rescatadoBodySchema = bodySchema;

const responseSchema = z
  .object({
    ok: z.literal(true),
    outcome: z.enum(["queued", "human_review", "consent_pending", "operator_queue"]),
    consentSessionId: z.string().uuid().optional(),
  })
  .strict();

const errorResponseSchema = z.object({ error: z.string(), message: z.string() }).strict();

/** Dependencias de la ruta: el servicio + el resolvedor de canal (by-channel). */
export interface RescatadoRouteDeps extends RescatadoDeps {
  /** Resuelve (plataforma, chatId) → channel_id y contact_id del buscador. */
  readonly channelLinkRepo: Pick<
    ChannelLinkRepo,
    "findChannelIdByChannel" | "findContactByChannel"
  >;
  /**
   * Secreto compartido bot<->backend (Modelo B). FAIL-CLOSED cuando esta presente:
   * la ruta exige el header x-bot-secret. Se cablea desde deps.botSecret en app.ts.
   */
  readonly botSecret: string | undefined;
}

/** Registra las rutas de rescatado sobre la instancia Fastify dada. */
export function registerRescatadoRoutes(
  app: FastifyInstance,
  deps: RescatadoRouteDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /rescatado — reporte de persona encontrada
  typed.route({
    method: "POST",
    url: "/rescatado",
    schema: {
      body: bodySchema,
      response: { 200: responseSchema, 401: errorResponseSchema },
    },
    handler: async (request, reply) => {
      // AUTH (Modelo B): exigir el secreto compartido bot<->backend. FAIL-CLOSED
      // cuando deps.botSecret esta configurado; header faltante/incorrecto -> 401.
      if (!isBotSecretValid(request.headers[BOT_SECRET_HEADER], deps.botSecret)) {
        return reply.code(401).send(apiError("unauthorized", "Secreto de bot invalido."));
      }

      const {
        personId,
        channel,
        searchId,
        registrantChannelId,
        registrantEstado,
        existingConsentId,
      } = request.body;

      // Resolver el lado buscador desde el canal: channel_id interno (requerido por
      // el servicio) y contact_id real (para el gate de menores del buscador, A1).
      const [searcherChannelId, searcherContactId] = await Promise.all([
        deps.channelLinkRepo.findChannelIdByChannel(channel.plataforma, channel.chatId),
        deps.channelLinkRepo.findContactByChannel(channel.plataforma, channel.chatId),
      ]);

      // Sin channel_id no podemos correlacionar al buscador → revision humana
      // (conservador: identidad del buscador no resuelta).
      if (searcherChannelId === null) {
        return reply.code(200).send({ ok: true, outcome: "human_review" });
      }

      const result = await reportRescatado(deps, {
        personId,
        searcherChannelId,
        // Explicitly exclude undefined values to satisfy exactOptionalPropertyTypes
        ...(searcherContactId !== null ? { searcherContactId } : {}),
        ...(searchId !== undefined ? { searchId } : {}),
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
