// core — Dominio compartido de SomosVenezuela.
// Tipos, validacion (zod) y reglas PURAS de negocio. Sin red ni Supabase.
// Los adaptadores (bots, web, backend) consumen este paquete; no replican reglas.

export * from "./enums.js";
export * from "./schemas.js";
export * from "./rules.js";
export * from "./conversation/index.js";
