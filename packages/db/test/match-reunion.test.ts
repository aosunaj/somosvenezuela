import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/client.js";
import { createMatchRepo } from "../src/repos/match.js";
import type {
  ConsentimientoEstado,
  MatchRow,
  ReunionEstado,
} from "../src/types.js";

// Tests del REENCUENTRO con consentimiento bilateral (migrations/0006). Fake DbClient
// PROPIO, configurable por un modelo de datos en memoria y CON ESTADO: las UPDATE con
// precondicion mutan el estado del match, asi se prueba idempotencia/carrera (dos
// llamadas seguidas comparten el mismo cliente y la segunda ve el estado ya mutado).
// Datos SINTETICOS, sin PII real (los telefonos NO usan el formato venezolano que
// vigila guardrails-scan).
//
// GUARDRAILS verificados:
//   - #2 (menores): requestReunion bloquea si la persona es menor por edad o por fila
//     en `minors`; NO solicita nada.
//   - #1 (privacidad): el telefono SOLO aparece en el resultado 'exchanged' (doble si);
//     ni 'requested' ni 'rejected' lo transportan.
//   - Doble consentimiento + idempotencia: el intercambio (telefono) ocurre UNA sola
//     vez aunque lleguen dos /conectar; un "no" del registrante queda firme.

const PERSON_ID = "a0000000-0000-4000-8000-000000000001";
const MATCH_ID = "b0000000-0000-4000-8000-000000000001";
const SEARCH_ID = "d0000000-0000-4000-8000-000000000001";
const BUSCADOR_CONTACT = "c0000000-0000-4000-8000-0000000000b1";
const REGISTRANTE_CONTACT = "c0000000-0000-4000-8000-0000000000a1";
const BUSCADOR_CHANNEL = "e0000000-0000-4000-8000-0000000000b1";
const REGISTRANTE_CHANNEL = "e0000000-0000-4000-8000-0000000000a1";

// Telefonos SINTETICOS que NO casan el patron venezolano /\+58 4\d{2}.../ del scanner.
const TEL_BUSCADOR = "tel-sintetico-buscador";
const TEL_REGISTRANTE = "tel-sintetico-registrante";

/** Estado vivo del match (mutado por las UPDATE con precondicion). */
interface MatchState {
  consentimiento_buscador: ConsentimientoEstado;
  consentimiento_registrante: ConsentimientoEstado;
  reunion_estado: ReunionEstado;
}

/** Modelo en memoria que el fake consulta. Configurable por test. */
interface Model {
  /** Persona: edad + contacto del registrante. */
  person: { edad: number | null; contact_id: string | null } | null;
  /** ¿La persona tiene fila en `minors`? */
  isMinorRow: boolean;
  /** ¿Existe un match buscador<->persona resoluble? */
  matchExists: boolean;
  /** Estado VIVO del consentimiento del match (lo mutan las UPDATE). */
  matchState: MatchState;
  /** buscador_contact_id de la search del match. */
  searchBuscadorContact: string | null;
  /** Canal preferente por contacto. */
  channelByContact: Record<string, string | null>;
  /** Telefono por contacto. */
  telefonoByContact: Record<string, string | null>;
}

interface Capture {
  updates: Array<{ values: Record<string, unknown>; filters: Record<string, unknown>; affected: number }>;
}

