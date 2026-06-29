import { z } from "zod";
import { publicPersonSchema } from "core";
import type { MatchRepo, NotificationRepo } from "db";
import { timingSafeEqualString } from "../security.js";
import { apiError } from "../errors.js";
import { idParamsSchema } from "../schemas.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Rutas de REVISION HUMANA de coincidencias (matches).
//
// GUARDRAILS:
//   - #4 (la IA sugiere, los humanos confirman): el motor crea matches
//     'propuesto'. Aqui un humano los CONFIRMA o DESCARTA. La notificacion al
//     buscador NACE solo al confirmar; nunca de forma automatica.
//   - #1 (privacidad): los listados de revision NO exponen contacto de ninguna
//     parte. El payload de la notificacion es un mensaje humano seguro + ids
//     internos, SIN datos de la otra persona ni telefono.
//
// SEGURIDAD: endpoints INTERNOS, protegidos con x-service-token (timing-safe),
// igual que /notifications. Solo el panel/operador autorizado revisa.

const SERVICE_TOKEN_HEADER = "x-service-token";

export interface MatchesDeps {
  /** Repositorio de coincidencias (cola de revision). */
  matchRepo: MatchRepo;
  /** Cola de notificaciones: se usa al confirmar para avisar al buscador. */
  notificationRepo: NotificationRepo;
  /** Secreto de servicio; si esta vacio/indefinido, estos endpoints responden 401. */
  serviceToken: string | undefined;
}

// Contexto publico de la busqueda en la cola de revision (sin buscador_contact_id).
const matchSearchContextSchema = z.object({
  target_nombre: z.string().nullable(),
  zona: z.string().nullable(),
});

// Match propuesto con contexto suficiente para decidir. SIN PII de contacto: el
// candidato es la vista publica (sin contact_id) y la busqueda no expone buscador.
const matchViewSchema = z.object({
  id: z.uuid(),
  score: z.number(),
  metodo: z.enum(["exacto", "trigram", "ia"]),
  created_at: z.iso.datetime({ offset: true }),
  search: matchSearchContextSchema,
  candidate: publicPersonSchema.nullable(),
});

const pendingResponseSchema = z.object({
  matches: z.array(matchViewSchema),
});

const okResponseSchema = z.object({ ok: z.literal(true) });

/**
 * Respuesta de confirm: { ok: true } y, cuando la busqueda es anonima (sin
 * contacto del buscador), ademas { notified: false }. Un unico schema con
 * `notified` opcional evita que el serializador de uniones descarte el campo.
 */
const confirmResponseSchema = z.object({
  ok: z.literal(true),
  notified: z.literal(false).optional(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

// Cuerpo opcional al confirmar: quien reviso (identificador libre, sin PII).
// Tolerante a cuerpo ausente: se valida en el handler tras autorizar, para que un
// POST sin body (lo normal aqui) no caiga en un 400 antes del chequeo de auth.
const confirmBodySchema = z
  .object({
    revisado_por: z.string().trim().min(1).max(120).optional(),
  })
  .nullish();

/** Mensaje humano SEGURO para el buscador. NO revela datos de la otra parte. */
const NOTIFICATION_MESSAGE =
  "Encontramos una posible coincidencia con tu busqueda. Una persona del equipo la revisara contigo. Gracias por confiar en SomosVenezuela.";

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
 *   GET  /matches/pending       (x-service-token) -> { matches: [...] }
 *   POST /matches/:id/confirm    (x-service-token) -> { ok: true } | { ok:true, notified:false }
 *   POST /matches/:id/discard    (x-service-token) -> { ok: true }
 */
export function registerMatchRoutes(
  app: FastifyInstance,
  deps: MatchesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const unauthorizedBody = apiError(
    "unauthorized",
    "No autorizado para realizar esta operacion.",
  );

  // GET /matches/pending — cola de revision (matches 'propuesto' con contexto).
  typed.route({
    method: "GET",
    url: "/matches/pending",
    schema: {
      response: { 200: pendingResponseSchema, 401: errorResponseSchema },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request.headers[SERVICE_TOKEN_HEADER], deps.serviceToken)) {
        return reply.code(401).send(unauthorizedBody);
      }
      const matches = await deps.matchRepo.listPendingWithContext();
      return reply.code(200).send({ matches });
    },
  });

  // POST /matches/:id/confirm — un humano confirma; nace la notificacion al buscador.
  typed.route({
    method: "POST",
    url: "/matches/:id/confirm",
    schema: {
      params: idParamsSchema,
      // El body se valida en el handler (tras autorizar) para que un POST sin
      // cuerpo no produzca un 400 antes del chequeo de auth.
      response: {
        200: confirmResponseSchema,
        401: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request.headers[SERVICE_TOKEN_HEADER], deps.serviceToken)) {
        return reply.code(401).send(unauthorizedBody);
      }

      const { id } = request.params;
      // Validamos el cuerpo opcional aqui (zod): { revisado_por? } o vacio.
      const parsed = confirmBodySchema.safeParse(request.body);
      const revisadoPor = parsed.success ? parsed.data?.revisado_por : undefined;

      // 1) Resolvemos a quien notificar ANTES de mutar (necesitamos el buscador).
      const ctx = await deps.matchRepo.getConfirmContext(id);

      // 2) Confirmamos (accion humana). Guardamos quien reviso si vino.
      await deps.matchRepo.setEstadoRevision(id, "confirmado", revisadoPor);

      // 3) Notificamos al buscador SOLO si conocemos su contacto. El payload es un
      //    mensaje humano seguro + ids internos; NUNCA datos de la otra parte ni
      //    telefono (guardrail #1).
      const buscadorContactId = ctx?.buscadorContactId ?? null;
      if (buscadorContactId === null) {
        // No hay a quien avisar (busqueda anonima): el match queda confirmado igual.
        return reply.code(200).send({ ok: true, notified: false });
      }

      await deps.notificationRepo.create({
        contact_id: buscadorContactId,
        channel_id: ctx?.channelId ?? null,
        tipo: "match",
        prioridad: "alta",
        payload: {
          mensaje: NOTIFICATION_MESSAGE,
          match_id: id,
          // ids internos de referencia (no son PII de contacto).
          ...(ctx?.searchId != null ? { search_id: ctx.searchId } : {}),
          ...(ctx?.personId != null ? { person_id: ctx.personId } : {}),
        },
      });

      return reply.code(200).send({ ok: true });
    },
  });

  // POST /matches/:id/discard — un humano descarta el match.
  typed.route({
    method: "POST",
    url: "/matches/:id/discard",
    schema: {
      params: idParamsSchema,
      response: { 200: okResponseSchema, 401: errorResponseSchema },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request.headers[SERVICE_TOKEN_HEADER], deps.serviceToken)) {
        return reply.code(401).send(unauthorizedBody);
      }
      await deps.matchRepo.setEstadoRevision(request.params.id, "descartado");
      return reply.code(200).send({ ok: true });
    },
  });
}
