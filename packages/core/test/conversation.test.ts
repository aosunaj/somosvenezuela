import { describe, expect, it } from "vitest";
import {
  step,
  initialState,
  BUTTON,
  type ConversationInput,
  type ConversationState,
  type Effect,
  type PublicPerson,
  type PublicPet,
  type StepResult,
} from "../src/index.js";

// Pruebas de la maquina de conversacion compartida (T2.1).
// Datos SINTETICOS — sin PII real (guardrails #1, CLAUDE.md).
//
// Estrategia: como `step` es un reducer PURO, encadenamos inputs llevando el
// estado a mano y verificamos estado/replies/effect en cada transicion.

const SYNTH_PERSON_ID = "33333333-3333-4333-8333-333333333333";

/** Helper: aplica una secuencia de inputs partiendo de un estado dado. */
function run(
  start: ConversationState,
  inputs: readonly ConversationInput[],
): StepResult {
  let res: StepResult = { state: start, replies: [] };
  for (const input of inputs) {
    res = step(res.state, input);
  }
  return res;
}

const text = (t: string): ConversationInput => ({ kind: "text", text: t });
const cmd = (c: string): ConversationInput => ({ kind: "command", command: c });

/** Concatena el texto de todas las replies de un resultado. */
function joinReplies(res: StepResult): string {
  return res.replies.map((r) => r.text).join("\n");
}

/** Recorre replies + effect serializados buscando una cadena prohibida. */
function serializeAll(res: StepResult): string {
  return JSON.stringify({ replies: res.replies, effect: res.effect });
}

