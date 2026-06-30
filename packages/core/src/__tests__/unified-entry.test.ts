import { describe, expect, it } from "vitest";
import {
  stepUnifiedEntry,
  initialUnifiedEntryState,
  type UnifiedEntryState,
  type UnifiedEntryInput,
  type UnifiedEntryResult,
  type UnifiedEntryDomain,
} from "../unified-entry.js";

// Tests TDD para el flujo unificado buscar/registrar (Slice U, spec-delta nucleo-ux).
// Datos sinteticos — sin PII real. Guardrail #1: ningun resultado contiene PII del registrante.

// Candidato sintetico para test (sin contact_id — vista publica).
const SYNTH_CANDIDATE = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  nombre: "Carlos",
  apellidos: "Perez",
  edad: 40,
  zona: "Caracas",
  descripcion: "Cabello canoso",
  foto_url: null,
  estado: "desaparecida" as const,
  fuente: "propia" as const,
  verificacion: "sin_verificar" as const,
  created_at: "2026-01-01T00:00:00.000Z",
  score: 0.9,
};

function text(t: string): UnifiedEntryInput {
  return { kind: "text", text: t };
}

function searchResult(
  results: typeof SYNTH_CANDIDATE[],
): UnifiedEntryInput {
  return {
    kind: "effect_result",
    result: { type: "search_result", results },
  };
}

function subscribeResult(ok: boolean): UnifiedEntryInput {
  return {
    kind: "effect_result",
    result: { type: "subscribe_to_case", ok },
  };
}

describe("initialUnifiedEntryState", () => {
  it("debe tener flow unified_entry, step collecting, draft vacio, domain person", () => {
    const state = initialUnifiedEntryState("person");
    expect(state.flow).toBe("unified_entry");
    expect(state.step).toBe("collecting");
    expect(state.domain).toBe("person");
    expect(state.draft).toEqual({});
  });

  it("debe aceptar domain pet", () => {
    const state = initialUnifiedEntryState("pet");
    expect(state.domain).toBe("pet");
  });
});

describe("stepUnifiedEntry — collecting", () => {
  it("con texto libre, pasa a searching y emite efecto search_unified inmediato", () => {
    const state = initialUnifiedEntryState("person");
    const result = stepUnifiedEntry(state, text("Maria Lopez"));
    // El bot busca inmediatamente al recibir el primer dato (UX emergencia)
    expect(result.state.step).toBe("searching");
    expect(result.effect?.type).toBe("search_unified");
    const eff = result.effect as { type: "search_unified"; query: string };
    expect(eff.query).toContain("Maria");
  });

  it("cuando el usuario provee buscar con draft acumulado, emite efecto search", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "collecting",
      draft: { rawInput: "Maria Lopez 40 anos Caracas" },
    };
    const result = stepUnifiedEntry(state, text("buscar"));
    expect(result.effect).toBeDefined();
    expect(result.effect?.type).toBe("search_unified");
    expect((result.effect as { type: "search_unified"; query: string }).query).toContain("Maria");
  });

  it("con draft vacio, sin texto, informa que se necesita al menos un dato", () => {
    const state = initialUnifiedEntryState("person");
    const result = stepUnifiedEntry(state, text(""));
    expect(result.state.step).toBe("collecting");
    expect(result.replies.length).toBeGreaterThan(0);
    expect(result.replies[0]!.text).toMatch(/al menos un dato|necesitamos un dato/i);
  });

  it("buscar explícito con draft acumulado emite search_unified", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "collecting",
      draft: { rawInput: "Carlos 40" },
    };
    // Simula que el usuario quiere buscar ahora
    const result = stepUnifiedEntry(state, text("buscar"));
    expect(result.effect?.type).toBe("search_unified");
  });
});

describe("stepUnifiedEntry — searching (esperando resultado de busqueda)", () => {
  it("ignora texto mientras espera el resultado de busqueda", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "searching",
      draft: { rawInput: "Carlos" },
    };
    const result = stepUnifiedEntry(state, text("hola"));
    expect(result.state.step).toBe("searching");
    expect(result.replies).toHaveLength(0);
  });

  it("con resultados, pasa a confirming con el primer candidato", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "searching",
      draft: { rawInput: "Carlos" },
    };
    const result = stepUnifiedEntry(state, searchResult([SYNTH_CANDIDATE]));
    expect(result.state.step).toBe("confirming");
    expect(result.replies.length).toBeGreaterThan(0);
    // El reply debe mostrar un resumen SIN PII del registrante (guardrail #1)
    const replyText = result.replies[0]!.text;
    expect(replyText).not.toMatch(/\d{10,}/); // no numeros de telefono
    // Debe preguntar si es la misma persona
    expect(replyText).toMatch(/misma persona|es la misma|mismo/i);
  });

  it("sin resultados, ofrece registrar el caso nuevo", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "searching",
      draft: { rawInput: "Carlos" },
    };
    const result = stepUnifiedEntry(state, searchResult([]));
    expect(result.state.step).toBe("no_match");
    expect(result.replies[0]!.text).toMatch(/no encontramos|registrar|coincidencia/i);
  });

  it("con resultados de mascota, pasa a confirming con candidato mascota", () => {
    const petCandidate = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      nombre: "Firulais",
      tipo: "perro",
      raza: "labrador",
      zona: "Valencia",
      foto_url: null,
      estado: "desaparecida" as const,
      fuente: "propia" as const,
      verificacion: "sin_verificar" as const,
      created_at: "2026-01-01T00:00:00.000Z",
      score: 0.88,
    };
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "pet",
      step: "searching",
      draft: { rawInput: "Firulais perro" },
    };
    const result = stepUnifiedEntry(state, {
      kind: "effect_result",
      result: { type: "search_result", results: [petCandidate as unknown as typeof SYNTH_CANDIDATE] },
    });
    expect(result.state.step).toBe("confirming");
    expect(result.replies[0]!.text).toMatch(/misma mascota|mismo|mascota/i);
  });
});