/** Fila completa del match derivada del estado vivo (para getById/getConfirmContext). */
function buildMatchRow(state: MatchState): MatchRow {
  return {
    id: MATCH_ID,
    search_id: SEARCH_ID,
    person_id: PERSON_ID,
    pet_id: null,
    score: 0.9,
    metodo: "trigram",
    estado_revision: "propuesto",
    revisado_por: null,
    consentimiento_buscador: state.consentimiento_buscador,
    consentimiento_registrante: state.consentimiento_registrante,
    reunion_estado: state.reunion_estado,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Fake DbClient guiado por `Model` CON ESTADO. Cada `from(relation)` devuelve un builder
 * que acumula columnas seleccionadas, filtros `eq` y, en modo update, los valores.
 *   - Las SELECT resuelven contra el estado vivo, imitando los filtros de PostgREST.
 *   - Las UPDATE (`...eq(...).select('id')`) son AWAITABLE: evaluan sus precondiciones
 *     `eq` (mas alla del id) contra el estado vivo; si matchean, MUTAN el estado y
 *     devuelven [{id}] (1 fila); si no, devuelven [] (0 filas) sin mutar.
 */
function makeFakeClient(model: Model, capture: Capture): DbClient {
  const makeBuilder = (relation: string): Record<string, unknown> => {
    let selected = "";
    let mode: "select" | "update" = "select";
    let updateValues: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};

    // Columnas de precondicion sobre matches que el repo usa como guarda.
    const PRECOND_COLS = [
      "reunion_estado",
      "consentimiento_registrante",
      "consentimiento_buscador",
    ] as const;

    const resolveSelect = (): unknown => {
      if (relation === "persons") return model.person;
      if (relation === "minors") return model.isMinorRow ? { id: "minor-row" } : null;
      if (relation === "matches") {
        // requestReunion: select('id, searches!inner(...)') -> el match existe o no.
        if (selected.includes("searches!inner")) {
          return model.matchExists ? { id: MATCH_ID } : null;
        }
        // respondReunion: select('id, consentimiento_buscador, persons!inner(...)')
        //   filtrado por consentimiento_registrante='solicitado'. Solo resuelve si el
        //   estado vivo sigue 'solicitado' (asi una segunda llamada ve null si ya cambio).
        if (selected.includes("persons!inner")) {
          if (!model.matchExists) return null;
          if (model.matchState.consentimiento_registrante !== "solicitado") return null;
          return { id: MATCH_ID, consentimiento_buscador: model.matchState.consentimiento_buscador };
        }
        // getById: select('*').eq('id') -> fila completa del estado vivo.
        return model.matchExists ? buildMatchRow(model.matchState) : null;
      }
      if (relation === "searches") {
        return { buscador_contact_id: model.searchBuscadorContact };
      }
      if (relation === "channels") {
        const contactId = filters["contact_id"] as string | undefined;
        const id = contactId !== undefined ? model.channelByContact[contactId] ?? null : null;
        return id === null ? null : { id };
      }
      if (relation === "contacts") {
        const id = filters["id"] as string | undefined;
        const telefono = id !== undefined ? model.telefonoByContact[id] ?? null : null;
        return { telefono };
      }
      return null;
    };

    /** Ejecuta una UPDATE con precondicion: devuelve las filas afectadas y muta si aplica. */
    const runUpdate = (): { data: Array<{ id: string }>; error: null } => {
      // Precondiciones: todos los `eq` sobre columnas de estado deben casar el estado vivo.
      let precondOk = relation === "matches" && model.matchExists;
      for (const col of PRECOND_COLS) {
        if (col in filters) {
          if (model.matchState[col] !== filters[col]) precondOk = false;
        }
      }
      const affected = precondOk ? 1 : 0;
      capture.updates.push({ values: updateValues ?? {}, filters: { ...filters }, affected });
      if (precondOk && updateValues !== null) {
        // Muta el estado vivo con los valores de la UPDATE (solo columnas de estado).
        for (const col of PRECOND_COLS) {
          if (col in updateValues) {
            model.matchState[col] = updateValues[col] as never;
          }
        }
        return { data: [{ id: MATCH_ID }], error: null };
      }
      return { data: [], error: null };
    };

    const builder: Record<string, unknown> = {
      select: (columns?: string) => {
        if (typeof columns === "string") selected = columns;
        // En modo update, `select('id')` cierra la cadena y se AWAITA: lo hacemos thenable.
        if (mode === "update") {
          return { then: (resolve: (v: unknown) => void) => resolve(runUpdate()) };
        }
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      update: (values: Record<string, unknown>) => {
        mode = "update";
        updateValues = values;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: resolveSelect(), error: null }),
    };
    return builder;
  };

  return {
    from(relation: string) {
      return makeBuilder(relation);
    },
  } as unknown as DbClient;
}

function baseModel(overrides: Partial<Model> = {}): Model {
  return {
    person: { edad: 30, contact_id: REGISTRANTE_CONTACT },
    isMinorRow: false,
    matchExists: true,
    matchState: {
      consentimiento_buscador: "aceptado",
      consentimiento_registrante: "solicitado",
      reunion_estado: "pendiente",
    },
    searchBuscadorContact: BUSCADOR_CONTACT,
    channelByContact: {
      [BUSCADOR_CONTACT]: BUSCADOR_CHANNEL,
      [REGISTRANTE_CONTACT]: REGISTRANTE_CHANNEL,
    },
    telefonoByContact: {
      [BUSCADOR_CONTACT]: TEL_BUSCADOR,
      [REGISTRANTE_CONTACT]: TEL_REGISTRANTE,
    },
    ...overrides,
  };
}

function emptyCapture(): Capture {
  return { updates: [] };
}

/** Cuenta las UPDATE que SI afectaron una fila (transiciones reales). */
function effectiveUpdates(capture: Capture): Array<{ values: Record<string, unknown> }> {
  return capture.updates.filter((u) => u.affected === 1);
}

describe("matchRepo.requestReunion (buscador inicia)", () => {
  it("persona menor por EDAD -> minor_blocked, no solicita nada (guardrail #2)", async () => {
    const capture = emptyCapture();
    const model = baseModel({ person: { edad: 15, contact_id: REGISTRANTE_CONTACT } });
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });

    expect(res.outcome).toBe("minor_blocked");
    // NO se toco el match: no se solicito consentimiento a nadie.
    expect(capture.updates).toHaveLength(0);
  });

  it("persona menor por FILA en minors -> minor_blocked (guardrail #2)", async () => {
    const capture = emptyCapture();
    const model = baseModel({ isMinorRow: true });
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });

    expect(res.outcome).toBe("minor_blocked");
    expect(capture.updates).toHaveLength(0);
  });

  it("persona inexistente -> not_found", async () => {
    const repo = createMatchRepo(makeFakeClient(baseModel({ person: null }), emptyCapture()));
    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });
    expect(res.outcome).toBe("not_found");
  });

  it("sin match buscador<->persona -> not_found", async () => {
    const repo = createMatchRepo(makeFakeClient(baseModel({ matchExists: false }), emptyCapture()));
    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });
    expect(res.outcome).toBe("not_found");
  });

  it("adulto con match INACTIVA -> requested: acepta al buscador y solicita al registrante (sin telefono)", async () => {
    const capture = emptyCapture();
    // El match nace 'inactiva' (estado por defecto antes de cualquier reencuentro).
    const model = baseModel({
      matchState: {
        consentimiento_buscador: "sin_solicitar",
        consentimiento_registrante: "sin_solicitar",
        reunion_estado: "inactiva",
      },
    });
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });

    expect(res.outcome).toBe("requested");
    if (res.outcome !== "requested") throw new Error("unreachable");
    expect(res.matchId).toBe(MATCH_ID);
    // El registrante a avisar, SIN telefono (no se comparte aun).
    expect(res.registrante.contactId).toBe(REGISTRANTE_CONTACT);
    expect(res.registrante.channelId).toBe(REGISTRANTE_CHANNEL);
    expect(JSON.stringify(res)).not.toContain(TEL_REGISTRANTE);
    expect(JSON.stringify(res)).not.toContain(TEL_BUSCADOR);
    // La UPDATE efectiva dejo: buscador aceptado, registrante solicitado, pendiente.
    const effective = effectiveUpdates(capture);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.values).toEqual({
      consentimiento_buscador: "aceptado",
      consentimiento_registrante: "solicitado",
      reunion_estado: "pendiente",
    });
    // La guarda exige reunion_estado='inactiva' en la UPDATE (un "no" no se reabre).
    expect(capture.updates[0]?.filters["reunion_estado"]).toBe("inactiva");
  });

  it("re-pedir sobre un match YA pendiente -> already_handled, NO reabre ni re-solicita", async () => {
    const capture = emptyCapture();
    // El match ya esta 'pendiente' (alguien ya pidio): la guarda 'inactiva' no matchea.
    const model = baseModel(); // estado por defecto: pendiente/solicitado
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });

    expect(res.outcome).toBe("already_handled");
    // La UPDATE no afecto ninguna fila: el estado sigue intacto.
    expect(effectiveUpdates(capture)).toHaveLength(0);
    expect(model.matchState.reunion_estado).toBe("pendiente");
  });

  it("un 'NO' queda firme: tras un rechazo, un nuevo request NO reabre la solicitud", async () => {
    const capture = emptyCapture();
    // El match quedo 'rechazada' por una respuesta previa del registrante.
    const model = baseModel({
      matchState: {
        consentimiento_buscador: "aceptado",
        consentimiento_registrante: "rechazado",
        reunion_estado: "rechazada",
      },
    });
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });

    expect(res.outcome).toBe("already_handled");
    // No se mutó el estado: el "no" se mantiene firme.
    expect(effectiveUpdates(capture)).toHaveLength(0);
    expect(model.matchState.reunion_estado).toBe("rechazada");
    expect(model.matchState.consentimiento_registrante).toBe("rechazado");
  });
});

