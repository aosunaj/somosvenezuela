import type { NeedRepo } from "db";
import { needCreateSchema } from "db";
import { z } from "zod";
import { apiError } from "../errors.js";
import { timingSafeEqualString } from "../security.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Rutas de necesidades por zona (mapa de la emergencia). Adaptadores FINOS.
//
// SEGURIDAD (guardrail #7): LECTURA publica (mapa abierto); ESCRITURA protegida
// con AUTENTICACION DE SERVICIO (header x-service-token), igual que zonas/borrado.

const SERVICE_TOKEN_HEADER = "x-service-token";

/** Dependencias que necesitan las rutas de necesidades. */
export interface NeedRoutesDeps {
  /** Repositorio de necesidades (escritura en tabla base, lectura por vista publica). */
  needRepo: NeedRepo;
  /**
   * Secreto de servicio para escritura privilegiada. Si esta vacio o indefinido,
   * el POST queda deshabilitado (responde 401).
   */
  serviceToken: string | undefined;
}

/** Query de GET /needs: filtro opcional por zona. */
const needsQuerySchema = z.object({
  zoneId: z.uuid().optional(),
});

/** Forma publica de una necesidad en la respuesta (espeja needs_public). */
const publicNeedSchema = z.object({
  id: z.uuid(),
  zone_id: z.uuid(),
  tipo: z.string(),
  urgencia: z.enum(["baja", "media", "alta", "critica"]),
  descripcion: z.string().nullable(),
  updated_at: z.iso.datetime({ offset: true }),
});

/** Comprueba el header x-service-token contra el secreto configurado. */
function tokenValido(token: string | string[] | undefined, secret: string | undefined): boolean {
  const provided = Array.isArray(token) ? token[0] : token;
  return (
    secret !== undefined &&
    secret.length > 0 &&
    provided !== undefined &&
    timingSafeEqualString(provided, secret)
  );
}

export function registerNeedRoutes(app: FastifyInstance, deps: NeedRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // GET /needs?zoneId= — listado publico de necesidades (opcionalmente por zona).
  typed.route({
    method: "GET",
    url: "/needs",
    schema: {
      querystring: needsQuerySchema,
      response: { 200: z.object({ needs: z.array(publicNeedSchema) }) },
    },
    handler: async (request, reply) => {
      const needs = await deps.needRepo.listPublicByZone(request.query.zoneId);
      return reply.send({ needs });
    },
  });

  // POST /needs — alta de necesidad (escritura privilegiada).
  // Sin `response` schema: la ruta tiene rama 401 (token) ademas del 201, y declarar
  // un unico status fijaria el tipo de send. La proyeccion publica ya la garantiza el
  // repo (devuelve solo columnas de needs_public). Mismo criterio que zonas/personas.
  typed.route({
    method: "POST",
    url: "/needs",
    schema: {
      body: needCreateSchema,
    },
    handler: async (request, reply) => {
      if (!tokenValido(request.headers[SERVICE_TOKEN_HEADER], deps.serviceToken)) {
        return reply
          .code(401)
          .send(apiError("unauthorized", "No autorizado para realizar esta operacion."));
      }

      const necesidad = await deps.needRepo.create(request.body);
      return reply.code(201).send(necesidad);
    },
  });
}
