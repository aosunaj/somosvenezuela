import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppDeps } from "../deps.js";
import { respondConsent } from "../services/consent.js";
import { sweepExpiredConsents } from "../services/sweep.js";
import { apiError } from "../errors.js";
import { timingSafeEqualString } from "../security.js";

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
// PRIVACIDAD: ninguna respuesta expone PII (teléfono, chat_id del otro lado).

const respondBodySchema = z
  .object({
    party: z.enum(["searcher", "registrant"]),
    action: z.enum(["accept", "decline"]),
    searcherChannelId: z.string().uuid(),
    registrantChannelId: z.string().uuid(),
  })
  .strict();

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
      response: { 200: respondResponseSchema },
    },
    handler: async (request, reply) => {
      const { id: consentId } = request.params;
      const { party, action, searcherChannelId, registrantChannelId } = request.body;

      await respondConsent(
        {
          consentRepo: deps.consentRepo,
          notificationRepo: deps.notificationRepo,
          auditRepo: deps.auditRepo,
          relayRepo: deps.relayRepo,
        },
        { consentId, party, action, searcherChannelId, registrantChannelId },
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