function synthPublicPerson(
  overrides: Partial<PublicPerson & { score?: number }> = {},
): PublicPerson & { score?: number } {
  return {
    id: SYNTH_PERSON_ID,
    nombre: "Persona Sintetica",
    apellidos: "De Prueba",
    edad: 25,
    zona: "Zona Ficticia",
    descripcion: "Camiseta azul",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const SYNTH_PET_ID = "44444444-4444-4444-8444-444444444444";

function synthPublicPet(
  overrides: Partial<PublicPet & { score?: number }> = {},
): PublicPet & { score?: number } {
  return {
    id: SYNTH_PET_ID,
    nombre: "Firulais",
    tipo: "perro",
    raza: "Mestizo",
    zona: "Zona Ficticia",
    foto_url: null,
    estado: "desaparecida",
    fuente: "propia",
    verificacion: "sin_verificar",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Menu / idle ──────────────────────────────────────────────────────────────

describe("menu / idle", () => {
  it("/start muestra bienvenida con teclado del menu", () => {
    const res = step(initialState, cmd("/start"));
    expect(res.state).toEqual({ flow: "idle" });
    expect(res.replies[0]?.buttons).toBeDefined();
    expect(joinReplies(res)).toContain("Nadie se queda atras");
  });

  it("/ayuda explica las opciones y mantiene idle", () => {
    const res = step(initialState, cmd("/ayuda"));
    expect(res.state).toEqual({ flow: "idle" });
    expect(joinReplies(res)).toContain("Registrar");
  });

  it("texto libre en idle reofrece el menu", () => {
    const res = step(initialState, text("hola que tal"));
    expect(res.state).toEqual({ flow: "idle" });
    expect(res.replies[0]?.buttons).toBeDefined();
  });

  it("el texto del boton 'Registrar' inicia el flujo de registro", () => {
    const res = step(initialState, text(BUTTON.registrar));
    expect(res.state.flow).toBe("register");
  });
});

// ── Flujo registrar COMPLETO ─────────────────────────────────────────────────

describe("flujo registrar (completo hasta el efecto y la respuesta final)", () => {
  it("recoge datos paso a paso, resume, confirma y emite create_person", () => {
    const res = run(initialState, [
      text(BUTTON.registrar),
      text("Maria"), // nombre
      text("Perez Lopez"), // apellidos
      text("34"), // edad
      text("Caracas Centro"), // zona
      text("Vestido rojo, estatura media"), // descripcion
    ]);

    // Tras descripcion: estado en confirm, con resumen.
    expect(res.state.flow).toBe("register");
    expect((res.state as Extract<ConversationState, { flow: "register" }>).step).toBe("confirm");
    expect(joinReplies(res)).toContain("Maria");
    expect(joinReplies(res)).toContain("Caracas Centro");

    // Confirmar emite el efecto create_person, sin respuesta aun.
    const confirmed = step(res.state, text(BUTTON.confirmar));
    expect(confirmed.replies).toHaveLength(0);
    const effect = confirmed.effect as Extract<Effect, { type: "create_person" }>;
    expect(effect.type).toBe("create_person");
    expect(effect.data.nombre).toBe("Maria");
    expect(effect.data.apellidos).toBe("Perez Lopez");
    expect(effect.data.edad).toBe(34);
    expect(effect.data.zona).toBe("Caracas Centro");
    expect(effect.data.fuente).toBe("propia");
    expect((confirmed.state as Extract<ConversationState, { flow: "register" }>).step).toBe("submitting");

    // El adaptador re-inyecta el resultado ok -> respuesta final + idle.
    const done = step(confirmed.state, {
      kind: "effect_result",
      result: { type: "create_person", ok: true },
    });
    expect(done.state).toEqual({ flow: "idle" });
    expect(joinReplies(done)).toContain("Registrado");
  });

  it("permite omitir campos opcionales (apellidos, edad, zona, descripcion)", () => {
    const res = run(initialState, [
      text(BUTTON.registrar),
      text("Jose"), // nombre
      text(BUTTON.omitir), // apellidos
      text(BUTTON.omitir), // edad
      text(BUTTON.omitir), // zona
      text(BUTTON.omitir), // descripcion
      text(BUTTON.confirmar), // confirma
    ]);
    const effect = res.effect as Extract<Effect, { type: "create_person" }>;
    expect(effect.type).toBe("create_person");
    expect(effect.data.nombre).toBe("Jose");
    // Los opcionales omitidos no viajan como dato obligatorio.
    expect(effect.data.apellidos == null).toBe(true);
    expect(effect.data.edad == null).toBe(true);
  });

  it("respuesta final con fallo del efecto re-ofrece confirmar sin perder draft", () => {
    const res = run(initialState, [
      text(BUTTON.registrar),
      text("Ana"),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.confirmar),
    ]);
    const failed = step(res.state, {
      kind: "effect_result",
      result: { type: "create_person", ok: false },
    });
    expect(failed.state.flow).toBe("register");
    expect(joinReplies(failed)).toContain("intentalo");
  });

  it("la respuesta final entrega el id del registro para poder borrarlo luego", () => {
    const res = run(initialState, [
      text(BUTTON.registrar),
      text("Lucia"),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.confirmar),
    ]);
    const done = step(res.state, {
      kind: "effect_result",
      result: { type: "create_person", ok: true, id: SYNTH_PERSON_ID },
    });
    expect(done.state).toEqual({ flow: "idle" });
    const txt = joinReplies(done);
    expect(txt).toContain("Registrado");
    expect(txt).toContain(SYNTH_PERSON_ID);
  });
});

// ── Flujo registrar mascota ──────────────────────────────────────────────────

describe("flujo registrar mascota (completo hasta el efecto y la respuesta final)", () => {
  it("el texto del boton 'Registrar mascota' inicia el flujo en el paso nombre", () => {
    const res = step(initialState, text(BUTTON.registrarMascota));
    expect(res.state.flow).toBe("register_pet");
    expect((res.state as Extract<ConversationState, { flow: "register_pet" }>).step).toBe(
      "nombre",
    );
  });

  it("recoge datos paso a paso, resume, confirma y emite create_pet con id", () => {
    const res = run(initialState, [
      text(BUTTON.registrarMascota),
      text("Firulais"), // nombre
      text("perro"), // tipo
      text("mestizo"), // raza
      text("Caracas Centro"), // zona
    ]);

    // Tras zona: estado en confirm, con resumen de mascota.
    expect(res.state.flow).toBe("register_pet");
    expect((res.state as Extract<ConversationState, { flow: "register_pet" }>).step).toBe(
      "confirm",
    );
    const summary = joinReplies(res);
    expect(summary).toContain("Firulais");
    expect(summary).toContain("perro");
    expect(summary).toContain("Caracas Centro");

    // Confirmar emite el efecto create_pet, sin respuesta aun.
    const confirmed = step(res.state, text(BUTTON.confirmar));
    expect(confirmed.replies).toHaveLength(0);
    const effect = confirmed.effect as Extract<Effect, { type: "create_pet" }>;
    expect(effect.type).toBe("create_pet");
    expect(effect.data.nombre).toBe("Firulais");
    expect(effect.data.tipo).toBe("perro");
    expect(effect.data.raza).toBe("mestizo");
    expect(effect.data.zona).toBe("Caracas Centro");
    expect(effect.data.fuente).toBe("propia");
    expect(
      (confirmed.state as Extract<ConversationState, { flow: "register_pet" }>).step,
    ).toBe("submitting");

    // El adaptador re-inyecta el resultado ok con id -> respuesta final + idle.
    const done = step(confirmed.state, {
      kind: "effect_result",
      result: { type: "create_pet", ok: true, id: SYNTH_PET_ID },
    });
    expect(done.state).toEqual({ flow: "idle" });
    const txt = joinReplies(done);
    expect(txt).toContain("Registrada");
    expect(txt).toContain(SYNTH_PET_ID);
  });

  it("permite omitir todos los campos menos uno y registra igual", () => {
    const res = run(initialState, [
      text(BUTTON.registrarMascota),
      text(BUTTON.omitir), // nombre
      text("gato"), // tipo
      text(BUTTON.omitir), // raza
      text(BUTTON.omitir), // zona
      text(BUTTON.confirmar),
    ]);
    const effect = res.effect as Extract<Effect, { type: "create_pet" }>;
    expect(effect.type).toBe("create_pet");
    expect(effect.data.tipo).toBe("gato");
    expect(effect.data.nombre == null).toBe(true);
    expect(effect.data.raza == null).toBe(true);
  });

  it("una mascota SIN ningun dato no se registra: re-pide desde el nombre", () => {
    const res = run(initialState, [
      text(BUTTON.registrarMascota),
      text(BUTTON.omitir), // nombre
      text(BUTTON.omitir), // tipo
      text(BUTTON.omitir), // raza
      text(BUTTON.omitir), // zona
      text(BUTTON.confirmar), // confirma con todo vacio
    ]);
    // No emite efecto y vuelve al paso nombre con un aviso.
    expect(res.effect).toBeUndefined();
    expect(res.state.flow).toBe("register_pet");
    expect((res.state as Extract<ConversationState, { flow: "register_pet" }>).step).toBe(
      "nombre",
    );
    expect(joinReplies(res)).toContain("al menos un dato");
  });

  it("el comando /registrarmascota tambien inicia el flujo", () => {
    const res = step(initialState, cmd("/registrarmascota"));
    expect(res.state.flow).toBe("register_pet");
  });

  it("respuesta final con fallo del efecto re-ofrece confirmar", () => {
    const res = run(initialState, [
      text(BUTTON.registrarMascota),
      text("Michi"),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.confirmar),
    ]);
    const failed = step(res.state, {
      kind: "effect_result",
      result: { type: "create_pet", ok: false },
    });
    expect(failed.state.flow).toBe("register_pet");
    expect(joinReplies(failed)).toContain("intentalo");
  });

  it("/cancelar en mitad del registro de mascota vuelve a idle", () => {
    const midway = run(initialState, [text(BUTTON.registrarMascota), text("Firulais")]);
    expect(midway.state.flow).toBe("register_pet");
    const cancelled = step(midway.state, cmd("/cancelar"));
    expect(cancelled.state).toEqual({ flow: "idle" });
  });

  it("el efecto create_pet no filtra contacto", () => {
    const res = run(initialState, [
      text(BUTTON.registrarMascota),
      text("Firulais"),
      text("perro"),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.confirmar),
    ]);
    const blob = serializeAll(res);
    expect(blob).not.toContain("contact_id");
    expect(blob).not.toContain("telefono");
    expect(blob).not.toContain("chat_id");
  });
});

