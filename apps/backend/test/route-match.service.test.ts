import { describe, expect, it, vi } from "vitest";
import type { PersonRepo, SearchRepo, AuditRepo } from "db";
import { routeMatch, type RouteMatchDeps, type MatchForRouting } from "../src/services/route-match.js";

// Tests del servicio de routing de matches (route-match).
// Verifican el ORDEN EXACTO de evaluación definido en R2-4(c) del diseño.
// Datos SINTETICOS sin PII.
//
// Orden de evaluación (priority, top wins):
//   1. pet_id !== null → human
//   2. CONSERVATIVE: buscador_contact_id IS NULL / isMinorByContactId no puede
//      resolver a adulto / registrant edad IS NULL → human (MINOR gate)
//   3. isMinorById(registrant) | isMinorByContactId(searcher) | es_menor=true → human
//   4. estado='fallecida' either side → human
//   5. sin verification question → human
//   6. score < threshold → human
//   7. todo OK, both positively adult → auto

const SYNTH_CONTACT_A = "aa000000-0000-4000-8000-000000000001";
const SYNTH_CONTACT_B = "bb000000-0000-4000-8000-000000000002";
const SYNTH_SEARCH_ID = "s0000000-0000-4000-8000-000000000001";
const SYNTH_MATCH_ID = "m0000000-0000-4000-8000-000000000001";
const SYNTH_PERSON_ID = "p0000000-0000-4000-8000-000000000001";

/** Construye un MatchForRouting con defaults seguros (adult adult, high score). */
function makeMatch(overrides: Partial<MatchForRouting> = {}): MatchForRouting {
  return {
    id: SYNTH_MATCH_ID,
    search_id: SYNTH_SEARCH_ID,
    person_id: SYNTH_PERSON_ID,
    pet_id: null,
    score: 0.9,
    estado_registrant: "desaparecida",
    es_menor_search: false,
    buscador_contact_id: SYNTH_CONTACT_A,
    registrant_contact_id: SYNTH_CONTACT_B,
    ...overrides,
  };
}

/** Fake deps: todos los repos devuelven valores "seguros" (adulto, con verif). */
function makeDeps(overrides: Partial<RouteMatchDeps> = {}): RouteMatchDeps {
  const fakePersonRepo: Pick<PersonRepo, "isMinorById" | "getVerificationStatus"> = {
    isMinorById: vi.fn().mockResolvedValue(false), // registrant es adulto
    getVerificationStatus: vi.fn().mockResolvedValue({
      hasQuestion: true,
      answerHash: "$argon2id$...",
    }),
  };
  const fakeSearchRepo: Pick<SearchRepo, "isMinorByContactId"> = {
    isMinorByContactId: vi.fn().mockResolvedValue(false), // searcher es adulto
  };
  const fakeAuditRepo: Pick<AuditRepo, "writeRouteDecision"> = {
    writeRouteDecision: vi.fn().mockResolvedValue(undefined),
  };
  return {
    personRepo: fakePersonRepo as unknown as PersonRepo,
    searchRepo: fakeSearchRepo as unknown as SearchRepo,
    auditRepo: fakeAuditRepo as unknown as AuditRepo,
    autoMatchThreshold: 0.85,
    ...overrides,
  };
}

