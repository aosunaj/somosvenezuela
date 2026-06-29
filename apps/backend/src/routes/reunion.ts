import { z } from "zod";
import { plataformaCanalSchema } from "core";
import type { ChannelLinkRepo, MatchRepo, NotificationRepo } from "db";
import type {
  ReunionConsentResult,
  ReunionParteContacto,
} from "db";
import { sensitiveRouteRateLimit } from "../rate-limit.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Rutas de REENCUENTRO con CONSENTIMIENTO BILATERAL (Capa 2: reunir familias).
//
// Es el corazon de la mision y es SENSIBLE: habilita compartir el contacto entre dos
// personas, pero SOLO con el «si» explicito de AMBAS. La salvaguarda (decision de la
// duena) es el doble consentimiento; NO hay paso de moderador humano.
//
// FLUJO:
//   1) POST /reunion/request  — el BUSCADOR (por su canal) elige a una persona de los
//      resultados. Su consentimiento es sincrono. El backend:
//        - aplica el GATE DE MENORES (guardrail #2 antitrata): si es menor, NO conecta.
//        - registra el consentimiento del buscador y SOLICITA el del registrante.
//        - crea una notificacion al REGISTRANTE pidiendo /conectar o /rechazar.
//      NO comparte contacto: el registrante decide a ciegas (solo sabe el nombre).
//   2) POST /reunion/consent  — el REGISTRANTE (por su canal) responde /conectar o
//      /rechazar. Es un comando GLOBAL del bot (sin estado de sesion). El backend
//      correlaciona su solicitud PENDIENTE por el contacto del canal y:
//        - si RECHAZA: cierra sin compartir nada y avisa amablemente al buscador.
//        - si AMBOS aceptan: crea DOS notificaciones punto a punto, cada una con el
//          contacto de la OTRA parte. ESTE es el UNICO punto donde viaja el telefono.
//
// PRIVACIDAD (guardrail #1): el telefono solo se incluye en el payload de las DOS
// notificaciones del intercambio final (tras el doble «si»). En ningun otro mensaje,
// listado ni respuesta aparece contacto alguno. Las rutas autorizan/correlacionan por
// la PROPIEDAD del canal (plataforma + chatId), igual que el borrado/rescatado seguros.

export interface ReunionDeps {
  /** Resuelve el contacto dueno de un canal (buscador o registrante). */
  channelLinkRepo: ChannelLinkRepo;
  /** Coincidencias + consentimiento bilateral del reencuentro. */
  matchRepo: MatchRepo;
  /** Cola de notificaciones: avisos al registrante / buscador e intercambio final. */
  notificationRepo: NotificationRepo;
}

// ── Mensajes humanos SEGUROS (espanol calido). NUNCA incluyen contacto salvo el
//    intercambio final, donde el telefono va en un campo aparte del payload. ──

/** Aviso al registrante: alguien busca a su registrado y quiere conectar. Sin contacto. */
const MENSAJE_SOLICITUD_REGISTRANTE =
  "Alguien esta buscando a una persona que registraste y quiere reunirse con ella. " +
  "Si te parece bien que compartamos sus contactos para que se reunan, responde /conectar " +
  "para aceptar, o /rechazar si prefieres que no. Nadie comparte su contacto sin tu permiso.";

/** Aviso al buscador cuando el registrante RECHAZA. Sin revelar datos de la otra parte. */
const MENSAJE_RECHAZO_BUSCADOR =
  "Gracias por tu paciencia. Por ahora la otra parte prefiere no compartir su contacto, " +
  "asi que no podemos conectarlos. Seguimos aqui para ayudarte a buscar. Nadie se queda atras.";