// ── Confirmacion robusta: sinonimos naturales + cancelar ─────────────────────

describe("confirmacion robusta (la gente tipea 'si'/'ok'/'no', no la etiqueta)", () => {
  /** Lleva el registro hasta el paso 'confirm' con lo minimo (solo nombre). */
  function untilConfirm(): StepResult {
    return run(initialState, [
      text(BUTTON.registrar),
      text("Carmen"),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
    ]);
  }

  it.each(["si", "sí", "SÍ", "ok", "dale", "confirmo", BUTTON.confirmar])(
    "confirma el registro con '%s' y emite create_person",
    (palabra) => {
      const confirmed = step(untilConfirm().state, text(palabra));
      expect(confirmed.effect).toBeDefined();
      const effect = confirmed.effect as Extract<Effect, { type: "create_person" }>;
      expect(effect.type).toBe("create_person");
      expect(effect.data.nombre).toBe("Carmen");
    },
  );

  it.each(["Cancelar", "cancelar", "no"])(
    "cancela el registro con '%s' y vuelve a idle sin emitir efecto",
    (palabra) => {
      const cancelled = step(untilConfirm().state, text(palabra));
      expect(cancelled.state).toEqual({ flow: "idle" });
      expect(cancelled.effect).toBeUndefined();
    },
  );

  it("una respuesta ambigua re-muestra el resumen (no avanza ni cancela)", () => {
    const ambiguous = step(untilConfirm().state, text("quiza mas tarde"));
    expect(ambiguous.state.flow).toBe("register");
    expect(
      (ambiguous.state as Extract<ConversationState, { flow: "register" }>).step,
    ).toBe("confirm");
    expect(ambiguous.effect).toBeUndefined();
    expect(joinReplies(ambiguous)).toContain("Confirmas");
  });

  it("cancela el borrado en la confirmacion (no emite delete_person)", () => {
    const withId = run(initialState, [text(BUTTON.borrar), text(SYNTH_PERSON_ID)]);
    expect((withId.state as Extract<ConversationState, { flow: "delete" }>).step).toBe(
      "confirm",
    );
    const cancelled = step(withId.state, text("no"));
    expect(cancelled.state).toEqual({ flow: "idle" });
    expect(cancelled.effect).toBeUndefined();
  });
});

