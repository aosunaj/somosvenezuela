import { describe, expect, it } from "vitest";
import {
  publicRowToPublicPerson,
  publicRowToPublicPet,
  rowToPerson,
  rowToPet,
  rowToSearch,
} from "../src/mappers.js";
import type {
  PersonPublicRow,
  PersonRow,
  PetPublicRow,
  PetRow,
  SearchRow,
} from "../src/types.js";

// Datos SINTETICOS — sin PII real (guardrail #1).
const SYNTH_CONTACT = "c0000000-0000-4000-8000-000000000001";

const personRow: PersonRow = {
  id: "a0000000-0000-4000-8000-000000000001",
  nombre: "Persona de Prueba 1",
  apellidos: "Apellido Ficticio",
  edad: 34,
  zona: "Zona Sintetica Norte",
  descripcion: "Datos de prueba",
  foto_url: null,
  estado: "desaparecida",
  fuente: "propia",
  verificacion: "sin_verificar",
  contact_id: SYNTH_CONTACT,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const personPublicRow: PersonPublicRow = {
  id: personRow.id,
  nombre: personRow.nombre,
  apellidos: personRow.apellidos,
  edad: personRow.edad,
  zona: personRow.zona,
  descripcion: personRow.descripcion,
  foto_url: personRow.foto_url,
  estado: personRow.estado,
  fuente: personRow.fuente,
  verificacion: personRow.verificacion,
  created_at: personRow.created_at,
  updated_at: personRow.updated_at,
};

const petRow: PetRow = {
  id: "b0000000-0000-4000-8000-000000000001",
  nombre: "Mascota de Prueba 1",
  tipo: "perro",
  raza: "mestizo",
  zona: "Zona Sintetica Norte",
  foto_url: null,
  estado: "desaparecida",
  fuente: "propia",
  verificacion: "sin_verificar",
  contact_id: SYNTH_CONTACT,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("rowToPerson / rowToPet (tabla base, interno)", () => {
  it("rowToPerson conserva contact_id (uso interno)", () => {
    const person = rowToPerson(personRow);
    expect(person.contact_id).toBe(SYNTH_CONTACT);
    expect(person.nombre).toBe("Persona de Prueba 1");
  });

  it("rowToPet conserva contact_id (uso interno)", () => {
    const pet = rowToPet(petRow);
    expect(pet.contact_id).toBe(SYNTH_CONTACT);
  });
});

describe("publicRowToPublicPerson (vista publica)", () => {
  it("la salida NO contiene contact_id", () => {
    const publica = publicRowToPublicPerson(personPublicRow);
    expect("contact_id" in publica).toBe(false);
    expect(JSON.stringify(publica)).not.toContain(SYNTH_CONTACT);
  });

  it("conserva fuente y verificacion (spec 01: visibles)", () => {
    const publica = publicRowToPublicPerson({
      ...personPublicRow,
      fuente: "cruz_roja",
      verificacion: "verificada",
    });
    expect(publica.fuente).toBe("cruz_roja");
    expect(publica.verificacion).toBe("verificada");
  });

  it("salvaguarda: aunque la fila trajera contact_id, no sale", () => {
    // Simula una fila contaminada con contact_id (no deberia pasar por la vista).
    const contaminada = { ...personPublicRow, contact_id: SYNTH_CONTACT } as PersonPublicRow;
    const publica = publicRowToPublicPerson(contaminada);
    expect("contact_id" in publica).toBe(false);
    expect(JSON.stringify(publica)).not.toContain(SYNTH_CONTACT);
  });
});

describe("publicRowToPublicPet (vista publica)", () => {
  it("la salida NO contiene contact_id", () => {
    const petPublicRow: PetPublicRow = {
      id: petRow.id,
      nombre: petRow.nombre,
      tipo: petRow.tipo,
      raza: petRow.raza,
      zona: petRow.zona,
      foto_url: petRow.foto_url,
      estado: petRow.estado,
      fuente: petRow.fuente,
      verificacion: petRow.verificacion,
      created_at: petRow.created_at,
      updated_at: petRow.updated_at,
    };
    const publica = publicRowToPublicPet(petPublicRow);
    expect("contact_id" in publica).toBe(false);
    expect(JSON.stringify(publica)).not.toContain(SYNTH_CONTACT);
  });
});

describe("rowToSearch", () => {
  it("mapea la fila completa (buscador_contact_id es interno)", () => {
    const searchRow: SearchRow = {
      id: "e0000000-0000-4000-8000-000000000001",
      tipo: "persona",
      target_nombre: "Persona de Prueba 1",
      target_descripcion: null,
      zona: "Zona Sintetica Norte",
      buscador_contact_id: SYNTH_CONTACT,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const search = rowToSearch(searchRow);
    expect(search.tipo).toBe("persona");
    expect(search.buscador_contact_id).toBe(SYNTH_CONTACT);
  });
});