/** Construye el aviso de intercambio (doble si) con el telefono de la OTRA parte. */
function mensajeIntercambio(telefonoOtraParte: string | null): string {
  const base =
    "Buenas noticias: ambas partes aceptaron conectarse. Pueden ponerse en contacto para reunirse.";
  if (telefonoOtraParte === null || telefonoOtraParte.length === 0) {
    // Sin telefono guardado: avisamos del si mutuo igual; el contacto se coordinara aparte.
    return `${base} Pronto te ayudaremos a coordinar el contacto.`;
  }
  return `${base} Este es el telefono de contacto: ${telefonoOtraParte}.`;
}

// ── Esquemas de entrada (zod): prueba de propiedad del canal ─────────────────

const channelOwnershipSchema = z
  .object({
    plataforma: plataformaCanalSchema,
    chatId: z.string().trim().min(1),
  })
  .strict();

/** Cuerpo de POST /reunion/request: el canal del buscador + la persona elegida. */
const requestBodySchema = z
  .object({
    channel: channelOwnershipSchema,
    personId: z.uuid(),
  })
  .strict();

/** Cuerpo de POST /reunion/consent: el canal del registrante + su decision. */
const consentBodySchema = z
  .object({
    channel: channelOwnershipSchema,
    decision: z.enum(["aceptado", "rechazado"]),
  })
  .strict();

/**
 * Respuesta de /reunion/request, alineada con el `request_reunion` de la maquina del
 * bot: el bot la traduce a un mensaje calido. NO expone contacto.
 *   - 'requested' : se aviso al registrante y se espera su respuesta.
 *   - 'minor'     : la persona es menor; requiere entidad verificada (guardrail #2).
 *   - 'failed'    : no se pudo iniciar (no encontrada). Generico, sin revelar nada.
 */
const requestResponseSchema = z.object({
  status: z.enum(["requested", "minor", "failed"]),
});

/** Respuesta de /reunion/consent: el resultado del consentimiento, sin PII. */
const consentResponseSchema = z.object({
  status: z.enum(["not_found", "rejected", "exchanged", "accepted_waiting"]),
});

/**
 * Encola las DOS notificaciones del intercambio final: a cada parte, el contacto de la
 * OTRA. Es la UNICA funcion que pone un telefono en un payload, y solo se la llama con
 * un resultado 'exchanged' (doble «si»). Si una parte no tiene canal resoluble, su
 * aviso se omite (no hay por donde entregarlo); nunca se filtra a la otra.
 */
async function encolarIntercambio(
  notificationRepo: NotificationRepo,
  matchId: string,
  buscador: ReunionParteContacto,
  registrante: ReunionParteContacto,
): Promise<void> {
  const avisos: Array<{ parte: ReunionParteContacto; telefonoOtraParte: string | null }> = [
    // Al buscador le damos el telefono del registrante, y viceversa.
    { parte: buscador, telefonoOtraParte: registrante.telefono },
    { parte: registrante, telefonoOtraParte: buscador.telefono },
  ];

  for (const { parte, telefonoOtraParte } of avisos) {
    if (parte.channelId === null) continue; // sin canal: no entregable; se omite.
    await notificationRepo.create({
      contact_id: parte.contactId,
      channel_id: parte.channelId,
      tipo: "info",
      prioridad: "alta",
      payload: {
        mensaje: mensajeIntercambio(telefonoOtraParte),
        match_id: matchId,
      },
    });
  }
}

/**
 * Registra:
 *   POST /reunion/request  (canal del buscador)    -> { status }
 *   POST /reunion/consent  (canal del registrante) -> { status }
 */
