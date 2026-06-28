import { describe, expect, it } from "vitest";
import {
  NullAiScorer,
  rankCandidates,
  type AiScorer,
  type PublicPerson,
} from "../src/index.js";

// Datos SINTETICOS — sin PII real (guardrails #1, CLAUDE.md).
// Pruebas del motor de matching: orden por score, metodo correcto, degradacion.

const TS = "2026-06-01T00:00:00.000Z";

/** Construye una PublicPerson sintetica (sin datos de contacto). */
function person(
  id: string,
  nombre: string,
  opts: {
    apellidos?: string | null;
    zona?: string | null;
    descripcion?: string | null;
  } = {},
): PublicPerson {
  return {
    id,
    nombre,
    apellidos: opts.apellidos ?? null,
    edad: null,
    zona: opts.zona ?? null,
    descripcion: opts.descripcion ?? null,
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: TS,
    updated_at: TS,
  };
}

const ID_MATCH = "11111111-1111-4111-8111-111111111111";
const ID_NEAR = "22222222-2222-4222-8222-222222222222";
const ID_FAR = "33333333-3333-4333-8333-333333333333";

describe("rankCandidates — orden y metodo", () => {
  it("ordena por score descendente y pone el match exacto primero", async () => {
    const candidates = [
      person(ID_FAR, "Wladimir", { apellidos: "Echeverria" }),
      person(ID_NEAR, "Jose", { apellidos: "Martines" }), // errata
      person(ID_MATCH, "Jose", { apellidos: "Martinez" }), // exacto
    ];

    const ranked = await rankCandidates(
      { nombre: "José Martínez" },
      candidates,
    );

    // El exacto queda primero...
    expect(ranked[0]?.candidate.id).toBe(ID_MATCH);
    expect(ranked[0]?.method).toBe("exacto");
    expect(ranked[0]?.score).toBe(1);

    // ...y el no relacionado queda ultimo.
    expect(ranked[ranked.length - 1]?.candidate.id).toBe(ID_FAR);

    // Scores monotonos no crecientes.
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it("un no-match queda al fondo con score bajo", async () => {
    const candidates = [
      person(ID_FAR, "Wladimir", { apellidos: "Echeverria" }),
      person(ID_MATCH, "Maria", { apellidos: "Gonzalez" }),
    ];
    const ranked = await rankCandidates(
      { nombre: "Maria Gonzalez" },
      candidates,
    );
    const far = ranked.find((r) => r.candidate.id === ID_FAR);
    expect(far?.score).toBeLessThan(0.4);
    expect(ranked[ranked.length - 1]?.candidate.id).toBe(ID_FAR);
  });

  it("casa apodos: 'Pepe' encuentra a 'Jose'", async () => {
    const candidates = [
      person(ID_FAR, "Pedro", { apellidos: "Rojas" }),
      person(ID_MATCH, "Jose", { apellidos: "Rodriguez" }),
    ];
    const ranked = await rankCandidates(
      { nombre: "Pepe Rodriguez" },
      candidates,
    );
    expect(ranked[0]?.candidate.id).toBe(ID_MATCH);
    expect(ranked[0]?.method).toBe("exacto");
  });

  it("metodo es 'trigram' para coincidencias difusas no exactas", async () => {
    const ranked = await rankCandidates({ nombre: "Maria Gonzalez" }, [
      person(ID_NEAR, "Maria", { apellidos: "Gonzales" }), // errata
    ]);
    expect(ranked[0]?.method).toBe("trigram");
    expect(ranked[0]?.score).toBeGreaterThan(0.6);
    expect(ranked[0]?.score).toBeLessThan(1);
  });
});

describe("rankCandidates — degradacion segura (guardrail #5)", () => {
  it("sin AiScorer produce resultados validos (solo local)", async () => {
    const ranked = await rankCandidates({ nombre: "Jose Martinez" }, [
      person(ID_MATCH, "Jose", { apellidos: "Martinez" }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.method).toBe("exacto");
    expect(ranked[0]?.method).not.toBe("ia");
  });

  it("si el AiScorer falla, conserva el score LOCAL y metodo 'trigram'", async () => {
    // NullAiScorer rechaza siempre: simula IA caida.
    // "Jose Marquez" vs "Jose Martinez" cae en la banda de duda -> iria a IA.
    const candidates = [
      person(ID_NEAR, "Jose", { apellidos: "Marquez" }), // dudoso
    ];
    const ranked = await rankCandidates({ nombre: "Jose Martinez" }, candidates, {
      aiScorer: NullAiScorer,
    });
    expect(ranked[0]?.method).toBe("trigram");
    expect(ranked[0]?.score).toBeGreaterThan(0.5);
  });

  it("con AiScorer OK, un caso DUDOSO se re-puntua como 'ia'", async () => {
    // Scorer que eleva el score: SUGERENCIA, no confirmacion.
    const boostScorer: AiScorer = {
      score: () => Promise.resolve({ score: 0.95, rationale: "sintetico" }),
    };
    // Candidato en la banda de duda [0.45, 0.85] -> pasa por la IA.
    const candidates = [
      person(ID_NEAR, "Jose", { apellidos: "Marquez" }),
    ];
    const ranked = await rankCandidates({ nombre: "Jose Martinez" }, candidates, {
      aiScorer: boostScorer,
    });
    expect(ranked[0]?.method).toBe("ia");
    expect(ranked[0]?.score).toBeCloseTo(0.95);
  });

  it("la IA NO se invoca en matches exactos (se resuelven localmente)", async () => {
    let called = false;
    const spyScorer: AiScorer = {
      score: () => {
        called = true;
        return Promise.resolve({ score: 0.1 });
      },
    };
    const ranked = await rankCandidates(
      { nombre: "Jose Martinez" },
      [person(ID_MATCH, "Jose", { apellidos: "Martinez" })],
      { aiScorer: spyScorer },
    );
    expect(ranked[0]?.method).toBe("exacto");
    expect(called).toBe(false);
  });
});

describe("rankCandidates — entradas borde", () => {
  it("universo vacio devuelve lista vacia", async () => {
    const ranked = await rankCandidates({ nombre: "Jose" }, []);
    expect(ranked).toEqual([]);
  });

  it("la vista de candidato nunca expone datos de contacto", async () => {
    const ranked = await rankCandidates({ nombre: "Jose Martinez" }, [
      person(ID_MATCH, "Jose", { apellidos: "Martinez" }),
    ]);
    // PublicPerson no tiene contact_id; lo afirmamos a nivel de runtime.
    expect(ranked[0]?.candidate).not.toHaveProperty("contact_id");
  });
});