describe("stepUnifiedEntry — confirming (¿es la misma persona?)", () => {
  const confirmingState: UnifiedEntryState = {
    flow: "unified_entry",
    domain: "person",
    step: "confirming",
    draft: { rawInput: "Carlos" },
    candidates: [SYNTH_CANDIDATE],
  };

  it("si el usuario dice SI, emite efecto subscribe_to_case (dedup B-1: sin conexion)", () => {
    const result = stepUnifiedEntry(confirmingState, text("si"));
    expect(result.effect).toBeDefined();
    expect(result.effect?.type).toBe("subscribe_to_case");
    const eff = result.effect as { type: "subscribe_to_case"; caseId: string };
    expect(eff.caseId).toBe(SYNTH_CANDIDATE.id);
  });

  it("si el usuario dice NO, ofrece registrar como caso nuevo", () => {
    const result = stepUnifiedEntry(confirmingState, text("no"));
    expect(result.state.step).toBe("no_match");
    expect(result.replies[0]!.text).toMatch(/registrar|nuevo|caso/i);
  });

  it("si el usuario dice algo no reconocido, re-pregunta sin avanzar", () => {
    const result = stepUnifiedEntry(confirmingState, text("quizas"));
    expect(result.state.step).toBe("confirming");
    expect(result.replies.length).toBeGreaterThan(0);
    expect(result.replies[0]!.text).toMatch(/misma|confirma|si o no/i);
  });

  it("guardrail: el prompt de confirmacion NO debe contener el contacto del registrante", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "searching",
      draft: { rawInput: "Carlos" },
    };
    const result = stepUnifiedEntry(state, searchResult([SYNTH_CANDIDATE]));
    const replyText = result.replies.map((r) => r.text).join(" ");
    // No debe contener numeros de telefono de 10+ digitos
    expect(replyText).not.toMatch(/\d{10,}/);
    // No debe decir "contact_id" ni "channel_id"
    expect(replyText).not.toMatch(/contact_id|channel_id/i);
  });
});

describe("stepUnifiedEntry — resultado de subscribe_to_case (B-1 dedup)", () => {
  it("subscribe exitoso: confirma suscripcion y vuelve al inicio (sin abrir conexion entre buscadores)", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "subscribing",
      draft: { rawInput: "Carlos" },
      candidates: [SYNTH_CANDIDATE],
    };
    const result = stepUnifiedEntry(state, subscribeResult(true));
    // Vuelve a idle
    expect(result.state.flow).toBe("idle");
    // Mensaje de confirmacion sin mencionar conexion directa
    expect(result.replies[0]!.text).toMatch(/te avisaremos|aviso|suscripto|seguimiento/i);
    // Guardrail B-1: NO debe decir que conecta con otro buscador
    expect(result.replies[0]!.text).not.toMatch(/otro buscador|contacto del buscador/i);
  });

  it("subscribe fallido: informa fallo y vuelve al inicio", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "subscribing",
      draft: { rawInput: "Carlos" },
      candidates: [SYNTH_CANDIDATE],
    };
    const result = stepUnifiedEntry(state, subscribeResult(false));
    expect(result.state.flow).toBe("idle");
    expect(result.replies[0]!.text).toMatch(/no pudimos|error|intentalo/i);
  });
});

describe("stepUnifiedEntry — no_match (ofrecer registro)", () => {
  it("cuando el usuario confirma registrar, emite efecto de inicio de registro", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "no_match",
      draft: { rawInput: "Carlos Perez 40" },
    };
    const result = stepUnifiedEntry(state, text("si"));
    // Debe ofrecer el registro (emite efecto o pasa a estado de registro)
    const goesToRegister =
      result.state.flow === "register" ||
      result.state.flow === "register_pet" ||
      (result.effect !== undefined && result.effect.type === "start_register");
    expect(goesToRegister).toBe(true);
  });

  it("cuando el usuario cancela, vuelve al inicio", () => {
    const state: UnifiedEntryState = {
      flow: "unified_entry",
      domain: "person",
      step: "no_match",
      draft: { rawInput: "Carlos" },
    };
    const result = stepUnifiedEntry(state, text("no"));
    expect(result.state.flow).toBe("idle");
  });
});

describe("paridad mascotas (Slice P)", () => {
  it("el flujo de mascota sigue las mismas reglas de busqueda/dedup que persona", () => {
    const state = initialUnifiedEntryState("pet");
    // Con texto libre, el bot busca inmediatamente y emite search_unified con domain=pet
    const withInput = stepUnifiedEntry(state, text("Firulais perro labrador"));
    expect(withInput.effect?.type).toBe("search_unified");
    const eff = withInput.effect as { type: "search_unified"; domain: UnifiedEntryDomain };
    expect(eff.domain).toBe("pet");
    expect(eff.query).toContain("Firulais");
  });

  it("auto-match de mascota NUNCA emite efecto de conexion automatica (guardrail Slice P)", () => {
    // Este test verifica que el flujo unificado para mascotas nunca abre el camino auto
    const state = initialUnifiedEntryState("pet");
    const withInput = stepUnifiedEntry(state, text("Firulais labrador"));
    const searching = stepUnifiedEntry(withInput.state as UnifiedEntryState, text("buscar"));
    // El efecto debe ser search_unified (busqueda), no consent/auto-connect
    if (searching.effect) {
      expect(searching.effect.type).not.toBe("open_consent");
      expect(searching.effect.type).not.toBe("auto_connect");
    }
  });
});
