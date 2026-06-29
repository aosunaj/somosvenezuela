import { z } from "zod";
import { plataformaCanalSchema } from "core";
import type { ChannelRepo, NotificationRepo } from "db";
import { timingSafeEqualString } from "../security.js";
import { apiError } from "../errors.js";
import { idParamsSchema } from "../schemas.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Rutas de NOTIFICACIONES (cola interna para un worker/bot que las entrega).
//
// SEGURIDAD (guardrail #1/#6): son endpoints INTERNOS. Se protegen con
// x-service-token (comparacion timing-safe), igual que DELETE /persons/:id. Solo
// el worker autorizado lee pendientes y marca el resultado.
//
// La cola pendiente se proyecta como DIRECCION DE TRANSPORTE para el bot:
// (plataforma, chat_id) resuelta desde `channels` via channel_id. NO se expone
// contact_id ni telefono (guardrail #1): el bot solo necesita a donde entregar.
// Una notificacion sin canal resoluble se omite (no es entregable por un bot).

const SERVICE_TOKEN_HEADER = "x-service-token";

export interface NotificationsDeps {
  /** Repositorio de notificaciones (cola interna). */
  notificationRepo: NotificationRepo;
  /** Resuelve channel_id -> (plataforma, chat_id) para dirigir la entrega. */
  channelRepo: ChannelRepo;
  /** Secreto de servicio; si esta vacio/indefinido, estos endpoints responden 401. */
  serviceToken: string | undefined;
}

// Notificacion proyectada para el bot: SOLO id + direccion de transporte
// (plataforma, chat_id) + tipo/prioridad/payload. SIN contact_id ni telefono.
const notificationViewSchema = z.object({
  id: z.uuid(),
  plataforma: plataformaCanalSchema,
  chat_id: z.string(),
  tipo: z.enum(["match", "alerta", "info"]),
  prioridad: z.enum(["normal", "alta"]),
  payload: z.unknown(),
});

const pendingResponseSchema = z.object({
  notifications: z.array(notificationViewSchema),
});

// Querystring de GET /notifications/pending: el bot pide SOLO las de su plataforma.
// El filtrado ocurre en BD (guardrail #1): no exponemos chat_id de una plataforma a
// otra. `plataforma` es opcional (sin el, se mantiene la lista global interna).
const pendingQuerySchema = z.object({
  plataforma: plataformaCanalSchema.optional(),
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
      querystring: pendingQuerySchema,
      response: { 200: pendingResponseSchema, 401: errorResponseSchema },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request.headers[SERVICE_TOKEN_HEADER], deps.serviceToken)) {
        return reply
          .code(401)
          .send(apiError("unauthorized", "No autorizado para realizar esta operacion."));
      }

      // Filtrado por plataforma A NIVEL DE BD: el repo aplica el inner join con
      // `channels`, asi el limit cuenta solo las de la plataforma pedida y no se
      // filtra chat_id de una plataforma a otra (guardrail #1).
      const pending = await deps.notificationRepo.listPending(undefined, request.query.plataforma);

      // Enriquecemos cada pendiente con su direccion de transporte resuelta desde
      // `channels`. Las que no tienen canal resoluble se OMITEN: un bot no puede
      // entregarlas (no hay a donde), y no exponemos ids de contacto en su lugar.
      const notifications = [];
      for (const n of pending) {
        if (n.channel_id === null) continue;
        const transport = await deps.channelRepo.getTransport(n.channel_id);
        if (transport === null) continue;
        notifications.push({
          id: n.id,
          plataforma: transport.plataforma,
          chat_id: transport.chat_id,
          tipo: n.tipo,
          prioridad: n.prioridad,
          payload: n.payload,
        });
      }

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
