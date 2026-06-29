import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/client.js";
import { createMatchRepo } from "../src/repos/match.js";
import type { MatchRow } from "../src/types.js";

// Tests del REENCUENTRO con consentimiento bilateral (migrations/0006). Fake DbClient
// PROPIO, configurable por un modelo de datos en memoria. Datos SINTETICOS, sin PII real
// (los telefonos NO usan el formato venezolano que vigila guardrails-scan).
//
// GUARDRAILS verificados:
//   - #2 (menores): requestReunion bloquea si la persona es menor por edad o por fila
//     en `minors`; NO solicita nada.
//   - #1 (privacidad): el telefono SOLO aparece en el resultado 'exchanged' (doble si);
//     ni 'requested' ni 'rejected' lo transportan.
//   - Doble consentimiento: sin el 'aceptado' del buscador no hay intercambio.

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

/** Modelo en memoria que el fake consulta. Configurable por test. */
interface Model {
  /** Persona: edad + contacto del registrante. */
  person: { edad: number | null; contact_id: string | null } | null;
  /** ¿La persona tiene fila en `minors`? */
  isMinorRow: boolean;
  /** El match buscador<->persona resoluble (o null si no hay). */
  matchForRequest: { id: string } | null;
  /** El match pendiente del registrante (con el consentimiento actual del buscador). */
  pendingForRegistrante:
    | { id: string; consentimiento_buscador: MatchRow["consentimiento_buscador"] }
    | null;
  /** Fila completa del match (para getById dentro de getConfirmContext). */
  matchRow: MatchRow | null;
  /** buscador_contact_id de la search del match. */
  searchBuscadorContact: string | null;
  /** Canal preferente por contacto. */
  channelByContact: Record<string, string | null>;
  /** Telefono por contacto. */
  telefonoByContact: Record<string, string | null>;
}

interface Capture {
  updates: Array<{ values: Record<string, unknown>; id: string }>;
}

/**
 * Fake DbClient guiado por `Model`. Cada `from(relation)` devuelve un builder que
 * recuerda columnas seleccionadas y filtros `eq`, y al resolver (`maybeSingle`) decide
 * la fila segun la relacion + filtros, imitando a PostgREST.
 */
function makeFakeClient(model: Model, capture: Capture): DbClient {
  const makeBuilder = (relation: string): Record<string, unknown> => {
    let selected = "";
    let mode: "select" | "update" = "select";
    let updateValues: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};

    const resolve = (): unknown => {
      if (relation === "persons") return model.person;
      if (relation === "minors") return model.isMinorRow ? { id: "minor-row" } : null;
      if (relation === "matches") {
        // Distinguimos las dos consultas de seleccion por sus columnas/filtros.
        if (selected.includes("searches!inner")) return model.matchForRequest;
        if (selected.includes("persons!inner")) return model.pendingForRegistrante;
        // getById: select('*').eq('id')
        return model.matchRow;
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

    const builder: Record<string, unknown> = {
      select: (columns?: string) => {
        if (typeof columns === "string") selected = columns;
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
        if (mode === "update" && column === "id" && updateValues !== null) {
          capture.updates.push({ values: updateValues, id: value as string });
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: resolve(), error: null }),
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
    matchForRequest: { id: MATCH_ID },
    pendingForRegistrante: { id: MATCH_ID, consentimiento_buscador: "aceptado" },
    matchRow: {
      id: MATCH_ID,
      search_id: SEARCH_ID,
      person_id: PERSON_ID,
      pet_id: null,
      score: 0.9,
      metodo: "trigram",
      estado_revision: "propuesto",
      revisado_por: null,
      consentimiento_buscador: "aceptado",
      consentimiento_registrante: "solicitado",
      reunion_estado: "pendiente",
      created_at: "2026-01-01T00:00:00.000Z",
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
    const repo = createMatchRepo(makeFakeClient(baseModel({ matchForRequest: null }), emptyCapture()));
    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });
    expect(res.outcome).toBe("not_found");
  });

  it("adulto con match -> requested: acepta al buscador y solicita al registrante (sin telefono)", async () => {
    const capture = emptyCapture();
    const repo = createMatchRepo(makeFakeClient(baseModel(), capture));

    const res = await repo.requestReunion({ buscadorContactId: BUSCADOR_CONTACT, personId: PERSON_ID });

    expect(res.outcome).toBe("requested");
    if (res.outcome !== "requested") throw new Error("unreachable");
    expect(res.matchId).toBe(MATCH_ID);
    // El registrante a avisar, SIN telefono (no se comparte aun).
    expect(res.registrante.contactId).toBe(REGISTRANTE_CONTACT);
    expect(res.registrante.channelId).toBe(REGISTRANTE_CHANNEL);
    expect(JSON.stringify(res)).not.toContain(TEL_REGISTRANTE);
    expect(JSON.stringify(res)).not.toContain(TEL_BUSCADOR);
    // El match quedo: buscador aceptado, registrante solicitado, reunion pendiente.
    expect(capture.updates).toHaveLength(1);
    expect(capture.updates[0]?.values).toEqual({
      consentimiento_buscador: "aceptado",
      consentimiento_registrante: "solicitado",
      reunion_estado: "pendiente",
    });
  });
});

