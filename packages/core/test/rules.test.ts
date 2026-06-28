import { describe, expect, it } from "vitest";
import {
  assertEstadoFallecidoValido,
  defaultsDeCreacion,
  esEstadoFallecidoValido,
  fuentePorDefecto,
  GuardrailError,
  toPublicPerson,
  toPublicPet,
  type Person,
  type Pet,
} from "../src/index.js";

// Datos SINTETICOS — sin PII real (docs/guardrails.md #1, docs/tdd-strategy.md).
const SYNTH_CONTACT_ID = "00000000-0000-4000-8000-000000000001";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nombre: "Persona Sintetica",
    apellidos: "De Prueba",
    edad: 30,
    zona: "Zona Ficticia",
    descripcion: "Datos de prueba sin PII real",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    contact_id: SYNTH_CONTACT_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    nombre: "Mascota Sintetica",
    tipo: "perro",
    raza: "mestizo",
    zona: "Zona Ficticia",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    contact_id: SYNTH_CONTACT_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("defaults de creacion", () => {
  it("nace 'desaparecida' y 'sin_verificar'", () => {
    expect(defaultsDeCreacion()).toEqual({
      estado: "desaparecida",
      verificacion: "sin_verificar",
    });
  });

  it("fuente por defecto es 'propia'", () => {
    expect(fuentePorDefecto()).toBe("propia");
  });
});

describe("guardrail de fallecidos", () => {
  it("acepta 'fallecida' cuando esta 'verificada'", () => {
    expect(
      esEstadoFallecidoValido({ estado: "fallecida", verificacion: "verificada" }),
    ).toBe(true);
    expect(() =>
      assertEstadoFallecidoValido({ estado: "fallecida", verificacion: "verificada" }),
    ).not.toThrow();
  });

  it("rechaza 'fallecida' cuando esta 'sin_verificar'", () => {
    expect(
      esEstadoFallecidoValido({ estado: "fallecida", verificacion: "sin_verificar" }),
    ).toBe(false);
    expect(() =>
      assertEstadoFallecidoValido({ estado: "fallecida", verificacion: "sin_verificar" }),
    ).toThrow(GuardrailError);
  });

  it("el error de guardrail expone el code de la constraint SQL", () => {
    try {
      assertEstadoFallecidoValido({ estado: "fallecida", verificacion: "sin_verificar" });
      expect.unreachable("deberia haber lanzado");
    } catch (err) {
      expect(err).toBeInstanceOf(GuardrailError);
      expect((err as GuardrailError).code).toBe("fallecida_requiere_verificacion");
    }
  });

  it("no aplica a otros estados (sin verificar es valido)", () => {
    for (const estado of ["desaparecida", "encontrada_viva", "encontrada_herida", "reunida"] as const) {
      expect(esEstadoFallecidoValido({ estado, verificacion: "sin_verificar" })).toBe(true);
    }
  });
});

describe("contrato de privacidad: el contacto nunca es visible", () => {
  it("toPublicPerson elimina contact_id", () => {
    const publica = toPublicPerson(makePerson());
    expect("contact_id" in publica).toBe(false);
    // Ningun valor de la vista publica filtra el id de contacto.
    expect(JSON.stringify(publica)).not.toContain(SYNTH_CONTACT_ID);
  });

  it("toPublicPet elimina contact_id", () => {
    const publica = toPublicPet(makePet());
    expect("contact_id" in publica).toBe(false);
    expect(JSON.stringify(publica)).not.toContain(SYNTH_CONTACT_ID);
  });

  it("la vista publica conserva fuente y verificacion (spec 01: visibles)", () => {
    const publica = toPublicPerson(makePerson({ fuente: "cruz_roja", verificacion: "verificada" }));
    expect(publica.fuente).toBe("cruz_roja");
    expect(publica.verificacion).toBe("verificada");
  });

  it("toPublicPerson nunca expone contacto incluso con contact_id null", () => {
    const publica = toPublicPerson(makePerson({ contact_id: null }));
    expect("contact_id" in publica).toBe(false);
  });
});
