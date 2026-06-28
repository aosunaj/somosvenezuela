// db — Capa de persistencia de SomosVenezuela.
//
// Centraliza el acceso a datos (docs/sdd/02-design.md): cliente Supabase,
// repositorios y mapeos. NO contiene reglas de negocio: el dominio vive en `core`.
//
// Garantia de privacidad (guardrail #1): la lectura publica pasa SOLO por las
// vistas *_public (sin contact_id, sin menores) y los repos publicos tipan sus
// filas sin contact_id; ademas se aplica toPublicPerson/toPublicPet como
// salvaguarda. Los repos de contacts/channels son SENSIBLES (solo backend).

export { loadDbEnv, DbConfigError, type DbEnv } from "./env.js";
export {
  createServiceClient,
  getServiceClient,
  type DbClient,
} from "./client.js";
export { DbError } from "./errors.js";

// Tipos de fila (BD) y mapeos a dominio.
export * from "./types.js";
export * from "./mappers.js";

// Repositorios.
export * from "./repos/index.js";
