import { describe, expect, it } from "vitest";
import {
  esMenor,
  assertEstadoASalvoValido,
  GuardrailError,
  type EsMenorInput,
  type EstadoVerificacionInput,
} from "../src/index.js";

// Tests PUROS para las reglas de dominio de menores y estado a_salvo.
// Datos SINTETICOS sin PII real (guardrails #1).
//
// esMenor (design R2-4 / F2):
//   - null/refuerzo → siempre menor
//   - edad < 18 sin refuerzo → menor
//   - edad >= 18 sin refuerzo → adulto
// assertEstadoASalvoValido (diseño: espeja assertEstadoFallecidoValido):
//   - 'a_salvo' SOLO si verificacion='verificada'
//   - cualquier otro estado → permitido sin restricción
//   - 'a_salvo' + 'sin_verificar' → GuardrailError

describe("esMenor", () => {
  describe("refuerzo de tabla minors siempre gana", () => {
    it("tieneRefuerzoMinors=true edad adulta → sigue siendo menor", () => {
      const input: EsMenorInput = { edad: 25, tieneRefuerzoMinors: true };
      expect(esMenor(input)).toBe(true);
    });

    it("tieneRefuerzoMinors=true edad nula → menor", () => {
      const input: EsMenorInput = { edad: null, tieneRefuerzoMinors: true };
      expect(esMenor(input)).toBe(true);
    });
  });

  describe("edad nula sin refuerzo → conservador (menor)", () => {
    it("edad null sin refuerzo → menor (R2-4 conservative)", () => {
      const input: EsMenorInput = { edad: null, tieneRefuerzoMinors: false };
      expect(esMenor(input)).toBe(true);
    });
  });

  describe("edad < 18 → menor", () => {
    it("edad 0 → menor", () => {
      expect(esMenor({ edad: 0, tieneRefuerzoMinors: false })).toBe(true);
    });

    it("edad 17 → menor", () => {
      expect(esMenor({ edad: 17, tieneRefuerzoMinors: false })).toBe(true);
    });
  });

  describe("edad >= 18 sin refuerzo → adulto", () => {
    it("edad 18 → adulto", () => {
      expect(esMenor({ edad: 18, tieneRefuerzoMinors: false })).toBe(false);
    });

    it("edad 30 → adulto", () => {
      expect(esMenor({ edad: 30, tieneRefuerzoMinors: false })).toBe(false);
    });

    it("edad 99 → adulto", () => {
      expect(esMenor({ edad: 99, tieneRefuerzoMinors: false })).toBe(false);
    });
  });
});

describe("assertEstadoASalvoValido", () => {
  describe("estado !== 'a_salvo' → siempre permitido (no lanza)", () => {
    it("desaparecida + sin_verificar → OK", () => {
      const input: EstadoVerificacionInput = {
        estado: "desaparecida",
        verificacion: "sin_verificar",
      };
      expect(() => assertEstadoASalvoValido(input)).not.toThrow();
    });

    it("fallecida + verificada → OK (otra regla lo controla; esta no lanza)", () => {
      const input: EstadoVerificacionInput = {
        estado: "fallecida",
        verificacion: "verificada",
      };
      expect(() => assertEstadoASalvoValido(input)).not.toThrow();
    });

    it("reunida + sin_verificar → OK (a_salvo no aplica)", () => {
      const input: EstadoVerificacionInput = {
        estado: "reunida",
        verificacion: "sin_verificar",
      };
      expect(() => assertEstadoASalvoValido(input)).not.toThrow();
    });
  });

  describe("a_salvo requiere verificacion='verificada'", () => {
    it("a_salvo + verificada → OK (no lanza)", () => {
      const input: EstadoVerificacionInput = {
        estado: "a_salvo",
        verificacion: "verificada",
      };
      expect(() => assertEstadoASalvoValido(input)).not.toThrow();
    });

    it("a_salvo + sin_verificar → GuardrailError con code correcto", () => {
      const input: EstadoVerificacionInput = {
        estado: "a_salvo",
        verificacion: "sin_verificar",
      };
      expect(() => assertEstadoASalvoValido(input)).toThrow(GuardrailError);
    });

    it("GuardrailError.code = 'a_salvo_requiere_verificacion'", () => {
      const input: EstadoVerificacionInput = {
        estado: "a_salvo",
        verificacion: "sin_verificar",
      };
      try {
        assertEstadoASalvoValido(input);
        expect.fail("debería haber lanzado");
      } catch (e) {
        expect(e).toBeInstanceOf(GuardrailError);
        expect((e as GuardrailError).code).toBe("a_salvo_requiere_verificacion");
      }
    });

    it("a_salvo NUNCA puede setearse automáticamente (sin verificacion humana)", () => {
      // Guardrail: ningún flujo automático puede pasar estado='a_salvo'
      // sin fuente verificada. Defensa en profundidad.
      const automaticInput: EstadoVerificacionInput = {
        estado: "a_salvo",
        verificacion: "sin_verificar",
      };
      expect(() => assertEstadoASalvoValido(automaticInput)).toThrow(GuardrailError);
    });
  });
});
