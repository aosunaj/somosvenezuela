import { describe, expect, it } from "vitest";
import {
  aliveMessageCreateSchema,
  aliveMessageSchema,
  aliveMessageTipoSchema,
} from "../schemas.js";

// Tests TDD — schemas for alive_messages (Spec 06 Slice 1).
// Synthetic data only — no real PII in tests (guardrail).

// ── aliveMessageTipoSchema ────────────────────────────────────────────────────

describe("aliveMessageTipoSchema", () => {
  it('accepts "texto"', () => {
    expect(aliveMessageTipoSchema.parse("texto")).toBe("texto");
  });

  it('accepts "voz"', () => {
    expect(aliveMessageTipoSchema.parse("voz")).toBe("voz");
  });

  it("rejects an unknown value", () => {
    expect(() => aliveMessageTipoSchema.parse("audio")).toThrow();
  });
});

// ── aliveMessageCreateSchema ──────────────────────────────────────────────────

describe("aliveMessageCreateSchema", () => {
  it("accepts a minimal valid input (autorNombre + tipo texto + contenido)", () => {
    const result = aliveMessageCreateSchema.parse({
      autorNombre: "Juan Pérez",
      tipo: "texto",
      contenido: "Estoy vivo, estamos bien en el refugio",
    });
    expect(result.autorNombre).toBe("Juan Pérez");
    expect(result.tipo).toBe("texto");
    expect(result.contenido).toBe("Estoy vivo, estamos bien en el refugio");
    expect(result.zona).toBeUndefined();
    expect(result.personId).toBeUndefined();
  });

  it("accepts all optional fields: zona and personId", () => {
    const result = aliveMessageCreateSchema.parse({
      autorNombre: "Ana Torres",
      tipo: "texto",
      contenido: "Todos en casa, sin heridos",
      zona: "La Guaira",
      personId: "a1b2c3d4-e5f6-4aaa-8bbb-ccccddddeeee",
    });
    expect(result.zona).toBe("La Guaira");
    expect(result.personId).toBe("a1b2c3d4-e5f6-4aaa-8bbb-ccccddddeeee");
  });

  it("accepts tipo voz (stored as-is in Slice 1, no Cloudinary upload)", () => {
    expect(() =>
      aliveMessageCreateSchema.parse({
        autorNombre: "Luis Gómez",
        tipo: "voz",
        contenido: "nota-de-voz-placeholder",
      }),
    ).not.toThrow();
  });

  it("rejects empty autorNombre", () => {
    expect(() =>
      aliveMessageCreateSchema.parse({
        autorNombre: "",
        tipo: "texto",
        contenido: "Estoy bien",
      }),
    ).toThrow();
  });

  it("rejects whitespace-only autorNombre (min 1 after trim)", () => {
    expect(() =>
      aliveMessageCreateSchema.parse({
        autorNombre: "   ",
        tipo: "texto",
        contenido: "Estoy bien",
      }),
    ).toThrow();
  });

  it("rejects empty contenido", () => {
    expect(() =>
      aliveMessageCreateSchema.parse({
        autorNombre: "Juan Pérez",
        tipo: "texto",
        contenido: "",
      }),
    ).toThrow();
  });

  it("rejects bad tipo value", () => {
    expect(() =>
      aliveMessageCreateSchema.parse({
        autorNombre: "Juan Pérez",
        tipo: "imagen",
        contenido: "Estoy bien",
      }),
    ).toThrow();
  });

  it("rejects personId that is not a valid uuid", () => {
    expect(() =>
      aliveMessageCreateSchema.parse({
        autorNombre: "Juan Pérez",
        tipo: "texto",
        contenido: "Estoy bien",
        personId: "not-a-uuid",
      }),
    ).toThrow();
  });
});

// ── aliveMessageSchema (full record) ─────────────────────────────────────────

describe("aliveMessageSchema", () => {
  it("accepts a complete valid record", () => {
    const record = {
      id: "a1b2c3d4-e5f6-4aaa-8bbb-ccccddddeeee",
      autorNombre: "Carlos Díaz",
      tipo: "texto",
      contenido: "Sobrevivimos, estamos en Caracas",
      zona: "Caracas",
      personId: null,
      entregado: false,
      createdAt: "2026-01-15T10:00:00.000Z",
    };
    const result = aliveMessageSchema.parse(record);
    expect(result.id).toBe(record.id);
    expect(result.entregado).toBe(false);
    expect(result.createdAt).toBe(record.createdAt);
    // zona and personId are present in the full record schema
    expect(result.zona).toBe("Caracas");
    expect(result.personId).toBeNull();
  });

  it("accepts entregado=true", () => {
    const record = {
      id: "b2c3d4e5-f6a7-4bbb-8ccc-ddddeeeeffff",
      autorNombre: "María López",
      tipo: "texto",
      contenido: "Mensaje entregado a la familia",
      zona: null,
      personId: null,
      entregado: true,
      createdAt: "2026-01-15T12:00:00.000Z",
    };
    const result = aliveMessageSchema.parse(record);
    expect(result.entregado).toBe(true);
    // zona nullable, personId nullable
    expect(result.zona).toBeNull();
    expect(result.personId).toBeNull();
  });

  it("accepts a record with a non-null personId (uuid)", () => {
    const record = {
      id: "c3d4e5f6-a7b8-4ccc-8ddd-eeeeffff0000",
      autorNombre: "Pedro Rivas",
      tipo: "texto",
      contenido: "Estamos en el albergue",
      zona: "Maracaibo",
      personId: "a1b2c3d4-e5f6-4aaa-8bbb-ccccddddeeee",
      entregado: false,
      createdAt: "2026-01-16T08:00:00.000Z",
    };
    const result = aliveMessageSchema.parse(record);
    expect(result.personId).toBe("a1b2c3d4-e5f6-4aaa-8bbb-ccccddddeeee");
    expect(result.zona).toBe("Maracaibo");
  });
});

// ── aliveMessageCreateSchema — whitespace-only rejections ────────────────────

describe("aliveMessageCreateSchema — whitespace rejections", () => {
  it("rejects whitespace-only contenido (min 1 after trim)", () => {
    expect(() =>
      aliveMessageCreateSchema.parse({
        autorNombre: "Juan Pérez",
        tipo: "texto",
        contenido: "   ",
      }),
    ).toThrow();
  });
});
