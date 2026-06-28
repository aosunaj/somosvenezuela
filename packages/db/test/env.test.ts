import { describe, expect, it } from "vitest";
import {
  DbConfigError,
  loadDbEnv,
  loadMigrationEnv,
} from "../src/env.js";

// Valores SINTETICOS — no son secretos reales.
const FAKE_URL = "https://proyecto-de-prueba.supabase.co";
const FAKE_KEY = "service-role-de-prueba-no-real";

describe("loadDbEnv", () => {
  it("valida y devuelve la config cuando estan presentes", () => {
    const env = loadDbEnv({
      SUPABASE_URL: FAKE_URL,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY,
    });
    expect(env.SUPABASE_URL).toBe(FAKE_URL);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(FAKE_KEY);
  });

  it("lanza DbConfigError claro cuando faltan variables", () => {
    expect(() => loadDbEnv({})).toThrow(DbConfigError);
  });

  it("el mensaje de error nombra la variable pero NO filtra su valor", () => {
    try {
      loadDbEnv({ SUPABASE_URL: "no-es-una-url", SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY });
      expect.unreachable("deberia haber lanzado");
    } catch (err) {
      expect(err).toBeInstanceOf(DbConfigError);
      const message = (err as DbConfigError).message;
      expect(message).toContain("SUPABASE_URL");
      // El valor secreto de la key nunca debe aparecer en el mensaje.
      expect(message).not.toContain(FAKE_KEY);
    }
  });

  it("rechaza una SUPABASE_URL invalida", () => {
    expect(() =>
      loadDbEnv({ SUPABASE_URL: "ftp://malo", SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY }),
    ).toThrow(DbConfigError);
  });
});

describe("loadMigrationEnv", () => {
  it("valida DATABASE_URL cuando esta presente", () => {
    const env = loadMigrationEnv({ DATABASE_URL: "postgres://user:pass@host:5432/db" });
    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("lanza DbConfigError cuando falta DATABASE_URL", () => {
    expect(() => loadMigrationEnv({})).toThrow(DbConfigError);
  });
});
