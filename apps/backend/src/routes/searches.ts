import { searchCreateSchema, searchSchema } from "core";
import type { AppDeps } from "../deps.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Ruta de creacion de busquedas (adaptador FINO).
//
// `searches` es flujo INTERNO: la fila lleva buscador_contact_id (SENSIBLE) para
// notificar a quien busca. La respuesta NUNCA expone ese campo (guardrail #1):
// se proyecta a una vista publica que lo omite.

/**
 * Vista publica de una busqueda: el registro completo SIN buscador_contact_id.
 * core no define esta proyeccion (las busquedas no se listan publicamente); la
 * derivamos aqui como salida de la API, igual que publicPersonSchema en personas.
 */
const publicSearchSchema = searchSchema.omit({ buscador_contact_id: true });

export function registerSearchesRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /searches — registra quien busca a quien.
  typed.route({
    method: "POST",
    url: "/searches",
    schema: {
      body: searchCreateSchema,
      response: { 201: publicSearchSchema },
    },
    handler: async (request, reply) => {
      const busqueda = await deps.searchRepo.create(request.body);
      // Proyeccion publica: descarta buscador_contact_id antes de responder.
      const { buscador_contact_id: _sensible, ...publica } = busqueda;
      void _sensible;
      return reply.code(201).send(publica);
    },
  });
}
