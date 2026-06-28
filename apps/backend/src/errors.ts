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

  // Cualquier otro error: respuesta generica.
  request.log.error({ err: error }, "Error no controlado en handler");
  return reply
    .code(500)
    .send(apiError("internal_error", "Ocurrio un error inesperado. Intentalo de nuevo mas tarde."));
}
