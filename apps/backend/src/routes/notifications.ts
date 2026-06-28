import { z } from "zod";
import type { NotificationRepo } from "db";
import { timingSafeEqualString } from "../security.js";
import { apiError } from "../errors.js";
import { idParamsSchema } from "../schemas.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Rutas de NOTIFICACIONES (cola interna para un worker/bot que las entrega).
//
// SEGURIDAD (guardrail #1/#6): son endpoints INTERNOS. Se protegen con
// x-service-token (comparacion timing-safe), igual que DELETE /persons/:id. Solo
// el worker autorizado lee pendientes y marca el resultado. El payload puede traer
// ids internos pero NO telefono en claro (el transporte ya conoce el canal).
//
// Para no tocar deps.ts, recibe notificationRepo y el serviceToken por parametro.

const SERVICE_TOKEN_HEADER = "x-service-token";

export interface NotificationsDeps {
  /** Repositorio de notificaciones (cola interna). */
  notificationRepo: NotificationRepo;
  /** Secreto de servicio; si esta vacio/indefinido, estos endpoints responden 401. */
  serviceToken: string | undefined;
}

// Notificacion proyectada para el worker. Campos internos permitidos (ids), SIN
// reintroducir PII de transporte en claro: el chat_id vive en `channels`, no aqui.
const notificationViewSchema = z.object({
  id: z.uuid(),
  contact_id: z.uuid().nullable(),
  channel_id: z.uuid().nullable(),
  tipo: z.enum(["match", "alerta", "info"]),
  prioridad: z.enum(["normal", "alta"]),
  payload: z.unknown(),
  estado: z.enum(["pendiente", "enviada", "fallida"]),
  created_at: z.iso.datetime({ offset: true }),
});

const pendingResponseSchema = z.object({
  notifications: z.array(notificationViewSchema),
});

const sentResponseSchema = z.object({ ok: z.literal(true) });

// Cuerpo de error uniforme (espeja ApiErrorBody) para tipar las respuestas 401.
const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

/** Valida el x-service-token en tiempo constante. true si autorizado. */
function isAuthorized(
  headerValue: string | string[] | undefined,
  serviceToken: string | undefined,
): boolean {
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (
    serviceToken === undefined ||
    serviceToken.length === 0 ||
    token === undefined
  ) {
    return false;
  }
  return timingSafeEqualString(token, serviceToken);
}

/**
 * Registra:
 *   GET  /notifications/pending  (x-service-token) -> { notifications: [...] }
 *   POST /notifications/:id/sent (x-service-token) -> { ok: true }
 */
export function registerNotificationsRoutes(
  app: FastifyInstance,
  deps: NotificationsDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.route({
    method: "GET",
    url: "/notifications/pending",
    schema: {
      response: { 200: pendingResponseSchema, 401: errorResponseSchema },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request.headers[SERVICE_TOKEN_HEADER], deps.serviceToken)) {
        return reply
          .code(401)
          .send(apiError("unauthorized", "No autorizado para realizar esta operacion."));
      }

      const notifications = await deps.notificationRepo.listPending();
      return reply.code(200).send({ notifications });
    },
  });

  typed.route({
    method: "POST",
    url: "/notifications/:id/sent",
    schema: {
      params: idParamsSchema,
      response: { 200: sentResponseSchema, 401: errorResponseSchema },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request.headers[SERVICE_TOKEN_HEADER], deps.serviceToken)) {
        return reply
          .code(401)
          .send(apiError("unauthorized", "No autorizado para realizar esta operacion."));
      }

      await deps.notificationRepo.markSent(request.params.id);
      return reply.code(200).send({ ok: true });
    },
  });
}
