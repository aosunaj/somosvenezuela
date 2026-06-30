import { describe, expect, it } from "vitest";
import {
  step,
  initialState,
  BUTTON,
  type ConversationInput,
  type ConversationState,
  type Effect,
  type OwnedPerson,
  type PublicNeed,
  type PublicPerson,
  type PublicPet,
  type PublicZone,
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

/**
 * Secuencia de inputs que recorre la BUSQUEDA GUIADA con solo el nombre `query`
 * (apellidos, edad, zona y senas omitidos), dejando el ultimo paso listo para
 * disparar el efecto `search_persons`. Espeja el atajo de los tests de adaptador.
 */
function searchByName(query: string): ConversationInput[] {
  return [
    text(BUTTON.buscar), // inicia el flujo de busqueda guiada
    text(query), // nombre
    text(BUTTON.omitir), // apellidos
    text(BUTTON.omitir), // edad
    text(BUTTON.omitir), // zona
    text(BUTTON.omitir), // senas
    text("no"), // menor → adulto (paso explícito R2-4a, no omitible)
  ];
}

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

/** Registro propio del dueno (vista para marcar/borrar por lista, sin contacto). */
function synthOwnedPerson(overrides: Partial<OwnedPerson> = {}): OwnedPerson {
  return {
    id: SYNTH_PERSON_ID,
    nombre: "Persona Sintetica",
    apellidos: "De Prueba",
    zona: "Zona Ficticia",
    estado: "desaparecida",
    ...overrides,
  };
}

/** Re-inyecta la lista de MIS registros (resultado del efecto list_my_persons). */
const listMine = (persons: readonly OwnedPerson[]): ConversationInput => ({
  kind: "effect_result",
  result: { type: "list_my_persons", persons },
});

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

const SYNTH_ZONE_ID = "55555555-5555-4555-8555-555555555555";

function synthPublicZone(overrides: Partial<PublicZone> = {}): PublicZone {
  return {
    id: SYNTH_ZONE_ID,
    nombre: "Plaza Ficticia",
    lat: null,
    lng: null,
    estado: "activa",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const SYNTH_NEED_ID = "66666666-6666-4666-8666-666666666666";

function synthPublicNeed(overrides: Partial<PublicNeed> = {}): PublicNeed {
  return {
    id: SYNTH_NEED_ID,
    zone_id: SYNTH_ZONE_ID,
    tipo: "agua",
    urgencia: "media",
    descripcion: "Falta agua potable",
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

  it.each([
    ["/registrar", "register"],
    ["/buscar", "search"],
    ["/buscar_mascota", "search_pets"],
    ["/registrar_mascota", "register_pet"],
    ["/borrar", "delete"],
    ["/rescatado", "mark_found"],
    ["/rescatada", "mark_found"],
    ["/zonas", "browse_zones"],
    ["/necesidades", "browse_needs"],
  ])("el comando %s inicia el flujo %s (alias BotFather)", (command, flow) => {
    const res = step(initialState, cmd(command));
    expect(res.state.flow).toBe(flow);
  });

  it("el texto del boton 'Marcar como encontrada' inicia el flujo rescatado", () => {
    const res = step(initialState, text(BUTTON.rescatado));
    expect(res.state.flow).toBe("mark_found");
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

  it("fallo del backend vuelve a 'confirm' con botones vivos y permite REINTENTAR sin perder el draft", () => {
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
    // Tras el fallo NO queda en 'submitting' (botones muertos): vuelve a 'confirm'.
    expect(failed.state.flow).toBe("register");
    expect((failed.state as Extract<ConversationState, { flow: "register" }>).step).toBe(
      "confirm",
    );
    expect(joinReplies(failed)).toContain("intentalo");
    // Ofrece de nuevo los botones Confirmar/Cancelar para reintentar.
    expect(failed.replies.at(-1)?.buttons?.flat()).toContain(BUTTON.confirmar);

    // Reintentar (Confirmar) vuelve a emitir create_person con los MISMOS datos.
    const retried = step(failed.state, text(BUTTON.confirmar));
    expect(retried.replies).toHaveLength(0);
    const effect = retried.effect as Extract<Effect, { type: "create_person" }>;
    expect(effect.type).toBe("create_person");
    expect(effect.data.nombre).toBe("Ana");
    expect((retried.state as Extract<ConversationState, { flow: "register" }>).step).toBe(
      "submitting",
    );

    // Tras un segundo intento OK, el registro se completa con normalidad.
    const done = step(retried.state, {
      kind: "effect_result",
      result: { type: "create_person", ok: true, id: SYNTH_PERSON_ID },
    });
    expect(done.state).toEqual({ flow: "idle" });
    expect(joinReplies(done)).toContain("Registrado");
  });

  it("tras un fallo del backend, Cancelar tambien funciona (no queda atascada)", () => {
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
    const cancelled = step(failed.state, text(BUTTON.cancelar));
    expect(cancelled.state).toEqual({ flow: "idle" });
    expect(cancelled.effect).toBeUndefined();
  });

  it("resultado INESPERADO en submitting vuelve a 'confirm' y permite reintentar", () => {
    // En submitting llega un effect_result de OTRO tipo (desajuste del adaptador):
    // antes mantenia 'submitting' con botones muertos; ahora vuelve a 'confirm'.
    const res = run(initialState, [
      text(BUTTON.registrar),
      text("Ana"),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.confirmar),
    ]);
    expect((res.state as Extract<ConversationState, { flow: "register" }>).step).toBe(
      "submitting",
    );
    const unexpected = step(res.state, {
      kind: "effect_result",
      result: { type: "delete_person", ok: true },
    });
    // Vuelve a 'confirm' con el resumen y botones vivos (no queda atascada).
    expect(unexpected.state.flow).toBe("register");
    expect((unexpected.state as Extract<ConversationState, { flow: "register" }>).step).toBe(
      "confirm",
    );
    expect(joinReplies(unexpected)).toContain("Confirmas");
    expect(unexpected.replies.at(-1)?.buttons?.flat()).toContain(BUTTON.confirmar);

    // Reintentar (Confirmar) vuelve a emitir create_person con los MISMOS datos.
    const retried = step(unexpected.state, text(BUTTON.confirmar));
    const effect = retried.effect as Extract<Effect, { type: "create_person" }>;
    expect(effect.type).toBe("create_person");
    expect(effect.data.nombre).toBe("Ana");
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

  it("fallo del backend vuelve a 'confirm' con botones vivos y permite REINTENTAR sin perder el draft", () => {
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
    // Tras el fallo NO queda en 'submitting' (botones muertos): vuelve a 'confirm'.
    expect(failed.state.flow).toBe("register_pet");
    expect((failed.state as Extract<ConversationState, { flow: "register_pet" }>).step).toBe(
      "confirm",
    );
    expect(joinReplies(failed)).toContain("intentalo");
    expect(failed.replies.at(-1)?.buttons?.flat()).toContain(BUTTON.confirmar);

    // Reintentar (Confirmar) vuelve a emitir create_pet con los MISMOS datos.
    const retried = step(failed.state, text(BUTTON.confirmar));
    expect(retried.replies).toHaveLength(0);
    const effect = retried.effect as Extract<Effect, { type: "create_pet" }>;
    expect(effect.type).toBe("create_pet");
    expect(effect.data.nombre).toBe("Michi");
    expect(
      (retried.state as Extract<ConversationState, { flow: "register_pet" }>).step,
    ).toBe("submitting");

    // Tras un segundo intento OK, el registro de mascota se completa con normalidad.
    const done = step(retried.state, {
      kind: "effect_result",
      result: { type: "create_pet", ok: true, id: SYNTH_PET_ID },
    });
    expect(done.state).toEqual({ flow: "idle" });
    expect(joinReplies(done)).toContain("Registrada");
  });

  it("resultado INESPERADO en submitting vuelve a 'confirm' y permite reintentar", () => {
    // En submitting llega un effect_result de OTRO tipo (desajuste del adaptador):
    // antes mantenia 'submitting' con botones muertos; ahora vuelve a 'confirm'.
    const res = run(initialState, [
      text(BUTTON.registrarMascota),
      text("Michi"),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.omitir),
      text(BUTTON.confirmar),
    ]);
    expect(
      (res.state as Extract<ConversationState, { flow: "register_pet" }>).step,
    ).toBe("submitting");
    const unexpected = step(res.state, {
      kind: "effect_result",
      result: { type: "delete_person", ok: true },
    });
    // Vuelve a 'confirm' con el resumen y botones vivos (no queda atascada).
    expect(unexpected.state.flow).toBe("register_pet");
    expect(
      (unexpected.state as Extract<ConversationState, { flow: "register_pet" }>).step,
    ).toBe("confirm");
    expect(joinReplies(unexpected)).toContain("Michi");
    expect(unexpected.replies.at(-1)?.buttons?.flat()).toContain(BUTTON.confirmar);

    // Reintentar (Confirmar) vuelve a emitir create_pet con los MISMOS datos.
    const retried = step(unexpected.state, text(BUTTON.confirmar));
    const effect = retried.effect as Extract<Effect, { type: "create_pet" }>;
    expect(effect.type).toBe("create_pet");
    expect(effect.data.nombre).toBe("Michi");
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
    const started = step(initialState, text(BUTTON.borrar));
    const listed = step(started.state, listMine([synthOwnedPerson()]));
    const chosen = step(listed.state, text("1"));
    expect((chosen.state as Extract<ConversationState, { flow: "delete" }>).step).toBe(
      "confirm",
    );
    const cancelled = step(chosen.state, text("no"));
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

describe("flujo buscar guiado", () => {
  it("arranca pidiendo el nombre con boton Omitir (espeja registrar)", () => {
    const started = step(initialState, text(BUTTON.buscar));
    expect(started.state.flow).toBe("search");
    const state = started.state as Extract<ConversationState, { flow: "search" }>;
    expect(state.step).toBe("nombre");
    // El prompt ofrece Omitir desde el primer paso (todo es salteable).
    const buttons = JSON.stringify(started.replies[0]?.buttons);
    expect(buttons).toContain(BUTTON.omitir);
  });

  it("recorre nombre -> apellidos -> edad -> zona -> senas -> menor y dispara search_persons", () => {
    // nombre + apellidos => query unida; zona y senas => campos estructurados.
    const res = run(initialState, [
      text(BUTTON.buscar),
      text("Maria"), // nombre
      text("Perez"), // apellidos
      text(BUTTON.omitir), // edad (no la usa el matcher hoy)
      text("Caracas"), // zona
      text("vestido rojo"), // senas
      text("no"), // menor → adulto (paso explícito R2-4a)
    ]);
    expect(res.replies).toHaveLength(0);
    const effect = res.effect as Extract<Effect, { type: "search_persons" }>;
    expect(effect.type).toBe("search_persons");
    // El nombre buscado = nombre + apellidos juntos (asi lo puntua el matcher).
    expect(effect.query).toBe("Maria Perez");
    // Zona y senas viajan como campos estructurados ponderados del matcher.
    expect(effect.zona).toBe("Caracas");
    expect(effect.descripcion).toBe("vestido rojo");
    // es_menor=false porque se respondió "no" explícitamente (R2-4a).
    expect(effect.es_menor).toBe(false);
    expect((res.state as Extract<ConversationState, { flow: "search" }>).step).toBe(
      "searching",
    );
    // El efecto NO transporta contacto (guardrail #1).
    expect(serializeAll(res)).not.toContain("contact");
    expect(serializeAll(res)).not.toContain("telefono");
  });

  it("la edad se recoge pero NO viaja en el efecto (el matcher no la pondera hoy)", () => {
    const res = run(initialState, [
      text(BUTTON.buscar),
      text("Luis"),
      text(BUTTON.omitir), // apellidos
      text("40"), // edad valida
      text(BUTTON.omitir), // zona
      text(BUTTON.omitir), // senas
      text("no"), // menor (paso explícito R2-4a)
    ]);
    const effect = res.effect as Extract<Effect, { type: "search_persons" }>;
    expect(effect.query).toBe("Luis");
    // La edad recolectada no se serializa en el efecto (sin romper: futuro uso).
    expect(serializeAll(res)).not.toContain("edad");
    expect(serializeAll(res)).not.toContain("40");
  });

  it("buscar con un solo dato (resto omitido) tambien dispara la busqueda", () => {
    const res = run(initialState, searchByName("Maria"));
    const effect = res.effect as Extract<Effect, { type: "search_persons" }>;
    expect(effect.type).toBe("search_persons");
    expect(effect.query).toBe("Maria");
    expect(effect.zona).toBeUndefined();
    expect(effect.descripcion).toBeUndefined();
    // es_menor viene del paso explícito (default "no" en searchByName).
    expect(effect.es_menor).toBe(false);
  });

  it("buscar con solo la zona (nombre omitido) tambien dispara la busqueda", () => {
    const res = run(initialState, [
      text(BUTTON.buscar),
      text(BUTTON.omitir), // nombre
      text(BUTTON.omitir), // apellidos
      text(BUTTON.omitir), // edad
      text("Maracaibo"), // zona
      text(BUTTON.omitir), // senas
      text("no"), // menor (paso explícito R2-4a)
    ]);
    const effect = res.effect as Extract<Effect, { type: "search_persons" }>;
    expect(effect.type).toBe("search_persons");
    // Sin nombre la query queda vacia; el adaptador igual envia la zona estructurada.
    expect(effect.query).toBe("");
    expect(effect.zona).toBe("Maracaibo");
  });

  it("omitir TODO no busca con vacio: pide al menos un dato y reinicia en nombre", () => {
    const res = run(initialState, [
      text(BUTTON.buscar),
      text(BUTTON.omitir), // nombre
      text(BUTTON.omitir), // apellidos
      text(BUTTON.omitir), // edad
      text(BUTTON.omitir), // zona
      text(BUTTON.omitir), // senas -> todo vacio
    ]);
    // No se emite efecto: no buscamos con vacio.
    expect(res.effect).toBeUndefined();
    expect(joinReplies(res)).toContain("al menos un dato");
    // Reinicia la recoleccion desde el nombre (sin perder el flujo).
    const state = res.state as Extract<ConversationState, { flow: "search" }>;
    expect(state.flow).toBe("search");
    expect(state.step).toBe("nombre");
  });

  it("edad invalida re-pide el mismo paso con Omitir (no avanza)", () => {
    const res = run(initialState, [
      text(BUTTON.buscar),
      text("Ana"),
      text(BUTTON.omitir), // apellidos
      text("doscientos"), // edad invalida
    ]);
    expect(res.effect).toBeUndefined();
    const state = res.state as Extract<ConversationState, { flow: "search" }>;
    expect(state.step).toBe("edad");
    expect(joinReplies(res).toLowerCase()).toContain("edad");
  });

  it("resultados -> ofrece conectar (choosing) guardando los ids publicos", () => {
    const queried = run(initialState, searchByName("Maria"));
    const withResults = step(queried.state, {
      kind: "effect_result",
      result: {
        type: "search_persons",
        results: [synthPublicPerson({ score: 0.91 })],
      },
    });
    const state = withResults.state as Extract<ConversationState, { flow: "search" }>;
    expect(state.flow).toBe("search");
    expect(state.step).toBe("choosing");
    expect(state.candidates).toEqual([SYNTH_PERSON_ID]);
    const txt = joinReplies(withResults);
    expect(txt).toContain("Persona Sintetica");
    expect(txt).toContain("desaparecida");
    // Presentacion honesta: posible coincidencia + parecido ponderado (no certeza).
    expect(txt).toContain("posible coincidencia");
    expect(txt).toContain("91%");
    // El prompt de conexion invita a TOCAR un boton, sin exponer contacto.
    expect(txt.toLowerCase()).toContain("toca");
    // Hay teclado: un boton por coincidencia (aqui "1") + salida explicita.
    const buttons = withResults.replies.at(-1)?.buttons?.flat() ?? [];
    expect(buttons).toContain("1");
    expect(buttons).toContain(BUTTON.noConectar);
    expect(serializeAll(withResults)).not.toContain("contact_id");
    expect(serializeAll(withResults)).not.toContain("telefono");
  });

  it("cero resultados muestra mensaje claro y vuelve a idle (sin conectar)", () => {
    const queried = run(initialState, searchByName("nadie"));
    const empty = step(queried.state, {
      kind: "effect_result",
      result: { type: "search_persons", results: [] },
    });
    expect(empty.state).toEqual({ flow: "idle" });
    expect(joinReplies(empty)).toContain("No encontramos");
  });
});

// ── Flujo reencuentro: el buscador elige a quien conectar ─────────────────────

describe("flujo reencuentro (buscador elige)", () => {
  /** Lleva la conversacion hasta el paso 'choosing' con un resultado. */
  function untilChoosing(): StepResult {
    const queried = run(initialState, searchByName("Maria"));
    return step(queried.state, {
      kind: "effect_result",
      result: { type: "search_persons", results: [synthPublicPerson({ score: 0.9 })] },
    });
  }

  it("elegir un numero valido emite request_reunion con el id publico (sin contacto)", () => {
    const choosing = untilChoosing();
    const chosen = step(choosing.state, text("1"));
    const effect = chosen.effect as Extract<Effect, { type: "request_reunion" }>;
    expect(effect?.type).toBe("request_reunion");
    expect(effect.personId).toBe(SYNTH_PERSON_ID);
    expect((chosen.state as Extract<ConversationState, { flow: "search" }>).step).toBe(
      "requesting",
    );
    // El efecto NO transporta dato de contacto (guardrail #1).
    expect(serializeAll(chosen)).not.toContain("contact");
    expect(serializeAll(chosen)).not.toContain("telefono");
  });

  it("numero fuera de rango re-pide sin expulsar (no emite request_reunion)", () => {
    const choosing = untilChoosing();
    const out = step(choosing.state, text("5"));
    expect(out.effect).toBeUndefined();
    // Se queda en 'choosing' y re-pide con botones (antes expulsaba en silencio).
    expect((out.state as Extract<ConversationState, { flow: "search" }>).step).toBe("choosing");
    expect(joinReplies(out).toLowerCase()).toContain("no entendi");
    expect(out.replies.at(-1)?.buttons?.flat()).toContain("1");
  });

  it("texto no numerico re-pide sin expulsar (antes el telefono te echaba)", () => {
    const choosing = untilChoosing();
    const out = step(choosing.state, text("643420102"));
    expect(out.effect).toBeUndefined();
    expect((out.state as Extract<ConversationState, { flow: "search" }>).step).toBe("choosing");
    expect(joinReplies(out).toLowerCase()).toContain("no entendi");
  });

  it("el boton 'No, volver al inicio' sale sin conectar", () => {
    const choosing = untilChoosing();
    const out = step(choosing.state, text(BUTTON.noConectar));
    expect(out.effect).toBeUndefined();
    expect(out.state).toEqual({ flow: "idle" });
  });

  it("resultado 'requested' muestra confirmacion calida y vuelve al menu", () => {
    const choosing = untilChoosing();
    const requesting = step(choosing.state, text("1"));
    const done = step(requesting.state, {
      kind: "effect_result",
      result: { type: "request_reunion", status: "requested" },
    });
    expect(done.state).toEqual({ flow: "idle" });
    const txt = joinReplies(done).toLowerCase();
    expect(txt).toContain("permiso");
    expect(serializeAll(done)).not.toContain("telefono");
  });

  it("resultado 'minor' muestra el aviso de proteccion de menores (guardrail #2)", () => {
    const choosing = untilChoosing();
    const requesting = step(choosing.state, text("1"));
    const done = step(requesting.state, {
      kind: "effect_result",
      result: { type: "request_reunion", status: "minor" },
    });
    expect(done.state).toEqual({ flow: "idle" });
    const txt = joinReplies(done).toLowerCase();
    expect(txt).toContain("entidad verificada");
  });

  it("resultado 'failed' muestra un mensaje generico sin revelar nada", () => {
    const choosing = untilChoosing();
    const requesting = step(choosing.state, text("1"));
    const done = step(requesting.state, {
      kind: "effect_result",
      result: { type: "request_reunion", status: "failed" },
    });
    expect(done.state).toEqual({ flow: "idle" });
    expect(joinReplies(done).toLowerCase()).toContain("no pudimos");
  });

  it("texto mientras espera el resultado (requesting) se ignora sin responder", () => {
    const choosing = untilChoosing();
    const requesting = step(choosing.state, text("1"));
    const ignored = step(requesting.state, text("hola?"));
    expect(ignored.replies).toHaveLength(0);
    expect((ignored.state as Extract<ConversationState, { flow: "search" }>).step).toBe(
      "requesting",
    );
  });

  it("/cancelar en 'choosing' vuelve al menu (comando global)", () => {
    const choosing = untilChoosing();
    const cancelled = step(choosing.state, cmd("/cancelar"));
    expect(cancelled.state).toEqual({ flow: "idle" });
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
    // Presentacion honesta: posible coincidencia + parecido ponderado (no certeza).
    expect(txt).toContain("posible coincidencia");
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

// ── Flujo puntos de encuentro (zonas) ────────────────────────────────────────

describe("flujo puntos de encuentro", () => {
  it("entrar emite list_zones de inmediato (sin paso de query)", () => {
    const started = step(initialState, text(BUTTON.zonas));
    expect(started.state).toEqual({ flow: "browse_zones", step: "loading" });
    expect(started.replies).toHaveLength(0);
    const effect = started.effect as Extract<Effect, { type: "list_zones" }>;
    expect(effect.type).toBe("list_zones");
  });

  it("el comando /zonas tambien abre los puntos de encuentro", () => {
    const res = step(initialState, cmd("/zonas"));
    expect(res.state.flow).toBe("browse_zones");
    expect(res.effect?.type).toBe("list_zones");
  });

  it("effect_result con zonas las lista y vuelve a idle con el menu", () => {
    const started = step(initialState, text(BUTTON.zonas));
    const shown = step(started.state, {
      kind: "effect_result",
      result: {
        type: "list_zones",
        zones: [synthPublicZone({ nombre: "Plaza Bolivar", estado: "activa" })],
      },
    });
    expect(shown.state).toEqual({ flow: "idle" });
    const txt = joinReplies(shown);
    expect(txt).toContain("Plaza Bolivar");
    expect(txt).toContain("activa");
    expect(shown.replies.at(-1)?.buttons).toBeDefined();
  });

  it("lista vacia muestra el mensaje vacio y vuelve a idle", () => {
    const started = step(initialState, text(BUTTON.zonas));
    const empty = step(started.state, {
      kind: "effect_result",
      result: { type: "list_zones", zones: [] },
    });
    expect(empty.state).toEqual({ flow: "idle" });
    expect(joinReplies(empty)).toContain("Todavia no hay puntos de encuentro");
  });

  it("texto mientras carga se ignora sin emitir respuesta", () => {
    const started = step(initialState, text(BUTTON.zonas));
    const ignored = step(started.state, text("hola"));
    expect(ignored.state).toEqual({ flow: "browse_zones", step: "loading" });
    expect(ignored.replies).toHaveLength(0);
    expect(ignored.effect).toBeUndefined();
  });
});

// ── Flujo necesidades ────────────────────────────────────────────────────────

describe("flujo necesidades", () => {
  it("entrar emite list_needs de inmediato (sin paso de query)", () => {
    const started = step(initialState, text(BUTTON.necesidades));
    expect(started.state).toEqual({ flow: "browse_needs", step: "loading" });
    expect(started.replies).toHaveLength(0);
    expect(started.effect?.type).toBe("list_needs");
  });

  it("el comando /necesidades tambien abre las necesidades", () => {
    const res = step(initialState, cmd("/necesidades"));
    expect(res.state.flow).toBe("browse_needs");
    expect(res.effect?.type).toBe("list_needs");
  });

  it("effect_result con necesidades las lista ORDENADAS por urgencia y vuelve a idle", () => {
    const started = step(initialState, text(BUTTON.necesidades));
    const shown = step(started.state, {
      kind: "effect_result",
      result: {
        type: "list_needs",
        needs: [
          synthPublicNeed({ tipo: "agua", urgencia: "baja", descripcion: "detalle agua" }),
          synthPublicNeed({ tipo: "medicinas", urgencia: "critica", descripcion: "detalle medicinas" }),
          synthPublicNeed({ tipo: "comida", urgencia: "media", descripcion: "detalle comida" }),
        ],
      },
    });
    expect(shown.state).toEqual({ flow: "idle" });
    const txt = joinReplies(shown);
    // La mas urgente (critica) sale antes que la menos urgente (baja).
    expect(txt.indexOf("medicinas")).toBeLessThan(txt.indexOf("comida"));
    expect(txt.indexOf("comida")).toBeLessThan(txt.indexOf("agua"));
    expect(txt).toContain("[critica]");
    expect(shown.replies.at(-1)?.buttons).toBeDefined();
  });

  it("lista vacia muestra el mensaje vacio y vuelve a idle", () => {
    const started = step(initialState, text(BUTTON.necesidades));
    const empty = step(started.state, {
      kind: "effect_result",
      result: { type: "list_needs", needs: [] },
    });
    expect(empty.state).toEqual({ flow: "idle" });
    expect(joinReplies(empty)).toContain("no hay necesidades publicadas");
  });

  it("texto mientras carga se ignora sin emitir respuesta", () => {
    const started = step(initialState, text(BUTTON.necesidades));
    const ignored = step(started.state, text("hola"));
    expect(ignored.state).toEqual({ flow: "browse_needs", step: "loading" });
    expect(ignored.replies).toHaveLength(0);
  });
});

// ── Flujo borrar ─────────────────────────────────────────────────────────────

describe("flujo borrar", () => {
  it("lista mis registros -> elijo -> confirmo -> emite delete_person -> ok", () => {
    const started = step(initialState, text(BUTTON.borrar));
    expect(started.state.flow).toBe("delete");
    // Al entrar se listan MIS registros (sin pedir codigos): emite el efecto y carga.
    expect(started.effect).toEqual({ type: "list_my_persons" });
    expect((started.state as Extract<ConversationState, { flow: "delete" }>).step).toBe("loading");

    const listed = step(started.state, listMine([synthOwnedPerson()]));
    expect((listed.state as Extract<ConversationState, { flow: "delete" }>).step).toBe("choosing");
    // Muestra el nombre y botones para tocar; no expone contacto.
    expect(joinReplies(listed)).toContain("Persona Sintetica");
    expect(listed.replies.at(-1)?.buttons?.flat()).toContain("1");

    const chosen = step(listed.state, text("1"));
    expect((chosen.state as Extract<ConversationState, { flow: "delete" }>).step).toBe("confirm");
    // La confirmacion muestra el NOMBRE, no un codigo.
    expect(joinReplies(chosen)).toContain("Persona Sintetica");

    const confirmed = step(chosen.state, text(BUTTON.confirmar));
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

  it("sin registros propios avisa y vuelve al menu (no pide codigos)", () => {
    const started = step(initialState, text(BUTTON.borrar));
    const listed = step(started.state, listMine([]));
    expect(listed.state).toEqual({ flow: "idle" });
    expect(joinReplies(listed).toLowerCase()).toContain("no encontramos registros");
  });

  it("numero fuera de la lista re-pide sin emitir efecto", () => {
    const started = step(initialState, text(BUTTON.borrar));
    const listed = step(started.state, listMine([synthOwnedPerson()]));
    const res = step(listed.state, text("9"));
    expect((res.state as Extract<ConversationState, { flow: "delete" }>).step).toBe("choosing");
    expect(res.effect).toBeUndefined();
    expect(joinReplies(res).toLowerCase()).toContain("no entendi");
  });
});

// ── Flujo rescatado (el dueno marca como encontrado con vida) ─────────────────

describe("flujo rescatado", () => {
  it("lista mis registros -> elijo -> confirmo -> emite mark_found -> ok", () => {
    const started = step(initialState, text(BUTTON.rescatado));
    expect(started.state.flow).toBe("mark_found");
    expect(started.effect).toEqual({ type: "list_my_persons" });

    const listed = step(started.state, listMine([synthOwnedPerson()]));
    expect((listed.state as Extract<ConversationState, { flow: "mark_found" }>).step).toBe(
      "choosing",
    );

    const chosen = step(listed.state, text("1"));
    expect((chosen.state as Extract<ConversationState, { flow: "mark_found" }>).step).toBe(
      "confirm",
    );
    // La confirmacion muestra el NOMBRE elegido, no un codigo.
    expect(joinReplies(chosen)).toContain("Persona Sintetica");

    const confirmed = step(chosen.state, text(BUTTON.confirmar));
    expect(confirmed.replies).toHaveLength(0);
    const effect = confirmed.effect as Extract<Effect, { type: "mark_found" }>;
    expect(effect.type).toBe("mark_found");
    expect(effect.personId).toBe(SYNTH_PERSON_ID);

    const done = step(confirmed.state, {
      kind: "effect_result",
      result: { type: "mark_found", ok: true },
    });
    expect(done.state).toEqual({ flow: "idle" });
    expect(joinReplies(done)).toContain("encontrado");
  });

  it("ante un fallo (incluido 'no es el dueno') vuelve al menu con mensaje amable", () => {
    const started = step(initialState, text(BUTTON.rescatado));
    const listed = step(started.state, listMine([synthOwnedPerson()]));
    const chosen = step(listed.state, text("1"));
    const confirmed = step(chosen.state, text(BUTTON.confirmar));

    const failed = step(confirmed.state, {
      kind: "effect_result",
      result: { type: "mark_found", ok: false },
    });
    expect(failed.state).toEqual({ flow: "idle" });
    // No revela la causa (no confirma existencia ni pertenencia a un tercero).
    const out = joinReplies(failed);
    expect(out.toLowerCase()).toContain("no pudimos");
    expect(out).not.toContain("403");
    expect(out).not.toContain("dueno");
  });

  it("sin registros propios avisa y vuelve al menu (no pide codigos)", () => {
    const started = step(initialState, text(BUTTON.rescatado));
    const listed = step(started.state, listMine([]));
    expect(listed.state).toEqual({ flow: "idle" });
    expect(joinReplies(listed).toLowerCase()).toContain("no encontramos registros");
  });

  it("cancela en la confirmacion sin emitir mark_found", () => {
    const started = step(initialState, text(BUTTON.rescatado));
    const listed = step(started.state, listMine([synthOwnedPerson()]));
    const chosen = step(listed.state, text("1"));
    const cancelled = step(chosen.state, text(BUTTON.cancelar));
    expect(cancelled.state).toEqual({ flow: "idle" });
    expect(cancelled.effect).toBeUndefined();
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

    const del = run(initialState, [text(BUTTON.borrar)]);
    const listed = step(del.state, listMine([synthOwnedPerson()]));
    expect(step(listed.state, cmd("/cancelar")).state).toEqual({ flow: "idle" });
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

  it("el efecto search_persons no incluye contacto sensible inesperado", () => {
    const res = run(initialState, searchByName("alguien"));
    const blob = serializeAll(res);
    expect(blob).not.toContain("contact_id");
    expect(blob).not.toContain("chat_id");
  });

  it("los resultados mostrados nunca incluyen contact_id aunque el adaptador lo cuele", () => {
    // Aunque un resultado trajera contacto, la vista publica ya lo excluye; aqui
    // verificamos que la maquina solo renderiza los campos publicos esperados.
    const queried = run(initialState, searchByName("alguien"));
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
