import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONSENT_SESSION_STATES,
  createConsentRepo,
} from "../repos/consent.js";
import type { DbClient } from "../client.js";

// Test de CONTRATO REAL: el estado que el repo escribe en consent_sessions.state
// DEBE pertenecer al conjunto que admite el CHECK de la migración 0008
// (judgment-r3 item 8). Los FAKES anteriores no validaban esto, por eso el bug
// de 'pending_a' (rechazado por el CHECK en producción) pasó desapercibido.
//
// Aquí parseamos el SQL REAL de la migración y comparamos contra él, en vez de
// hardcodear la lista esperada. Si el CHECK cambia, este test lo detecta.
//
// Datos SINTÉTICOS sin PII.

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = packages/db/src/__tests__ → repo root = ../../../../
const MIGRATION_0008 = resolve(
  __dirname,
  "../../../../migrations/0008_consent_relay_audit.sql",
);

/**
 * Extrae el conjunto de estados permitido por el CHECK
 * `consent_sessions_state_check` del SQL real de la migración 0008.
 */
function readAllowedStatesFromMigration(): Set<string> {
  const sql = readFileSync(MIGRATION_0008, "utf8");

  // Localiza el bloque del CHECK de consent_sessions_state_check.
  const checkMatch = sql.match(
    /consent_sessions_state_check[\s\S]*?check\s*\(\s*state\s+in\s*\(([\s\S]*?)\)\s*\)/i,
  );
  if (!checkMatch?.[1]) {
    throw new Error(
      "No se encontró el CHECK consent_sessions_state_check en 0008. ¿Cambió la migración?",
    );
  }

  // Extrae cada literal entre comillas simples: 'pending', 'both_accepted', ...
  const literals = [...checkMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  expect(literals.length).toBeGreaterThan(0);
  return new Set(literals);
}

/**
 * Fake client que captura el `state` insertado por openConsentSession.
 */
function makeInsertCapturingClient(captured: { state?: string }): DbClient {
  return {
    from(_table: string) {
      return {
        insert(values: Record<string, unknown>) {
          captured.state = values["state"] as string;
          return {
            select(_cols?: string) {
              return {
                single<T>() {
                  return Promise.resolve({
                    data: { id: "11111111-0000-4000-8000-000000000001" } as T,
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
    rpc() {
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  } as unknown as DbClient;
}

describe("consent_sessions.state — contrato contra el CHECK de 0008", () => {
  it("el conjunto CONSENT_SESSION_STATES coincide EXACTAMENTE con el CHECK de la migración", () => {
    const allowed = readAllowedStatesFromMigration();
    const declared = new Set<string>(Object.values(CONSENT_SESSION_STATES));

    // Mismo tamaño y mismos miembros: ni de más ni de menos.
    expect(declared).toEqual(allowed);
  });

  it("openConsentSession inserta un state permitido por el CHECK (no 'pending_a')", async () => {
    const allowed = readAllowedStatesFromMigration();
    const captured: { state?: string } = {};
    const repo = createConsentRepo(makeInsertCapturingClient(captured));

    await repo.openConsentSession({
      matchId: "22222222-0000-4000-8000-000000000002",
      searcherChannelId: "33333333-0000-4000-8000-000000000003",
      registrantChannelId: "44444444-0000-4000-8000-000000000004",
    });

    expect(captured.state).toBeDefined();
    // El estado inicial debe ser 'pending' y estar en el conjunto del CHECK.
    expect(captured.state).toBe("pending");
    expect(allowed.has(captured.state!)).toBe(true);
    // Regresión explícita: 'pending_a' NO está permitido por 0008.
    expect(allowed.has("pending_a")).toBe(false);
  });
});