// ── Validacion: re-pide sin avanzar ni crashear ──────────────────────────────

describe("validacion de entrada (re-pide, no avanza, no crashea)", () => {
  it("nombre vacio: re-pide y no avanza de paso", () => {
    const afterStart = step(initialState, text(BUTTON.registrar));
    const res = step(afterStart.state, text("   "));
    expect(res.state.flow).toBe("register");
    expect((res.state as Extract<ConversationState, { flow: "register" }>).step).toBe("nombre");
    expect(joinReplies(res)).toContain("nombre");
  });

  it("edad invalida ('abc'): re-pide en el paso edad", () => {
    const res = run(initialState, [
      text(BUTTON.registrar),
      text("Luis"),
      text(BUTTON.omitir), // apellidos
      text("abc"), // edad invalida
    ]);
    expect((res.state as Extract<ConversationState, { flow: "register" }>).step).toBe("edad");
    expect(joinReplies(res)).toContain("edad");
  });

  it("edad fuera de rango (200): re-pide en el paso edad", () => {
    const res = run(initialState, [
      text(BUTTON.registrar),
      text("Luis"),
      text(BUTTON.omitir),
      text("200"),
    ]);
    expect((res.state as Extract<ConversationState, { flow: "register" }>).step).toBe("edad");
  });

  it("edad limite valida (0 y 129) se acepta", () => {
    for (const edad of [0, 129]) {
      const res = run(initialState, [
        text(BUTTON.registrar),
        text("Luis"),
        text(BUTTON.omitir),
        text(String(edad)),
      ]);
      // Avanza a zona.
      expect((res.state as Extract<ConversationState, { flow: "register" }>).step).toBe("zona");
    }
  });
});

// ── Flujo buscar ─────────────────────────────────────────────────────────────

describe("flujo buscar", () => {
  it("query -> emite search_persons -> resultados", () => {
    const started = step(initialState, text(BUTTON.buscar));
    expect(started.state.flow).toBe("search");

    const queried = step(started.state, text("Maria Caracas"));
    expect(queried.replies).toHaveLength(0);
    const effect = queried.effect as Extract<Effect, { type: "search_persons" }>;
    expect(effect.type).toBe("search_persons");
    expect(effect.query).toBe("Maria Caracas");

    const withResults = step(queried.state, {
      kind: "effect_result",
      result: {
        type: "search_persons",
        results: [synthPublicPerson({ score: 0.91 })],
      },
    });
    expect(withResults.state).toEqual({ flow: "idle" });
    const txt = joinReplies(withResults);
    expect(txt).toContain("Persona Sintetica");
    expect(txt).toContain("desaparecida");
    expect(txt).toContain("91%");
  });

  it("cero resultados muestra mensaje claro y vuelve a idle", () => {
    const queried = run(initialState, [text(BUTTON.buscar), text("nadie")]);
    const empty = step(queried.state, {
      kind: "effect_result",
      result: { type: "search_persons", results: [] },
    });
    expect(empty.state).toEqual({ flow: "idle" });
    expect(joinReplies(empty)).toContain("No encontramos");
  });

  it("query vacio re-pide sin emitir efecto", () => {
    const started = step(initialState, text(BUTTON.buscar));
    const res = step(started.state, text("   "));
    expect(res.effect).toBeUndefined();
    expect(res.state.flow).toBe("search");
  });
});

