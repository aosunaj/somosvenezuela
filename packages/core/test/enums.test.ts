import { describe, expect, it } from "vitest";
import { estadoPersonaSchema } from "../src/enums.js";

// Tests para el enum estado_persona, alineado con migrations/0001_init.sql +
// migration 0007_estado_a_salvo.sql que agrega el valor 'a_salvo'.
//
// Este test es el contrato: si alguna de las dos fuentes (SQL o código TS)
// diverge, el test lo detecta ANTES de llegar a producción (guardrail de
// despliegue: código + migración van en el mismo cambio, R2-2c).

describe("estadoPersonaSchema — alineado con estado_persona PostgreSQL enum", () => {
  it("incluye 'a_salvo' (agregado en 0007_estado_a_salvo.sql)", () => {
    expect(estadoPersonaSchema.options).toContain("a_salvo");
  });

  it("tiene exactamente los 6 valores del esquema (0001 + 0007)", () => {
    expect(estadoPersonaSchema.options).toEqual([
      "desaparecida",
      "encontrada_viva",
      "encontrada_herida",
      "fallecida",
      "reunida",
      "a_salvo",
    ]);
  });

  it("acepta 'a_salvo' como valor válido en safeParse", () => {
    const result = estadoPersonaSchema.safeParse("a_salvo");
    expect(result.success).toBe(true);
  });

  it("rechaza un valor inventado que no existe en el enum SQL", () => {
    const result = estadoPersonaSchema.safeParse("perdida");
    expect(result.success).toBe(false);
  });
});
