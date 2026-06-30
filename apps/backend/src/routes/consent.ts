import { z } from "zod";
import { plataformaCanalSchema } from "core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppDeps } from "../deps.js";
import type { ConsentParty } from "db";
import { respondConsent } from "../services/consent.js";
import { sweepExpiredConsents } from "../services/sweep.js";
import { apiError } from "../errors.js";
import { BOT_SECRET_HEADER, isBotSecretValid, timingSafeEqualString } from "../security.js";

/**
 * Valida el token de servicio en tiempo constante (M3, guardrail #6): evita filtrar
 * el secreto por timing. Usa el mismo helper compartido que el resto de rutas
 * privilegiadas (persons/matches/notifications). false si no hay secreto configurado.
 */
function isAuthorized(provided: string, expected: string | undefined): boolean {
  if (expected === undefined || expected.length === 0) return false;
  return timingSafeEqualString(provided, expected);
}

// Rutas de consentimiento bilateral (Model B — Nuevo diseño con consent_sessions).
//
// POST /consent/:id/respond — la parte interesada acepta o declina el contacto.
// POST /consent/sweep       — limpia sesiones expiradas (interno, requiere serviceToken).
//
// CONTRATO (B5): el cliente del bot envia { channel: { plataforma, chatId }, decision }
// — el mismo patron by-channel que relay/close y rescatado. El backend resuelve el
// channel_id interno y DERIVA SERVER-SIDE que parte (searcher/registrant) es ese canal
// en la sesion; NUNCA confia en que el cliente declare su rol. Un canal ajeno a la
// sesion no puede responder (403). 'decision' (es) se mapea a 'action' (interno):
// 'aceptado' -> 'accept', 'rechazado' -> 'decline'.
//
// PRIVACIDAD: ninguna respuesta expone PII (teléfono, chat_id del otro lado).

/**
 * Schema del body de POST /consent/:id/respond. Exportado para tests de CONTRATO:
 * el cliente del bot debe producir un payload que valide contra este schema real.
 */
export const respondBodySchema = z
  .object({
    /** Identidad de canal de quien responde (plataforma + chatId). */
    channel: z
      .object({
        plataforma: plataformaCanalSchema,
        chatId: z.string().trim().min(1),
      })
      .strict(),
    /** Decisión de la parte (texto de cara al bot/usuario, en español). */
    decision: z.enum(["aceptado", "rechazado"]),
  })
  .strict();

/** Mapea la decisión del bot (es) a la acción del servicio (interno). */
const DECISION_TO_ACTION = {
  aceptado: "accept",
  rechazado: "decline",
} as const;

const respondResponseSchema = z
  .object({ ok: z.literal(true), rpcResult: z.string().optional() })
  .strict();

const sweepBodySchema = z.object({ serviceToken: z.string() }).strict();
const sweepResponseSchema = z.object({ swept: z.number() }).strict();
const errorResponseSchema = z.object({ error: z.string(), message: z.string() }).strict();

export function registerConsentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /consent/:id/respond
  // Recibe la respuesta de una parte y ejecuta el flujo de doble opt-in.
  typed.route({
    method: "POST",
    url: "/consent/:id/respond",
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: respondBodySchema,
      response: {
        200: respondResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      // AUTH (Modelo B): exigir el secreto compartido bot<->backend. FAIL-CLOSED
      // cuando deps.botSecret esta configurado; header faltante/incorrecto -> 401.
      if (!isBotSecretValid(request.headers[BOT_SECRET_HEADER], deps.botSecret)) {
        return reply.code(401).send(apiError("unauthorized", "Secreto de bot invalido."));
      }

      const { id: consentId } = request.params;
      const { channel, decision } = request.body;

      // 1) Resolver el channel_id interno de quien responde desde (plataforma, chatId).
      //    Sin canal resuelto no hay nada que correlacionar → 404 (sin filtrar detalles).
      const callerChannelId = await deps.channelLinkRepo.findChannelIdByChannel(
        channel.plataforma,
        channel.chatId,
      );
      if (callerChannelId === null) {
        return reply.code(404).send(apiError("not_found", "Sesión no encontrada."));
      }

      // 2) Cargar las dos partes de la sesión. Si no existe → 404.
      const parties = await deps.consentRepo.getConsentParties(consentId);
      if (parties === null) {
        return reply.code(404).send(apiError("not_found", "Sesión no encontrada."));
      }

      // 3) DERIVAR SERVER-SIDE qué parte es el canal que responde. Si el canal no es
      //    ninguna de las dos partes de ESTA sesión → 403, sin efecto (B5: nunca se
      //    confía en que el cliente declare su rol; un canal ajeno no puede responder).
      let party: ConsentParty;
      if (callerChannelId === parties.searcherChannelId) {
        party = "searcher";
      } else if (callerChannelId === parties.registrantChannelId) {
        party = "registrant";
      } else {
        return reply
          .code(403)
          .send(apiError("forbidden", "Este canal no participa en la sesión."));
      }

      await respondConsent(
        {
          consentRepo: deps.consentRepo,
          notificationRepo: deps.notificationRepo,
          auditRepo: deps.auditRepo,
          relayRepo: deps.relayRepo,
        },
        {
          consentId,
          party,
          action: DECISION_TO_ACTION[decision],
          searcherChannelId: parties.searcherChannelId,
          registrantChannelId: parties.registrantChannelId,
        },
      );

      return reply.code(200).send({ ok: true });
    },
  });

  // POST /consent/sweep — limpia consent_sessions expiradas (llamado por el poller).
  // Operacion idempotente. Requiere serviceToken.
  typed.route({
    method: "POST",
    url: "/consent/sweep",
    schema: {
      body: sweepBodySchema,
      response: { 200: sweepResponseSchema, 401: errorResponseSchema },
    },
    handler: async (request, reply) => {
      // M3: comparacion en tiempo constante del token de servicio.
      if (!isAuthorized(request.body.serviceToken, deps.serviceToken)) {
        return reply.code(401).send(apiError("unauthorized", "Token de servicio invalido."));
      }

      // Sweep REAL (B4): invoca el mismo servicio que corre en el setInterval de
      // index.ts. Marca como 'expired' las sesiones vencidas y notifica a ambas
      // partes. Best-effort por sesion; devuelve el conteo real de barridas.
      const result = await sweepExpiredConsents({
        notificationRepo: deps.notificationRepo,
        getExpiredPendingConsents: () => deps.consentRepo.getExpiredPendingConsents(),
        markConsentExpired: (id) => deps.consentRepo.markConsentExpired(id),
      });

      return reply.code(200).send({ swept: result.swept });
    },
  });
}
