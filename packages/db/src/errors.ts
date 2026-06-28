// Errores de la capa de datos. No vuelcan datos sensibles en su mensaje.

/** Error generico al operar contra la base de datos (insert/select/delete). */
export class DbError extends Error {
  override readonly name = "DbError";
  constructor(
    message: string,
    /** Codigo de error de PostgREST/Postgres si esta disponible (no sensible). */
    readonly code?: string,
  ) {
    super(message);
  }
}
