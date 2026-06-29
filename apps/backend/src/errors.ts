import { GuardrailError } from "core";
import { DbError } from "db";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  type ZodFastifySchemaValidationError,
} from "fastify-type-provider-zod";
import type { FastifyReply, FastifyRequest } from "fastify";

// Mapeo centralizado de errores de dominio/datos a respuestas HTTP.
//
// Principio: los mensajes de cara al usuario van en espanol neutral y NUNCA
// filtran detalles internos (consultas SQL, codigos de Postgres, stack traces).
// El error completo se registra en el log del servidor, no en la respuesta.

/** Cuerpo de error uniforme de la API. */
export interface ApiErrorBody {
  /** Codigo estable, legible por maquina (en ingles). */
  error: string;
  /** Mensaje de cara al usuario, en espanol neutral. */
  message: string;
}

/** Construye un cuerpo de error uniforme. */
export function apiError(error: string, message: string): ApiErrorBody {
  return { error, message };
}

/** Error que ya trae su propio codigo HTTP (p. ej. el 429 de @fastify/rate-limit). */
interface HttpStatusError {
  statusCode: number;
}

/**
 * Detecta errores que YA portan un statusCode HTTP propio (los que lanzan plugins
 * de Fastify como @fastify/rate-limit con 429). Hay que respetar ese codigo en vez
 * de aplastarlo a un 500 generico (un rate limit superado NO es un fallo del
 * servidor). Solo aceptamos codigos 4xx para no enmascarar errores 5xx reales.
 */
function isHttpStatusError(error: unknown): error is HttpStatusError {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return false;
  }
  const status = (error as { statusCode: unknown }).statusCode;
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * Construye un 400 a partir de los errores de validacion de zod que adjunta
 * fastify-type-provider-zod. No vuelca el detalle crudo (puede contener el valor
 * recibido); solo nombra las rutas de los campos invalidos.
 */
function badRequest(
  reply: FastifyReply,
  issues: ZodFastifySchemaValidationError[],
): FastifyReply {
  const campos = issues
    .map((issue) => issue.instancePath.replace(/^\//, "").replace(/\//g, "."))
    .filter((ruta) => ruta.length > 0);
  const detalle =
    campos.length > 0 ? ` Revisa: ${[...new Set(campos)].join(", ")}.` : "";
  return reply
    .code(400)
    .send(apiError("validation_error", `Los datos enviados no son validos.${detalle}`));
}

/**
 * Manejador de errores de Fastify. Mapea:
 *   - validacion de entrada (zod) -> 400
 *   - GuardrailError              -> 422 (regla de dominio incumplida)
 *   - DbError                     -> 500 (sin exponer el detalle interno)
 *   - serializacion de respuesta  -> 500 (bug del servidor, no del cliente)
 *   - resto                       -> 500 generico
 *
 * Se registra el error real en el log, nunca en la respuesta.
 */
export function errorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  // Entrada invalida: el provider zod adjunta las issues en `error.validation`.
  if (hasZodFastifySchemaValidationErrors(error)) {
    return badRequest(reply, error.validation);
  }

  if (error instanceof GuardrailError) {
    // Regla de dominio incumplida: la peticion es sintacticamente valida pero
    // viola un guardrail. El `code` es estable y no sensible.
    return reply
      .code(422)
      .send(apiError(error.code, "La operacion no cumple una regla de proteccion del sistema."));
  }

  if (error instanceof DbError) {
    // No se expone el mensaje de la BD al cliente (puede contener detalles internos).
    request.log.error({ err: error }, "DbError en handler");
    return reply
      .code(500)
      .send(apiError("db_error", "No se pudo completar la operacion. Intentalo de nuevo mas tarde."));
  }

  if (isResponseSerializationError(error)) {
    // La respuesta no encaja con su schema: es un bug del servidor, nunca culpa
    // del cliente. No se filtra el detalle del schema.
    request.log.error({ err: error }, "Error de serializacion de respuesta");
    return reply
      .code(500)
      .send(apiError("internal_error", "Ocurrio un error inesperado. Intentalo de nuevo mas tarde."));
  }

  if (isHttpStatusError(error)) {
    // Errores 4xx con codigo propio (p. ej. 429 del rate limit, guardrail #6). Se
    // respeta su statusCode; no es un fallo del servidor. Mensaje en espanol neutral
    // y sin filtrar detalles internos.
    if (error.statusCode === 429) {
      return reply
        .code(429)
        .send(apiError("rate_limited", "Demasiadas peticiones. Espera un momento e intentalo de nuevo."));
    }
    return reply
      .code(error.statusCode)
      .send(apiError("request_error", "No se pudo procesar la peticion."));
  }

  // Cualquier otro error: respuesta generica.
  request.log.error({ err: error }, "Error no controlado en handler");
  return reply
    .code(500)
    .send(apiError("internal_error", "Ocurrio un error inesperado. Intentalo de nuevo mas tarde."));
}
