import { describe, expect, it } from "vitest";
import { step } from "../src/index.js";
import type { ConversationState, StepResult } from "../src/conversation/state.js";

// Tests para el paso de la pregunta "¿es menor?" en la creación de búsqueda.
// Datos SINTETICOS sin PII real.
//
// Regla (R2-4a / design): El flujo de búsqueda DEBE preguntar explícitamente
// "¿La persona que buscás es menor de edad?" tras la descripción (o cuando sea
// el último paso de recolección). es_menor viene de la respuesta EXPLÍCITA,
// nunca de un default silencioso.
//
// CRÍTICO: Solo buscamos el comportamiento del reducer puro (estado, replies, effect).
// El adaptador (backend POST /searches) es quien setea es_menor server-side
// conservadoramente al crear la búsqueda. El reducer solo recoge la respuesta.

const searchingState = (draft: object = {}): ConversationState => ({
  flow: "search",
  step: "descripcion",
  draft: {
    nombre: "Juan",
    apellidos: null,
    edad: null,
    zona: null,
    ...draft,
  },
});

// Helper: avanzar desde el último paso de descripción
function stepDescripcionToMinor(descripcion: string): StepResult {
  const state = searchingState();
  return step(state, { kind: "text", text: descripcion });
}

describe("flujo search — pregunta de menor (paso 'menor')", () => {
  describe("al omitir la descripción → pasa a preguntar por menor", () => {
    it("omitir descripción → step='menor' con al menos un dato de búsqueda", () => {
      const result = stepDescripcionToMinor("-");
      // El flujo con al menos nombre debe avanzar a 'menor' en vez de buscar
      expect(result.state).toMatchObject({ flow: "search", step: "menor" });
    });

    it("la respuesta incluye al menos un mensaje (pregunta a la persona)", () => {
      const result = stepDescripcionToMinor("-");
      expect(result.replies.length).toBeGreaterThan(0);
      // El mensaje debe preguntar sobre la minoría de edad
      const textos = result.replies.map((r) => r.text).join(" ");
      expect(textos.toLowerCase()).toMatch(/menor|edad|a[ñn]o/);
    });
  });

  describe("en el paso 'menor' → respuesta si/no setea es_menor en el draft del efecto", () => {
    const estadoMenor: ConversationState = {
      flow: "search",
      step: "menor",
      draft: { nombre: "Juan", apellidos: null, edad: null, zona: null, descripcion: null },
    };

    it("respuesta 'si' → efecto search_persons con es_menor=true", () => {
      const result = step(estadoMenor, { kind: "text", text: "si" });
      expect(result.effect).toBeDefined();
      expect(result.effect?.type).toBe("search_persons");
      if (result.effect?.type === "search_persons") {
        expect((result.effect as { type: string; es_menor?: boolean }).es_menor).toBe(true);
      }
    });

    it("respuesta 'no' → efecto search_persons con es_menor=false", () => {
      const result = step(estadoMenor, { kind: "text", text: "no" });
      expect(result.effect).toBeDefined();
      expect(result.effect?.type).toBe("search_persons");
      if (result.effect?.type === "search_persons") {
        expect((result.effect as { type: string; es_menor?: boolean }).es_menor).toBe(false);
      }
    });

    it("respuesta ambigua → re-pide el paso (no avanza)", () => {
      const result = step(estadoMenor, { kind: "text", text: "quizas" });
      expect(result.state).toMatchObject({ flow: "search", step: "menor" });
    });
  });
});