describe("matchRepo.respondReunion (registrante responde)", () => {
  it("sin solicitud pendiente -> not_found", async () => {
    const repo = createMatchRepo(
      makeFakeClient(baseModel({ pendingForRegistrante: null }), emptyCapture()),
    );
    const res = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "aceptado",
    });
    expect(res.outcome).toBe("not_found");
  });

  it("RECHAZO -> rejected: cierra sin compartir nada y devuelve a quien avisar (sin telefono)", async () => {
    const capture = emptyCapture();
    const repo = createMatchRepo(makeFakeClient(baseModel(), capture));

    const res = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "rechazado",
    });

    expect(res.outcome).toBe("rejected");
    if (res.outcome !== "rejected") throw new Error("unreachable");
    // Marca registrante rechazado y reunion rechazada.
    expect(capture.updates[0]?.values).toEqual({
      consentimiento_registrante: "rechazado",
      reunion_estado: "rechazada",
    });
    // Avisa al buscador, pero NUNCA con telefono de nadie (guardrail #1).
    expect(res.buscador.contactId).toBe(BUSCADOR_CONTACT);
    expect(JSON.stringify(res)).not.toContain(TEL_BUSCADOR);
    expect(JSON.stringify(res)).not.toContain(TEL_REGISTRANTE);
  });

  it("DOBLE SI -> exchanged: marca intercambiado y comparte el contacto de cada parte", async () => {
    const capture = emptyCapture();
    const repo = createMatchRepo(makeFakeClient(baseModel(), capture));

    const res = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "aceptado",
    });

    expect(res.outcome).toBe("exchanged");
    if (res.outcome !== "exchanged") throw new Error("unreachable");
    // Dos updates: aceptacion del registrante + paso a 'intercambiado'.
    expect(capture.updates).toHaveLength(2);
    expect(capture.updates[0]?.values).toEqual({ consentimiento_registrante: "aceptado" });
    expect(capture.updates[1]?.values).toEqual({ reunion_estado: "intercambiado" });
    // SOLO aqui aparecen los telefonos, uno por parte, para la entrega punto a punto.
    expect(res.buscador.telefono).toBe(TEL_BUSCADOR);
    expect(res.registrante.telefono).toBe(TEL_REGISTRANTE);
    expect(res.buscador.channelId).toBe(BUSCADOR_CHANNEL);
    expect(res.registrante.channelId).toBe(REGISTRANTE_CHANNEL);
  });

  it("registrante acepta pero el BUSCADOR no figura aceptado -> accepted_waiting (no intercambia)", async () => {
    const capture = emptyCapture();
    const model = baseModel({
      pendingForRegistrante: { id: MATCH_ID, consentimiento_buscador: "solicitado" },
    });
    const repo = createMatchRepo(makeFakeClient(model, capture));

    const res = await repo.respondReunion({
      registranteContactId: REGISTRANTE_CONTACT,
      decision: "aceptado",
    });

    expect(res.outcome).toBe("accepted_waiting");
    // Solo se marca la aceptacion del registrante; NO se pasa a 'intercambiado'.
    expect(capture.updates).toHaveLength(1);
    expect(capture.updates[0]?.values).toEqual({ consentimiento_registrante: "aceptado" });
    // Sin telefono compartido (defensa en profundidad).
    expect(JSON.stringify(res)).not.toContain(TEL_BUSCADOR);
    expect(JSON.stringify(res)).not.toContain(TEL_REGISTRANTE);
  });
});
