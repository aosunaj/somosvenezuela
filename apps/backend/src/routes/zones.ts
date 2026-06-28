import type { ZoneRepo } from "db";
import { zoneCreateSchema } from "db";
import { z } from "zod";
import { apiError } from "../errors.js";
import { timingSafeEqualString } from "../security.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Rutas de zonas (mapa de la emergencia). Adaptadores FINOS: validan, llaman al
// repo y proyectan la vista publica. CERO reglas de negocio aqui.
//
// SEGURIDAD (guardrail #7): la LECTURA es publica (mapa abierto) pero la ESCRITURA
// se protege con AUTENTICACION DE SERVICIO (header x-service-token), igual que el
// DELETE de personas. Sin secreto configurado o token incorrecto -> 401.

const SERVICE_TOKEN_HEADER = "x-service-token";

/** Forma publica de una zona en la respuesta (espeja zones_public). */
const publicZoneSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  estado: z.string().nullable(),
  updated_at: z.iso.datetime({ offset: true }),
});

/** Dependencias que necesitan las rutas de zonas. */
export interface ZoneRoutesDeps {
  /** Repositorio de zonas (escritura en tabla base, lectura por vista publica). */
  zoneRepo: ZoneRepo;
  /**
   * Secreto de servicio para escritura privilegiada. Si esta vacio o indefinido,
   * el POST queda deshabilitado (responde 401).
   */
  serviceToken: string | undefined;
}

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

export function registerZoneRoutes(app: FastifyInstance, deps: ZoneRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // GET /zones — listado publico de zonas para el mapa.
  typed.route({
    method: "GET",
    url: "/zones",
    schema: {
      response: { 200: z.object({ zones: z.array(publicZoneSchema) }) },
    },
    handler: async (_request, reply) => {
      const zones = await deps.zoneRepo.listPublic();
      return reply.send({ zones });
    },
  });

  // POST /zones — alta/actualizacion de zona (escritura privilegiada).
  // Sin `response` schema: la ruta tiene una rama 401 (token) ademas del 201, y el
  // type provider de zod fija el tipo de send a un unico status si se declara. La
  // proyeccion publica ya la garantiza el repo (devuelve solo columnas de la vista,
  // sin actualizado_por). Mismo criterio que el DELETE privilegiado de personas.
  typed.route({
    method: "POST",
    url: "/zones",
    schema: {
      body: zoneCreateSchema,
    },
    handler: async (request, reply) => {
      if (!tokenValido(request.headers[SERVICE_TOKEN_HEADER], deps.serviceToken)) {
        return reply
          .code(401)
          .send(apiError("unauthorized", "No autorizado para realizar esta operacion."));
      }

      const zona = await deps.zoneRepo.create(request.body);
      return reply.code(201).send(zona);
    },
  });
}
