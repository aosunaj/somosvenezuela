import { z } from "zod";
import {
  plataformaCanalSchema,
  publicPersonSchema,
  searchCreateSchema,
  searchSchema,
} from "core";
import { rankCandidates, type MatchQuery } from "ai";
import { runMatchingForSearch } from "../services/matching.js";
import type { AppDeps } from "../deps.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Ruta de creacion de busquedas (adaptador FINO).
//
// `searches` es flujo INTERNO: la fila lleva buscador_contact_id (SENSIBLE) para
// notificar a quien busca. La respuesta NUNCA expone ese campo (guardrail #1):
// se proyecta a una vista publica que lo omite.
//
// Al crear una busqueda de persona, se DISPARA el matching (servicio): el motor
// propone candidatos y los persiste como matches 'propuesto' para revision humana
// (la IA SUGIERE, los humanos confirman; guardrail #4). El matching es best-effort:
// si falla, la busqueda ya quedo creada y se responde igual.

/**
 * Vista publica de una busqueda: el registro completo SIN buscador_contact_id.
 * core no define esta proyeccion (las busquedas no se listan publicamente); la
 * derivamos aqui como salida de la API, igual que publicPersonSchema en personas.
 */
const publicSearchSchema = searchSchema.omit({ buscador_contact_id: true });

/** Item de resultado: persona publica (sin contact_id) + score difuso opcional. */
const searchResultSchema = publicPersonSchema.extend({ score: z.number().optional() });

/**
 * Respuesta de POST /searches: la vista publica de la busqueda creada MAS los
 * resultados instantaneos (coincidencias publicas para mostrar a quien busca ahora).
 * En paralelo, el matching de fondo propone matches 'propuesto' para revision humana
 * (notify-later). Los `results` son la busqueda difusa amplia (vista persons_public:
 * sin menores ni contact_id), no los matches estrictos del cerebro.
 */
const searchesResponseSchema = publicSearchSchema.extend({
  results: z.array(searchResultSchema),
});

/**
 * Vinculo de canal opcional en el cuerpo. Si viene, se resuelve/crea el contacto
 * (ensureChannel) y su id pasa a ser el buscador_contact_id de la busqueda, para
 * poder notificar despues. `telefono` es SENSIBLE: solo entra, nunca sale.
 */
const channelInputSchema = z
  .object({
    plataforma: plataformaCanalSchema,
    chatId: z.string().trim().min(1),
    telefono: z.string().trim().min(1).optional(),
  })
  .strict();

/**
 * Cuerpo de POST /searches: la entrada de busqueda del dominio + un canal opcional.
 * `buscador_contact_id` directo sigue admitiendose (compatibilidad); si llega
 * `channel`, este tiene prioridad para resolver el contacto.
 */
const searchesBodySchema = searchCreateSchema.extend({
  channel: channelInputSchema.optional(),
});

export function registerSearchesRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /searches — registra quien busca a quien y dispara el matching.
  typed.route({
    method: "POST",
    url: "/searches",
    schema: {
      body: searchesBodySchema,
      response: { 201: searchesResponseSchema },
    },
    handler: async (request, reply) => {
      const { channel, ...searchInput } = request.body;

      // Si viene un canal, resolvemos/creamos el contacto y lo usamos como buscador.
      let buscadorContactId = searchInput.buscador_contact_id ?? null;
      if (channel !== undefined) {
        const link = await deps.channelLinkRepo.ensureChannel({
          plataforma: channel.plataforma,
          chatId: channel.chatId,
          ...(channel.telefono !== undefined ? { telefono: channel.telefono } : {}),
        });
        buscadorContactId = link.contactId;
      }

      const busqueda = await deps.searchRepo.create({
        ...searchInput,
        buscador_contact_id: buscadorContactId,
      });

      // Dispara el matching SOLO para busquedas de persona con nombre objetivo.
      // Best-effort: el matching propone matches 'propuesto'; NO notifica a nadie.
      const targetNombre = busqueda.target_nombre ?? "";
      const esBusquedaPersona =
        busqueda.tipo === "persona" && targetNombre.trim().length > 0;

      // Query de matching reutilizada por el cerebro (matches de fondo) y por el
      // re-ranking de los resultados instantaneos: misma definicion, un solo sitio.
      const matchQuery: MatchQuery | null = esBusquedaPersona
        ? {
            nombre: targetNombre,
            ...(busqueda.zona !== null ? { zona: busqueda.zona } : {}),
            ...(busqueda.target_descripcion !== null
              ? { descripcion: busqueda.target_descripcion }
              : {}),
          }
        : null;

      if (matchQuery !== null) {
        await runMatchingForSearch(
          { personRepo: deps.personRepo, matchRepo: deps.matchRepo },
          busqueda.id,
          matchQuery,
        );
      }

      // Resultados instantaneos para quien busca. El RPC publico (searchPersonsPublic)
      // se usa SOLO para RECUPERAR el conjunto de candidatos (su WHERE difuso trgm +
      // indices, sin menores ni contact_id); su `score` es el maximo de UN campo y
      // miente cuando solo coincide el nombre de pila. Por eso re-puntuamos y
      // re-ordenamos ese pool con rankCandidates (media ponderada multi-campo): el
      // usuario ve un parecido HONESTO, nunca certeza por un acierto parcial.
      let results: Array<z.infer<typeof searchResultSchema>> = [];
      if (matchQuery !== null) {
        const candidates = await deps.personRepo.searchPersonsPublic(
          matchQuery.nombre,
          matchQuery.zona,
        );
        const ranked = await rankCandidates(matchQuery, candidates);
        // El candidate de cada RankedCandidate es la vista publica (sin contacto);
        // adjuntamos el score ponderado para que el bot muestre el parecido real.
        results = ranked.map(({ candidate, score }) => ({ ...candidate, score }));
      }

      // Proyeccion publica: descarta buscador_contact_id antes de responder.
      const { buscador_contact_id: _sensible, ...publica } = busqueda;
      void _sensible;
      return reply.code(201).send({ ...publica, results });
    },
  });
}