describe("matchRepo.respondReunion (registrante responde)", () => {
  it("sin solicitud pendiente -> not_found", async () => {
    // El match no esta 'solicitado': la SELECT de correlacion resuelve null.
    const model = baseModel({
      matchState: {
        consentimiento_buscador: "aceptado",
        consentimiento_registrante: "sin_solicitar",
        reunion_estado: "inactiva",
      },
    });
    const repo = createMatchRepo(makeFakeClient(model, emptyCapture()));
    const res = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "aceptado",
    });
    expect(res.outcome).toBe("not_found");
  });

  it("RECHAZO -> rejected: cierra sin compartir nada y devuelve a quien avisar (sin telefono)", async () => {
    const capture = emptyCapture();
    const model = baseModel();
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "rechazado",
    });

    expect(res.outcome).toBe("rejected");
    if (res.outcome !== "rejected") throw new Error("unreachable");
    // La UPDATE efectiva marca registrante rechazado y reunion rechazada.
    const effective = effectiveUpdates(capture);
    expect(effective[0]?.values).toEqual({
      consentimiento_registrante: "rechazado",
      reunion_estado: "rechazada",
    });
    // El estado vivo quedo cerrado (un "no" firme).
    expect(model.matchState.reunion_estado).toBe("rechazada");
    // Avisa al buscador, pero NUNCA con telefono de nadie (guardrail #1).
    expect(res.buscador.contactId).toBe(BUSCADOR_CONTACT);
    expect(JSON.stringify(res)).not.toContain(TEL_BUSCADOR);
    expect(JSON.stringify(res)).not.toContain(TEL_REGISTRANTE);
  });

  it("DOBLE SI -> exchanged: marca intercambiado y comparte el contacto de cada parte", async () => {
    const capture = emptyCapture();
    const model = baseModel();
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "aceptado",
    });

    expect(res.outcome).toBe("exchanged");
    if (res.outcome !== "exchanged") throw new Error("unreachable");
    // Dos UPDATE efectivas: aceptacion del registrante + paso a 'intercambiado'.
    const effective = effectiveUpdates(capture);
    expect(effective).toHaveLength(2);
    expect(effective[0]?.values).toEqual({ consentimiento_registrante: "aceptado" });
    expect(effective[1]?.values).toEqual({ reunion_estado: "intercambiado" });
    expect(model.matchState.reunion_estado).toBe("intercambiado");
    // SOLO aqui aparecen los telefonos, uno por parte, para la entrega punto a punto.
    expect(res.buscador.telefono).toBe(TEL_BUSCADOR);
    expect(res.registrante.telefono).toBe(TEL_REGISTRANTE);
    expect(res.buscador.channelId).toBe(BUSCADOR_CHANNEL);
    expect(res.registrante.channelId).toBe(REGISTRANTE_CHANNEL);
  });

  it("registrante acepta pero el BUSCADOR no figura aceptado -> accepted_waiting (no intercambia)", async () => {
    const capture = emptyCapture();
    const model = baseModel({
      matchState: {
        consentimiento_buscador: "solicitado",
        consentimiento_registrante: "solicitado",
        reunion_estado: "pendiente",
      },
    });
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "aceptado",
    });

    expect(res.outcome).toBe("accepted_waiting");
    // Solo se marca la aceptacion del registrante; NO se pasa a 'intercambiado'.
    const effective = effectiveUpdates(capture);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.values).toEqual({ consentimiento_registrante: "aceptado" });
    expect(model.matchState.reunion_estado).toBe("pendiente");
    // Sin telefono compartido (defensa en profundidad).
    expect(JSON.stringify(res)).not.toContain(TEL_BUSCADOR);
    expect(JSON.stringify(res)).not.toContain(TEL_REGISTRANTE);
  });

  it("IDEMPOTENCIA: dos /conectar seguidos entregan el telefono UNA sola vez", async () => {
    const capture = emptyCapture();
    const model = baseModel(); // pendiente, buscador aceptado, registrante solicitado
    // MISMO cliente (mismo estado vivo) para ambas llamadas: simula la carrera.
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const first = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "aceptado",
    });
    const second = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "aceptado",
    });

    // La PRIMERA intercambia y entrega contacto; la SEGUNDA ya no encuentra solicitud
    // 'solicitado' (la primera la dejo 'aceptado'/'intercambiado') -> not_found, SIN
    // volver a leer ni entregar telefonos.
    expect(first.outcome).toBe("exchanged");
    expect(second.outcome).toBe("not_found");

    // El telefono solo aparece en el resultado de la PRIMERA llamada.
    expect(JSON.stringify(first)).toContain(TEL_BUSCADOR);
    expect(JSON.stringify(first)).toContain(TEL_REGISTRANTE);
    expect(JSON.stringify(second)).not.toContain(TEL_BUSCADOR);
    expect(JSON.stringify(second)).not.toContain(TEL_REGISTRANTE);

    // Solo UNA transicion a 'intercambiado' (el telefono se entrego una sola vez).
    const exchanges = effectiveUpdates(capture).filter(
      (u) => u.values["reunion_estado"] === "intercambiado",
    );
    expect(exchanges).toHaveLength(1);
  });
});
