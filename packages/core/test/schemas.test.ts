import { describe, expect, it } from "vitest";
import {
  edadSchema,
  personCreateSchema,
  petCreateSchema,
  searchCreateSchema,
  publicPersonSchema,
  estadoPersonaSchema,
  fuenteDatoSchema,
  estadoVerificacionSchema,
  plataformaCanalSchema,
} from "../src/index.js";

describe("enums espejados de 0001_init.sql", () => {
  it("estado_persona tiene exactamente los 5 valores del esquema", () => {
    expect(estadoPersonaSchema.options).toEqual([
      "desaparecida",
      "encontrada_viva",
      "encontrada_herida",
      "fallecida",
      "reunida",
    ]);
  });

  it("fuente_dato tiene exactamente los 6 valores del esquema", () => {
    expect(fuenteDatoSchema.options).toEqual([
      "propia",
      "cruz_roja",
      "ocha",
      "hospital",
      "refugio",
      "plataforma_aliada",
    ]);
  });

  it("estado_verificacion y plataforma_canal", () => {
    expect(estadoVerificacionSchema.options).toEqual(["verificada", "sin_verificar"]);
    expect(plataformaCanalSchema.options).toEqual(["telegram", "whatsapp"]);
  });
});

describe("validacion de edad (constraint 0..129 o null)", () => {
  it("acepta limites validos y null", () => {
    expect(edadSchema.parse(0)).toBe(0);
    expect(edadSchema.parse(129)).toBe(129);
    expect(edadSchema.parse(null)).toBeNull();
  });

  it("rechaza fuera de rango y no enteros", () => {
    expect(edadSchema.safeParse(-1).success).toBe(false);
    expect(edadSchema.safeParse(130).success).toBe(false);
    expect(edadSchema.safeParse(12.5).success).toBe(false);
  });
});

describe("personCreateSchema", () => {
  it("requiere nombre no vacio", () => {
    expect(personCreateSchema.safeParse({}).success).toBe(false);
    expect(personCreateSchema.safeParse({ nombre: "" }).success).toBe(false);
    expect(personCreateSchema.safeParse({ nombre: "   " }).success).toBe(false);
  });

  it("acepta una entrada minima valida", () => {
    const parsed = personCreateSchema.parse({ nombre: "Persona Sintetica" });
    expect(parsed.nombre).toBe("Persona Sintetica");
  });

  it("rechaza edad invalida en la entrada de creacion", () => {
    expect(personCreateSchema.safeParse({ nombre: "X", edad: 200 }).success).toBe(false);
  });

  it("rechaza fuente fuera del enum", () => {
    expect(
      personCreateSchema.safeParse({ nombre: "X", fuente: "inventada" }).success,
    ).toBe(false);
  });
});

describe("petCreateSchema y searchCreateSchema", () => {
  it("pet acepta entrada minima (nombre opcional)", () => {
    expect(petCreateSchema.safeParse({}).success).toBe(true);
    expect(petCreateSchema.safeParse({ tipo: "gato" }).success).toBe(true);
  });

  it("search requiere tipo del enum persona|mascota", () => {
    expect(searchCreateSchema.safeParse({}).success).toBe(false);
    expect(searchCreateSchema.safeParse({ tipo: "persona" }).success).toBe(true);
    expect(searchCreateSchema.safeParse({ tipo: "otro" }).success).toBe(false);
  });
});

describe("publicPersonSchema (contrato de privacidad a nivel de esquema)", () => {
  it("no incluye contact_id en su shape", () => {
    expect(Object.keys(publicPersonSchema.shape)).not.toContain("contact_id");
  });
});
