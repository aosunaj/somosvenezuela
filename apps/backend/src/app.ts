import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { AppDeps } from "./deps.js";
import { errorHandler } from "./errors.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPersonRoutes } from "./routes/persons.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerSearchesRoutes } from "./routes/searches.js";

// App factory de la API.
//
// buildApp recibe sus dependencias por INYECCION (repos + serviceToken). Asi la
// API se prueba con repos falsos, sin red ni Supabase (ver test/). El cableado
// real (cliente service_role) vive solo en index.ts.

/** Opciones de construccion de la app (ademas de las dependencias de negocio). */
export interface BuildAppOptions {
  /**
   * Maximo de peticiones por ventana para el rate limit global (anti-abuso,
   * guardrail #7). Por defecto 100 por minuto.
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

  // Rate limiting global anti-spam/anti-scraping (guardrail #7). Cubre escritura
  // y busqueda. Devuelve 429 al superar el limite.
  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 100,
    timeWindow: options.rateLimitTimeWindow ?? "1 minute",
  });

  // Rutas.
  registerHealthRoutes(app);
  registerPersonRoutes(app, deps);
  registerSearchesRoutes(app, deps);
  registerSearchRoutes(app, deps);

  return app;
}
