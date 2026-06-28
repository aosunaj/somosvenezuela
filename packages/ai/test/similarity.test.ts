import { describe, expect, it } from "vitest";
import {
  clamp01,
  combinedSimilarity,
  levenshteinDistance,
  levenshteinSimilarity,
  trigramSimilarity,
  trigrams,
} from "../src/index.js";

// Datos SINTETICOS — sin PII real (guardrails #1).
// Pruebas de metricas de similitud locales: rango [0,1], exacto=1, cercano alto.

describe("levenshteinDistance", () => {
  it("es 0 para cadenas iguales", () => {
    expect(levenshteinDistance("jose", "jose")).toBe(0);
  });

  it("cuenta ediciones simples", () => {
    expect(levenshteinDistance("gonzalez", "gonzales")).toBe(1);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });
});

describe("levenshteinSimilarity", () => {
  it("exacto = 1.0", () => {
    expect(levenshteinSimilarity("martinez", "martinez")).toBe(1);
  });

  it("dos vacias se consideran identicas (1)", () => {
    expect(levenshteinSimilarity("", "")).toBe(1);
  });

  it("variante cercana puntua alto", () => {
    expect(levenshteinSimilarity("gonzalez", "gonzales")).toBeGreaterThan(0.8);
  });

  it("no relacionado puntua bajo", () => {
    expect(levenshteinSimilarity("jose", "wladimir")).toBeLessThan(0.4);
  });

  it("siempre en [0,1]", () => {
    const s = levenshteinSimilarity("abc", "xyz");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("trigrams", () => {
  it("genera 3-gramas con padding de bordes", () => {
    const grams = trigrams("ab");
    expect(grams.size).toBeGreaterThan(0);
  });

  it("cadena vacia produce conjunto vacio", () => {
    expect(trigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("exacto = 1.0", () => {
    expect(trigramSimilarity("caracas", "caracas")).toBe(1);
  });

  it("captura reordenamientos de palabras", () => {
    const a = "camisa azul pelo rizado";
    const b = "pelo rizado camisa azul";
    expect(trigramSimilarity(a, b)).toBeGreaterThan(0.6);
  });

  it("no relacionado puntua bajo", () => {
    expect(trigramSimilarity("caracas", "wladimir")).toBeLessThan(0.3);
  });
});

describe("combinedSimilarity", () => {
  it("exacto = 1.0", () => {
    expect(combinedSimilarity("jose", "jose")).toBe(1);
  });

  it("variante cercana alta, no relacionado bajo", () => {
    expect(combinedSimilarity("gonzalez", "gonzales")).toBeGreaterThan(0.75);
    expect(combinedSimilarity("jose", "wladimir")).toBeLessThan(0.4);
  });

  it("respeta el peso de Levenshtein en los extremos", () => {
    // peso 1 -> solo Levenshtein; peso 0 -> solo trigramas.
    const onlyLev = combinedSimilarity("gonzalez", "gonzales", 1);
    const onlyTri = combinedSimilarity("gonzalez", "gonzales", 0);
    expect(onlyLev).toBeCloseTo(levenshteinSimilarity("gonzalez", "gonzales"));
    expect(onlyTri).toBeCloseTo(trigramSimilarity("gonzalez", "gonzales"));
  });
});

describe("clamp01", () => {
  it("acota a [0,1]", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });

  it("NaN se trata como 0", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
