import { apiError } from "../errors.js";
import { searchQuerySchema } from "../schemas.js";
import type { AppDeps } from "../deps.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// GET /search — busqueda publica de personas (adaptador FINO).
//
// Usa el RPC pg_trgm via personRepo.searchPersonsPublic, que lee SOLO la vista
// persons_public: los resultados llevan score, fuente y verificacion visibles y
// JAMAS contact_id ni dato de contacto (guardrail #1, criterio de aceptacion).

export function registerSearchRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.route({
    method: "GET",
    url: "/search",
    schema: {
      querystring: searchQuerySchema,
    },
    handler: async (request, reply) => {
      const { q, zona, tipo } = request.query;

      // Mascotas aun no soportadas en Fase 1 (registro/busqueda de mascotas = Fase 6).
      if (tipo === "mascota") {
        return reply
          .code(501)
          .send(
            apiError(
              "not_implemented",
              "La busqueda de mascotas aun no esta disponible.",
            ),
          );
      }

      const resultados = await deps.personRepo.searchPersonsPublic(q, zona);
      // Los resultados ya son la vista publica (sin contacto) + score.
      return reply.send({ results: resultados });
    },
  });
}