describe("routeMatch — orden exacto R2-4(c)", () => {
  describe("Paso 1: pet_id → human siempre", () => {
    it("pet_id !== null → human (auto-match mascotas no es goal)", async () => {
      const deps = makeDeps();
      const match = makeMatch({ pet_id: "pet-id-123" });
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
      expect(result.reason).toMatch(/pet/i);
    });
  });

  describe("Paso 2: rama conservadora/desconocida", () => {
    it("buscador_contact_id IS NULL → human (branch conservative)", async () => {
      const deps = makeDeps();
      const match = makeMatch({ buscador_contact_id: null });
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
      expect(result.reason).toMatch(/conserv|unknown/i);
    });

    it("isMinorByContactId(searcher) no puede resolver a adulto (retorna true) → human antes que paso 3", async () => {
      // Simula un contacto cuyas personas tienen edad=null (conservative)
      const deps = makeDeps({
        searchRepo: { isMinorByContactId: vi.fn().mockResolvedValue(true) } as unknown as SearchRepo,
      });
      const match = makeMatch({ es_menor_search: false }); // self-declaration false no ayuda
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
    });
  });

  describe("Paso 3: señales positivas de menor", () => {
    it("isMinorById(registrant)=true → human", async () => {
      const deps = makeDeps({
        personRepo: {
          isMinorById: vi.fn().mockResolvedValue(true), // registrant es menor
          getVerificationStatus: vi.fn().mockResolvedValue({ hasQuestion: true, answerHash: "$h$" }),
        } as unknown as PersonRepo,
      });
      const match = makeMatch();
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
    });

    it("es_menor_search=true → human (la auto-declaración AÑADE señal de menor, no la resta)", async () => {
      const deps = makeDeps();
      const match = makeMatch({ es_menor_search: true });
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
    });

    it("es_menor_search=false con isMinorByContactId=false y isMinorById=false → puede avanzar", async () => {
      const deps = makeDeps(); // todos false → puede llegar a paso 6
      const match = makeMatch({ es_menor_search: false, score: 0.9 });
      const result = await routeMatch(deps, match);
      // Con verificacion y score OK → auto
      expect(result.decision).toBe("auto");
    });
  });

  describe("Paso 4: fallecida either side → human", () => {
    it("registrant estado='fallecida' → human", async () => {
      const deps = makeDeps();
      const match = makeMatch({ estado_registrant: "fallecida" });
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
      expect(result.reason).toMatch(/fallecida/i);
    });
  });

  describe("Paso 5: sin verification question → human", () => {
    it("hasQuestion=false → human (sin pregunta no hay auto-path)", async () => {
      const deps = makeDeps({
        personRepo: {
          isMinorById: vi.fn().mockResolvedValue(false),
          getVerificationStatus: vi.fn().mockResolvedValue({
            hasQuestion: false,
            answerHash: null,
          }),
        } as unknown as PersonRepo,
      });
      const match = makeMatch();
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
      expect(result.reason).toMatch(/verificaci[oó]n|verif/i);
    });

    it("getVerificationStatus=null (persona no encontrada) → human (conservative)", async () => {
      const deps = makeDeps({
        personRepo: {
          isMinorById: vi.fn().mockResolvedValue(false),
          getVerificationStatus: vi.fn().mockResolvedValue(null),
        } as unknown as PersonRepo,
      });
      const match = makeMatch();
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
    });
  });

  describe("Paso 6: score < threshold → human", () => {
    it("score < autoMatchThreshold → human", async () => {
      const deps = makeDeps();
      const match = makeMatch({ score: 0.7 }); // below 0.85
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("human");
      expect(result.reason).toMatch(/score|umbral|threshold/i);
    });

    it("score === autoMatchThreshold → auto", async () => {
      const deps = makeDeps();
      const match = makeMatch({ score: 0.85 });
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("auto");
    });
  });

  describe("Paso 7: todo OK → auto", () => {
    it("ambos adultos, score alto, con verificación, no fallecida → auto", async () => {
      const deps = makeDeps();
      const match = makeMatch({ score: 0.95 });
      const result = await routeMatch(deps, match);
      expect(result.decision).toBe("auto");
    });
  });

  describe("Auditoría", () => {
    it("siempre escribe una fila de route_decision (auto o human)", async () => {
      const fakeAuditRepo = { writeRouteDecision: vi.fn().mockResolvedValue(undefined) };
      const deps = makeDeps({ auditRepo: fakeAuditRepo as unknown as AuditRepo });
      await routeMatch(deps, makeMatch());
      expect(fakeAuditRepo.writeRouteDecision).toHaveBeenCalledOnce();
      expect(fakeAuditRepo.writeRouteDecision).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: SYNTH_MATCH_ID }),
      );
    });
  });
});
