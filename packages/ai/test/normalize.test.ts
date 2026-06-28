import { describe, expect, it } from "vitest";
import {
  canonicalizeToken,
  nameTokens,
  normalizeName,
  normalizeText,
} from "../src/index.js";

// Datos SINTETICOS — sin PII real (guardrails #1, CLAUDE.md).
// Pruebas de normalizacion de texto y nombres (apodos, tildes, mayusculas).

describe("normalizeText", () => {
  it("pasa a minusculas", () => {
    expect(normalizeText("JOSE")).toBe("jose");
  });

  it("quita tildes y diacriticos", () => {
    expect(normalizeText("José")).toBe("jose");
    expect(normalizeText("Pérez")).toBe("perez");
    expect(normalizeText("María")).toBe("maria");
  });

  it("preserva la ñ, incluso dentro de palabra", () => {
    expect(normalizeText("Muñoz")).toBe("muñoz");
    expect(normalizeText("niño")).toBe("niño");
    expect(normalizeText("Ñublense")).toBe("ñublense");
  });

  it("colapsa espacios y recorta", () => {
    expect(normalizeText("  jose   martinez  ")).toBe("jose martinez");
  });

  it("convierte puntuacion en separadores", () => {
    expect(normalizeText("María-José")).toBe("maria jose");
    expect(normalizeText("O'Brien")).toBe("o brien");
  });

  it("devuelve cadena vacia para entrada vacia", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("   ")).toBe("");
  });
});

describe("canonicalizeToken", () => {
  it("mapea apodos conocidos a su forma canonica", () => {
    expect(canonicalizeToken("pepe")).toBe("jose");
    expect(canonicalizeToken("nacho")).toBe("ignacio");
    expect(canonicalizeToken("quique")).toBe("enrique");
  });

  it("deja igual los tokens que no son apodos", () => {
    expect(canonicalizeToken("jose")).toBe("jose");
    expect(canonicalizeToken("martinez")).toBe("martinez");
  });
});

describe("normalizeName", () => {
  it("normaliza tildes y mayusculas", () => {
    expect(normalizeName("José")).toBe("jose");
  });

  it("aplica el diccionario de apodos token a token", () => {
    // Pepe -> jose
    expect(normalizeName("Pepe")).toBe("jose");
    // Toño -> tono -> antonio
    expect(normalizeName("Toño")).toBe("antonio");
    // Mari -> maria
    expect(normalizeName("Mari Perez")).toBe("maria perez");
  });

  it("apodo y nombre canonico normalizan al mismo valor", () => {
    expect(normalizeName("Pepe")).toBe(normalizeName("José"));
    expect(normalizeName("Toño Pérez")).toBe(normalizeName("Antonio Perez"));
  });
});

describe("nameTokens", () => {
  it("tokeniza un nombre normalizado", () => {
    expect(nameTokens("José Martínez")).toEqual(["jose", "martinez"]);
  });

  it("devuelve lista vacia para entrada vacia", () => {
    expect(nameTokens("   ")).toEqual([]);
  });
});
