import { describe, expect, it } from "vitest";
import {
  subscribeToCaseWithoutConnection,
  type SubscribeCaseInput,
  type SubscribeCaseResult,
} from "../dedup.js";

// Tests TDD para la regla de dedup B-1: suscripcion sin conexion entre buscadores.
// Spec-delta Slice B: el sistema NUNCA conecta ni pone en contacto a dos buscadores
// que buscan a la misma persona o mascota.

describe("subscribeToCaseWithoutConnection", () => {
  it("devuelve una accion de tipo subscribe_interest con el caseId correcto", () => {
    const input: SubscribeCaseInput = {
      caseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      domain: "person",
    };
    const result = subscribeToCaseWithoutConnection(input);
    expect(result.action).toBe("subscribe_interest");
    expect(result.caseId).toBe(input.caseId);
  });

  it("funciona igualmente para mascotas", () => {
    const input: SubscribeCaseInput = {
      caseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      domain: "pet",
    };
    const result = subscribeToCaseWithoutConnection(input);
    expect(result.action).toBe("subscribe_interest");
    expect(result.domain).toBe("pet");
  });

  it("NUNCA genera accion de tipo open_relay", () => {
    const input: SubscribeCaseInput = {
      caseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      domain: "person",
    };
    const result = subscribeToCaseWithoutConnection(input);
    // Guardrail B-1: nunca debe ser open_relay (que conectaria a dos buscadores)
    expect(result.action).not.toBe("open_relay");
    expect(result.action).not.toBe("open_consent");
    expect(result.action).not.toBe("connect_searchers");
  });

  it("NUNCA expone informacion del otro buscador en el resultado", () => {
    const input: SubscribeCaseInput = {
      caseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      domain: "person",
    };
    const result = subscribeToCaseWithoutConnection(input);
    // El resultado no debe tener ningun campo con datos del otro buscador
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toMatch(/other_searcher|otro_buscador|searcher_contact/i);
    expect(resultStr).not.toMatch(/\d{10,}/); // no numeros de telefono
  });

  it("el resultado tiene la forma correcta (action, caseId, domain)", () => {
    const input: SubscribeCaseInput = {
      caseId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      domain: "pet",
    };
    const result: SubscribeCaseResult = subscribeToCaseWithoutConnection(input);
    expect(result).toHaveProperty("action");
    expect(result).toHaveProperty("caseId");
    expect(result).toHaveProperty("domain");
    expect(result.action).toBe("subscribe_interest");
    expect(result.caseId).toBe(input.caseId);
    expect(result.domain).toBe(input.domain);
  });

  it("es idempotente: misma entrada, mismo resultado (funcion pura)", () => {
    const input: SubscribeCaseInput = {
      caseId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      domain: "person",
    };
    const r1 = subscribeToCaseWithoutConnection(input);
    const r2 = subscribeToCaseWithoutConnection(input);
    expect(r1).toEqual(r2);
  });
});