// ── Flujo buscar mascota ─────────────────────────────────────────────────────

describe("flujo buscar mascota", () => {
  it("el texto del boton 'Buscar mascota' inicia el flujo de mascotas", () => {
    const res = step(initialState, text(BUTTON.buscarMascota));
    expect(res.state.flow).toBe("search_pets");
    expect((res.state as Extract<ConversationState, { flow: "search_pets" }>).step).toBe("query");
  });

  it("el comando /mascota tambien inicia el flujo de mascotas", () => {
    const res = step(initialState, cmd("/mascota"));
    expect(res.state.flow).toBe("search_pets");
  });

  it("query -> emite search_pets -> resultados", () => {
    const started = step(initialState, text(BUTTON.buscarMascota));
    expect(started.state.flow).toBe("search_pets");

    const queried = step(started.state, text("Firulais perro"));
    expect(queried.replies).toHaveLength(0);
    const effect = queried.effect as Extract<Effect, { type: "search_pets" }>;
    expect(effect.type).toBe("search_pets");
    expect(effect.query).toBe("Firulais perro");
    expect((queried.state as Extract<ConversationState, { flow: "search_pets" }>).step).toBe(
      "searching",
    );

    const withResults = step(queried.state, {
      kind: "effect_result",
      result: {
        type: "search_pets",
        results: [synthPublicPet({ score: 0.88 })],
      },
    });
    expect(withResults.state).toEqual({ flow: "idle" });
    const txt = joinReplies(withResults);
    expect(txt).toContain("Firulais");
    expect(txt).toContain("perro");
    expect(txt).toContain("88%");
  });

  it("cero resultados muestra mensaje claro y vuelve a idle", () => {
    const queried = run(initialState, [text(BUTTON.buscarMascota), text("ninguna")]);
    const empty = step(queried.state, {
      kind: "effect_result",
      result: { type: "search_pets", results: [] },
    });
    expect(empty.state).toEqual({ flow: "idle" });
    expect(joinReplies(empty)).toContain("No encontramos");
  });

  it("query vacio re-pide sin emitir efecto", () => {
    const started = step(initialState, text(BUTTON.buscarMascota));
    const res = step(started.state, text("   "));
    expect(res.effect).toBeUndefined();
    expect(res.state.flow).toBe("search_pets");
  });

  it("/ayuda interrumpe el flujo y vuelve a idle con el menu", () => {
    const started = step(initialState, text(BUTTON.buscarMascota));
    const helped = step(started.state, cmd("/ayuda"));
    expect(helped.state).toEqual({ flow: "idle" });
    expect(joinReplies(helped)).toContain("mascota");
  });

  it("el efecto search_pets no filtra contacto", () => {
    const res = run(initialState, [text(BUTTON.buscarMascota), text("alguna")]);
    const blob = serializeAll(res);
    expect(blob).not.toContain("contact_id");
    expect(blob).not.toContain("chat_id");
  });
});

// ── Flujo borrar ─────────────────────────────────────────────────────────────

describe("flujo borrar", () => {
  it("id valido -> confirma -> emite delete_person -> ok", () => {
    const started = step(initialState, text(BUTTON.borrar));
    expect(started.state.flow).toBe("delete");

    const withId = step(started.state, text(SYNTH_PERSON_ID));
    expect((withId.state as Extract<ConversationState, { flow: "delete" }>).step).toBe("confirm");
    expect(joinReplies(withId)).toContain(SYNTH_PERSON_ID);

    const confirmed = step(withId.state, text(BUTTON.confirmar));
    expect(confirmed.replies).toHaveLength(0);
    const effect = confirmed.effect as Extract<Effect, { type: "delete_person" }>;
    expect(effect.type).toBe("delete_person");
    expect(effect.personId).toBe(SYNTH_PERSON_ID);

    const done = step(confirmed.state, {
      kind: "effect_result",
      result: { type: "delete_person", ok: true },
    });
    expect(done.state).toEqual({ flow: "idle" });
    expect(joinReplies(done)).toContain("borrado");
  });

  it("id con formato invalido re-pide sin avanzar", () => {
    const started = step(initialState, text(BUTTON.borrar));
    const res = step(started.state, text("no-es-un-uuid"));
    expect((res.state as Extract<ConversationState, { flow: "delete" }>).step).toBe("id");
    expect(res.effect).toBeUndefined();
  });
});

