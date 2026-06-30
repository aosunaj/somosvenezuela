import { aliveMessageCreateSchema, aliveMessageSchema } from "core";
import type { AliveMessagesRepo } from "db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError } from "../errors.js";
import { sensitiveRouteRateLimit } from "../rate-limit.js";
import { BOT_SECRET_HEADER, isBotSecretValid } from "../security.js";

// Ruta de creacion de mensajes "estoy vivo" (Spec 06, Slice 1).
//
// GUARDRAIL: el dominio AliveMessage no contiene contact_id ni dato de contacto
// alguno — solo autorNombre (nombre libre del autor). La respuesta es safe por
// diseno (el schema de salida espeja AliveMessage de core).
//
// AUTH (Modelo B): exige el header x-bot-secret. FAIL-CLOSED cuando el secreto
// esta configurado; header faltante/incorrecto -> 401.
//
// SLICE 1: solo texto. tipo="voz" se rechaza con 400 porque la subida a
// Cloudinary llega en un slice posterior. El enum incluye "voz" para
// forward-compat, pero la ruta lo bloquea explicitamente aqui.

const errorResponseSchema = z
  .object({ error: z.string(), message: z.string() })
  .strict();

/** Dependencias minimas que necesita esta ruta. */
export interface AliveMessagesDeps {
  aliveMessagesRepo: AliveMessagesRepo;
  /**
   * Secreto compartido bot<->backend (Modelo B). FAIL-CLOSED cuando esta presente:
   * la ruta exige el header x-bot-secret. Se cablea desde deps.botSecret en app.ts.
   */
  botSecret: string | undefined;
}

export function registerAliveMessagesRoutes(
  app: FastifyInstance,
  deps: AliveMessagesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /alive-messages — registra un mensaje "estoy vivo".
  //
  // Rate limit estricto (guardrail #6): operacion de escritura sensible.
  // Solo se aplica si el plugin global @fastify/rate-limit esta registrado
  // (ver app.ts); en tests sin plugin es un no-op.
  typed.route({
    method: "POST",
    url: "/alive-messages",
    config: sensitiveRouteRateLimit,
    schema: {
      body: aliveMessageCreateSchema,
      response: {
        201: aliveMessageSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      // AUTH (Modelo B): exigir el secreto compartido bot<->backend. FAIL-CLOSED
      // cuando deps.botSecret esta configurado; header faltante/incorrecto -> 401.
      if (!isBotSecretValid(request.headers[BOT_SECRET_HEADER], deps.botSecret)) {
        return reply.code(401).send(apiError("unauthorized", "Secreto de bot invalido."));
      }

      // SLICE 1: tipo="voz" no disponible hasta Slice 2+ (Cloudinary).
      // El enum lo acepta en schema para forward-compat pero la ruta lo bloquea.
      if (request.body.tipo === "voz") {
        return reply
          .code(400)
          .send(apiError("unsupported_tipo", "Los mensajes de voz aún no están disponibles."));
      }

      const message = await deps.aliveMessagesRepo.create(request.body);
      return reply.code(201).send(message);
    },
  });
}
