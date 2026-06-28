import {
  personCreateSchema,
  publicPersonSchema,
  toPublicPerson,
} from "core";
import { timingSafeEqualString } from "../security.js";
import { apiError } from "../errors.js";
import type { AppDeps } from "../deps.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { idParamsSchema } from "../schemas.js";

// Rutas de personas (adaptadores FINOS): validan entrada (zod de core), llaman al
// repo de db y proyectan la salida a la vista publica. CERO reglas de negocio aqui.

const SERVICE_TOKEN_HEADER = "x-service-token";

export function registerPersonRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /persons — alta de persona.
  // El registro nace estado='desaparecida' y verificacion='sin_verificar' por los
  // DEFAULT del esquema/dominio (no se aceptan del cliente). La respuesta es la
  // VISTA PUBLICA: jamas incluye contact_id ni dato de contacto (guardrail #1).
  typed.route({
    method: "POST",
    url: "/persons",
    schema: {
      body: personCreateSchema,
      response: { 201: publicPersonSchema },
    },
    handler: async (request, reply) => {
      const persona = await deps.personRepo.create(request.body);
      // Defensa en profundidad: aunque el repo devuelve el registro completo
      // (interno), aqui solo sale la proyeccion publica, sin contact_id.
      return reply.code(201).send(toPublicPerson(persona));
    },
  });

  // DELETE /persons/:id — borrado (derecho al olvido).
  //
  // SEGURIDAD (guardrail #7): un borrado publico seria un agujero de abuso. En
  // Fase 1 (sin bots todavia) se protege con AUTENTICACION DE SERVICIO: se exige
  // el header x-service-token y debe coincidir con SERVICE_TOKEN (env). Si falta
  // o no coincide -> 401.
  //
  // Fase 2: el borrado por el DUENO via su canal se autenticara con el token del
  // bot (Telegram/WhatsApp), que se conectara aqui sin abrir el endpoint.
  typed.route({
    method: "DELETE",
    url: "/persons/:id",
    schema: {
      params: idParamsSchema,
    },
    handler: async (request, reply) => {
      const provided = request.headers[SERVICE_TOKEN_HEADER];
      const token = Array.isArray(provided) ? provided[0] : provided;

      // Sin secreto configurado en el servidor, o token ausente/incorrecto -> 401.
      // Comparacion en tiempo constante para no filtrar el token por timing.
      if (
        deps.serviceToken === undefined ||
        deps.serviceToken.length === 0 ||
        token === undefined ||
        !timingSafeEqualString(token, deps.serviceToken)
      ) {
        return reply
          .code(401)
          .send(apiError("unauthorized", "No autorizado para realizar esta operacion."));
      }

      await deps.personRepo.remove(request.params.id);
      return reply.code(204).send();
    },
  });
}