// ── /cancelar en mitad de un flujo ───────────────────────────────────────────

describe("/cancelar vuelve a idle limpiando el draft", () => {
  it("cancela en mitad del registro", () => {
    const midway = run(initialState, [
      text(BUTTON.registrar),
      text("Pedro"),
      text("Gomez"),
    ]);
    expect(midway.state.flow).toBe("register");

    const cancelled = step(midway.state, cmd("/cancelar"));
    expect(cancelled.state).toEqual({ flow: "idle" });
    expect(cancelled.replies[0]?.buttons).toBeDefined();
  });

  it("cancela en mitad de buscar y de borrar", () => {
    const search = run(initialState, [text(BUTTON.buscar)]);
    expect(step(search.state, cmd("/cancelar")).state).toEqual({ flow: "idle" });

    const del = run(initialState, [text(BUTTON.borrar), text(SYNTH_PERSON_ID)]);
    expect(step(del.state, cmd("/cancelar")).state).toEqual({ flow: "idle" });
  });

  it("cancela en mitad de buscar mascota", () => {
    const pets = run(initialState, [text(BUTTON.buscarMascota)]);
    expect(pets.state.flow).toBe("search_pets");
    const cancelled = step(pets.state, cmd("/cancelar"));
    expect(cancelled.state).toEqual({ flow: "idle" });
    expect(cancelled.replies[0]?.buttons).toBeDefined();
  });
});

// ── Contrato de privacidad ───────────────────────────────────────────────────

describe("contrato de privacidad: ninguna Reply ni Effect filtra contacto", () => {
  const FORBIDDEN_CONTACT_ID = "99999999-9999-4999-8999-999999999999";
  // Telefono sintetico SIN formato venezolano real: prueba el filtrado de contacto
  // sin disparar el escaner de guardrails (que prohibe telefonos +58... versionados).
  const FORBIDDEN_PHONE = "000-000-0000";

  it("el efecto create_person no contiene contact_id ni telefono", () => {
    const res = run(initialState, [
      text(BUTTON.registrar),
      text("Carmen"),
      text("Rivas"),
      text("40"),
      text("Maracay"),
      text("Chaqueta verde"),
      text(BUTTON.confirmar),
    ]);
    const blob = serializeAll(res);
    expect(blob).not.toContain("contact_id");
    expect(blob).not.toContain("telefono");
    expect(blob).not.toContain("chat_id");
  });

  it("el efecto search_persons no incluye zona/contacto sensibles inesperados", () => {
    const res = run(initialState, [text(BUTTON.buscar), text("alguien")]);
    const blob = serializeAll(res);
    expect(blob).not.toContain("contact_id");
    expect(blob).not.toContain("chat_id");
  });

  it("los resultados mostrados nunca incluyen contact_id aunque el adaptador lo cuele", () => {
    // Aunque un resultado trajera contacto, la vista publica ya lo excluye; aqui
    // verificamos que la maquina solo renderiza los campos publicos esperados.
    const queried = run(initialState, [text(BUTTON.buscar), text("alguien")]);
    const withResults = step(queried.state, {
      kind: "effect_result",
      result: {
        type: "search_persons",
        // Inyectamos un objeto contaminado para asegurar que el render no lo expone.
        results: [
          {
            ...synthPublicPerson(),
            // @ts-expect-error contaminacion deliberada para el test de privacidad
            contact_id: FORBIDDEN_CONTACT_ID,
            // @ts-expect-error contaminacion deliberada para el test de privacidad
            telefono: FORBIDDEN_PHONE,
          },
        ],
      },
    });
    const blob = serializeAll(withResults);
    expect(blob).not.toContain(FORBIDDEN_CONTACT_ID);
    expect(blob).not.toContain(FORBIDDEN_PHONE);
  });
});