export function registerReunionRoutes(app: FastifyInstance, deps: ReunionDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /reunion/request — el BUSCADOR inicia el reencuentro con una persona.
  typed.route({
    method: "POST",
    url: "/reunion/request",
    // Operacion SENSIBLE por canal: rate limit estricto (guardrail #6).
    config: sensitiveRouteRateLimit,
    schema: {
      body: requestBodySchema,
      response: { 200: requestResponseSchema },
    },
    handler: async (request, reply) => {
      const { channel, personId } = request.body;

      // Contacto del buscador a partir de la PROPIEDAD del canal. Si el canal no existe
      // aun, no hay buscador con quien correlacionar: respondemos generico (sin revelar).
      const buscadorContactId = await deps.channelLinkRepo.findContactByChannel(
        channel.plataforma,
        channel.chatId,
      );
      if (buscadorContactId === null) {
        return reply.code(200).send({ status: "failed" });
      }

      // El repo aplica el GATE DE MENORES y, si procede, registra el consentimiento del
      // buscador y solicita el del registrante. NO comparte contacto.
      const outcome = await deps.matchRepo.requestReunion({ buscadorContactId, personId });

      if (outcome.outcome === "minor_blocked") {
        // Guardrail #2: caso de menor, no se conecta automaticamente.
        return reply.code(200).send({ status: "minor" });
      }
      if (outcome.outcome === "not_found") {
        // Sin match buscador<->persona: generico, sin revelar si existe el registro.
        return reply.code(200).send({ status: "failed" });
      }

      // 'requested': avisamos al REGISTRANTE pidiendole permiso. SIN datos de contacto.
      // Si no tiene canal resoluble, igualmente quedo 'solicitado' (podra responder por
      // otro medio); no encolamos un aviso sin destino.
      if (outcome.registrante.channelId !== null && outcome.registrante.contactId.length > 0) {
        await deps.notificationRepo.create({
          contact_id: outcome.registrante.contactId,
          channel_id: outcome.registrante.channelId,
          tipo: "info",
          prioridad: "alta",
          payload: {
            mensaje: MENSAJE_SOLICITUD_REGISTRANTE,
            match_id: outcome.matchId,
          },
        });
      }

      return reply.code(200).send({ status: "requested" });
    },
  });

  // POST /reunion/consent — el REGISTRANTE acepta (/conectar) o rechaza (/rechazar).
  typed.route({
    method: "POST",
    url: "/reunion/consent",
    config: sensitiveRouteRateLimit,
    schema: {
      body: consentBodySchema,
      response: { 200: consentResponseSchema },
    },
    handler: async (request, reply) => {
      const { channel, decision } = request.body;

      // Contacto del registrante por la PROPIEDAD de su canal. Sin canal conocido no hay
      // solicitud que correlacionar: respondemos 'not_found' (sin revelar nada).
      const registranteContactId = await deps.channelLinkRepo.findContactByChannel(
        channel.plataforma,
        channel.chatId,
      );
      if (registranteContactId === null) {
        return reply.code(200).send({ status: "not_found" });
      }

      const outcome: ReunionConsentResult = await deps.matchRepo.respondReunion({
        registranteContactId,
        decision,
      });

      if (outcome.outcome === "not_found") {
        return reply.code(200).send({ status: "not_found" });
      }

      if (outcome.outcome === "rejected") {
        // Cerrado sin compartir nada: avisamos amablemente al buscador (si tiene canal).
        if (outcome.buscador.contactId !== null && outcome.buscador.channelId !== null) {
          await deps.notificationRepo.create({
            contact_id: outcome.buscador.contactId,
            channel_id: outcome.buscador.channelId,
            tipo: "info",
            prioridad: "normal",
            payload: {
              mensaje: MENSAJE_RECHAZO_BUSCADOR,
              match_id: outcome.matchId,
            },
          });
        }
        return reply.code(200).send({ status: "rejected" });
      }

      if (outcome.outcome === "exchanged") {
        // DOBLE «SI»: UNICO punto donde se comparte contacto (punto a punto).
        await encolarIntercambio(
          deps.notificationRepo,
          outcome.matchId,
          outcome.buscador,
          outcome.registrante,
        );
        return reply.code(200).send({ status: "exchanged" });
      }

      // 'accepted_waiting': acepto pero (anomalo) el buscador no figura aceptado; no se
      // intercambia. Defensa en profundidad: sin contacto compartido.
      return reply.code(200).send({ status: "accepted_waiting" });
    },
  });
}
