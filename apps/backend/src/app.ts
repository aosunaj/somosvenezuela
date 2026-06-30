import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { AppDeps } from "./deps.js";
import { errorHandler } from "./errors.js";
import {
  GLOBAL_RATE_LIMIT_MAX,
  RATE_LIMIT_TIME_WINDOW,
  rateLimitEnabledByDefault,
} from "./rate-limit.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPersonRoutes } from "./routes/persons.js";
import { registerPetRoutes } from "./routes/pets.js";
import { registerZoneRoutes } from "./routes/zones.js";
import { registerNeedRoutes } from "./routes/needs.js";
import { registerRegisterLinkedRoutes } from "./routes/register-linked.js";
import { registerDeleteSecureRoutes } from "./routes/delete-secure.js";
import { registerMarkFoundSecureRoutes } from "./routes/mark-found-secure.js";
import { registerPersonsMineRoutes } from "./routes/persons-mine.js";
import { registerNotificationsRoutes } from "./routes/notifications.js";
import { registerMatchRoutes } from "./routes/matches.js";
import { registerReunionRoutes } from "./routes/reunion.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerSearchesRoutes } from "./routes/searches.js";
import { registerConsentRoutes } from "./routes/consent.js";
import { registerRelayRoutes } from "./routes/relay.js";
import { registerRescatadoRoutes } from "./routes/rescatado.js";
import { registerAliveMessagesRoutes } from "./routes/alive-messages.js";

// App factory de la API.
//
// buildApp recibe sus dependencias por INYECCION (repos + serviceToken). Asi la
// API se prueba con repos falsos, sin red ni Supabase (ver test/). El cableado
// real (cliente service_role) vive solo en index.ts.

/** Opciones de construccion de la app (ademas de las dependencias de negocio). */
export interface BuildAppOptions {
  /**
   * Activa el rate limiting (global + estricto por-ruta, guardrail #6). Si se
   * omite, queda activo en cualquier entorno SALVO en tests (`NODE_ENV==='test'`),
   * donde se desactiva para que los 76 tests existentes no reciban 429. El test
   * enfocado de 429 lo activa de forma explicita con `rateLimitEnabled: true`.
   */
  rateLimitEnabled?: boolean;
  /**
   * Maximo de peticiones por ventana para el rate limit global (anti-abuso,
   * guardrail #6). Por defecto GLOBAL_RATE_LIMIT_MAX (100) por minuto.
   */
  rateLimitMax?: number;
  /** Ventana del rate limit. Por defecto "1 minute". */
  rateLimitTimeWindow?: string;
}

/**
 * Construye la instancia Fastify con validacion zod, rate limiting, manejo de
 * errores y todas las rutas registradas. No arranca el servidor (eso es listen()).
 */
export async function buildApp(
  deps: AppDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Oculta el header que delata el framework (endurecimiento basico).
    disableRequestLogging: true,
  });

  // Validacion y serializacion con zod (entrada y salida tipadas).
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Mapeo uniforme de errores a HTTP (zod -> 400, guardrail -> 422, db -> 500).
  app.setErrorHandler(errorHandler);

  // Rate limiting anti-spam/anti-scraping (guardrail #6). Dos capas:
  //   - GLOBAL por IP (este registro): freno general sobre toda la API.
  //   - ESTRICTO por-ruta (config.rateLimit en las rutas sensibles por canal):
  //     se aplica gracias a este mismo plugin; ver routes/{delete,mark-found}-secure.
  // Devuelve 429 al superar el limite. Se desactiva en tests (ver rateLimitEnabled)
  // para no romper los suites existentes, que ejercitan los endpoints en rafagas.
  const rateLimitEnabled = options.rateLimitEnabled ?? rateLimitEnabledByDefault();
  if (rateLimitEnabled) {
    await app.register(rateLimit, {
      max: options.rateLimitMax ?? GLOBAL_RATE_LIMIT_MAX,
      timeWindow: options.rateLimitTimeWindow ?? RATE_LIMIT_TIME_WINDOW,
    });
  }

  // Rutas.
  registerHealthRoutes(app);
  registerPersonRoutes(app, deps);
  registerSearchesRoutes(app, deps);
  registerSearchRoutes(app, deps);
  // Mascotas + mapa (lado publico).
  registerPetRoutes(app, {
    petRepo: deps.petRepo,
    petSearchRepo: deps.petSearchRepo,
    channelLinkRepo: deps.channelLinkRepo,
  });
  registerZoneRoutes(app, { zoneRepo: deps.zoneRepo, serviceToken: deps.serviceToken });
  registerNeedRoutes(app, { needRepo: deps.needRepo, serviceToken: deps.serviceToken });
  // Vinculo de canal, borrado seguro y notificaciones (lado interno/sensible).
  registerRegisterLinkedRoutes(app, {
    personRepo: deps.personRepo,
    channelLinkRepo: deps.channelLinkRepo,
  });
  registerDeleteSecureRoutes(app, {
    channelLinkRepo: deps.channelLinkRepo,
    secureDeleteRepo: deps.secureDeleteRepo,
  });
  registerMarkFoundSecureRoutes(app, {
    channelLinkRepo: deps.channelLinkRepo,
    secureDeleteRepo: deps.secureDeleteRepo,
    personRepo: deps.personRepo,
    personStateAuditRepo: deps.personStateAuditRepo,
  });
  // "Mis registros" por canal: el dueno lista los suyos para marcar/borrar sin codigos.
  registerPersonsMineRoutes(app, {
    channelLinkRepo: deps.channelLinkRepo,
    personRepo: deps.personRepo,
  });
  registerNotificationsRoutes(app, {
    notificationRepo: deps.notificationRepo,
    channelRepo: deps.channelRepo,
    serviceToken: deps.serviceToken,
  });
  // Revision humana de coincidencias (la IA sugiere, los humanos confirman).
  registerMatchRoutes(app, {
    matchRepo: deps.matchRepo,
    notificationRepo: deps.notificationRepo,
    serviceToken: deps.serviceToken,
  });
  // Reencuentro con consentimiento bilateral (Capa 2: reunir familias). El contacto
  // SOLO se comparte tras el doble «si»; el caso de menor no se conecta automaticamente.
  registerReunionRoutes(app, {
    channelLinkRepo: deps.channelLinkRepo,
    matchRepo: deps.matchRepo,
    notificationRepo: deps.notificationRepo,
  });
  // Consentimiento bilateral Model B (consent_sessions / relay_sessions).
  registerConsentRoutes(app, deps);
  // Relay de mensajes Model B.
  registerRelayRoutes(app, deps);
  // Reporte de persona rescatada/encontrada (Slice D). La ruta resuelve el lado
  // buscador (channel_id + contact_id) desde (plataforma, chatId) via channelLinkRepo.
  registerRescatadoRoutes(app, {
    personRepo: deps.personRepo,
    searchRepo: deps.searchRepo,
    consentRepo: deps.consentRepo,
    notificationRepo: deps.notificationRepo,
    channelLinkRepo: deps.channelLinkRepo,
    // Secreto compartido bot<->backend (Modelo B): la ruta /rescatado lo exige.
    botSecret: deps.botSecret,
  });
  // Mensajes "estoy vivo" (Spec 06, Slice 1): texto. Voz/Cloudinary en slices futuros.
  // Auth: secreto compartido bot<->backend (Modelo B), igual que /rescatado.
  registerAliveMessagesRoutes(app, {
    aliveMessagesRepo: deps.aliveMessagesRepo,
    botSecret: deps.botSecret,
  });

  return app;
}
