import { petCreateSchema, plataformaCanalSchema, type PublicPet } from "core";
import type { ChannelLinkRepo, PetRepo } from "db";
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
  /** Vinculo usuario<->canal (channels/opt_in) para ligar la mascota a quien la reporta. */
  channelLinkRepo: ChannelLinkRepo;
}

/** Query de GET /search/pets: termino obligatorio + filtro de zona opcional. */
const searchPetsQuerySchema = z.object({
  q: z.string().trim().min(1, "Indica un termino de busqueda."),
  zona: z.string().trim().min(1).optional(),
});

/**
 * Vinculo de canal opcional en el cuerpo de POST /pets. Si viene, se resuelve/crea
 * el contacto (ensureChannel) y su id pasa a ser el contact_id de la mascota, para
 * poder NOTIFICAR despues si aparece una coincidencia. `telefono` es SENSIBLE: solo
 * entra, nunca sale (espejo del canal en searches.ts).
 */
const channelInputSchema = z
  .object({
    plataforma: plataformaCanalSchema,
    chatId: z.string().trim().min(1),
    telefono: z.string().trim().min(1).optional(),
  })
  .strict();

/**
 * Cuerpo de POST /pets: la entrada de creacion de mascota del dominio + un canal
 * opcional. Si llega `channel`, su contacto resuelto tiene prioridad como contact_id.
 */
const petsBodySchema = petCreateSchema.extend({
  channel: channelInputSchema.optional(),
});

export function registerPetRoutes(app: FastifyInstance, deps: PetRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /pets — alta de mascota.
  // El registro nace estado='desaparecida' y verificacion='sin_verificar' por los
  // DEFAULT del esquema (no se aceptan del cliente). La respuesta es SOLO el id:
  // no se devuelve contact_id ni dato de contacto alguno (guardrail #1).
  //
  // Si llega `channel`, se resuelve/crea el contacto (ensureChannel) y la mascota
  // queda LIGADA a ese contacto, para poder notificar despues por su canal. El canal
  // (chatId/telefono) es SENSIBLE: solo entra, nunca sale en la respuesta.
  typed.route({
    method: "POST",
    url: "/pets",
    schema: {
      body: petsBodySchema,
      response: { 201: z.object({ id: z.uuid() }) },
    },
    handler: async (request, reply) => {
      const { channel, ...petInput } = request.body;

      // Si viene un canal, resolvemos/creamos el contacto y lo usamos como dueno.
      let contactId = petInput.contact_id ?? null;
      if (channel !== undefined) {
        const link = await deps.channelLinkRepo.ensureChannel({
          plataforma: channel.plataforma,
          chatId: channel.chatId,
          ...(channel.telefono !== undefined ? { telefono: channel.telefono } : {}),
        });
        contactId = link.contactId;
      }

      const mascota = await deps.petRepo.create({
        ...petInput,
        contact_id: contactId,
      });
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
