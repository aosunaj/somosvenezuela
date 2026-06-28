import { petCreateSchema, type PublicPet } from "core";
import type { PetRepo } from "db";
import type { PetSearchRepo } from "db";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Rutas de mascotas (adaptadores FINOS): validan entrada (zod de core), llaman a
// los repos de db y proyectan la salida publica. CERO reglas de negocio aqui.
//
// DECISION (no tocar search.ts): la busqueda de personas vive en GET /search. Para
// mascotas se expone una ruta nueva e independiente GET /search/pets, en vez de
// extender el handler de personas. Asi no se modifica el archivo de otro recurso y
// el contrato de mascotas queda aislado. La web consume GET /search/pets?q=&zona=.

/** Dependencias que necesitan las rutas de mascotas. */
export interface PetRoutesDeps {
  /** Repositorio de mascotas (escritura en tabla base, lectura por vista publica). */
  petRepo: PetRepo;
  /** Repositorio de busqueda difusa de mascotas (RPC sobre pets_public). */
  petSearchRepo: PetSearchRepo;
}

/** Query de GET /search/pets: termino obligatorio + filtro de zona opcional. */
const searchPetsQuerySchema = z.object({
  q: z.string().trim().min(1, "Indica un termino de busqueda."),
  zona: z.string().trim().min(1).optional(),
});

export function registerPetRoutes(app: FastifyInstance, deps: PetRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /pets — alta de mascota.
  // El registro nace estado='desaparecida' y verificacion='sin_verificar' por los
  // DEFAULT del esquema (no se aceptan del cliente). La respuesta es SOLO el id:
  // no se devuelve contact_id ni dato de contacto alguno (guardrail #1).
  typed.route({
    method: "POST",
    url: "/pets",
    schema: {
      body: petCreateSchema,
      response: { 201: z.object({ id: z.uuid() }) },
    },
    handler: async (request, reply) => {
      const mascota = await deps.petRepo.create(request.body);
      // Solo el id sale al cliente; el resto del registro (incluido contact_id) se queda.
      return reply.code(201).send({ id: mascota.id });
    },
  });

  // GET /search/pets — busqueda publica de mascotas (adaptador FINO).
  // Usa el RPC pg_trgm via petSearchRepo.searchPetsPublic, que lee SOLO la vista
  // pets_public: los resultados llevan score, fuente y verificacion visibles y
  // JAMAS contact_id (guardrail #1).
  typed.route({
    method: "GET",
    url: "/search/pets",
    schema: {
      querystring: searchPetsQuerySchema,
    },
    handler: async (request, reply) => {
      const { q, zona } = request.query;
      const resultados = await deps.petSearchRepo.searchPetsPublic(q, zona);
      // Los resultados ya son la vista publica (sin contacto) + score.
      const salida: Array<PublicPet & { score: number }> = resultados;
      return reply.send({ results: salida });
    },
  });
}
