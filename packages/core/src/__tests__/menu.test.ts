import { describe, expect, it } from "vitest";
import {
  MENU_ENTRIES,
  MENU_ENTRY_IDS,
  menuInlineButtons,
  type MenuEntry,
  type MenuEntryId,
} from "../menu.js";

// Tests TDD para el menu principal de 8 entradas (Slice M, spec-delta nucleo-ux).
// Datos sinteticos — sin PII real.

describe("MENU_ENTRIES", () => {
  it("debe tener exactamente 8 entradas", () => {
    expect(MENU_ENTRIES).toHaveLength(8);
  });

  it("debe tener ids unicos", () => {
    const ids = MENU_ENTRIES.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(8);
  });

  it("debe tener el orden correcto de entradas", () => {
    const ids = MENU_ENTRIES.map((e) => e.id);
    expect(ids).toEqual([
      "search_register_person",
      "person_rescued",
      "search_register_pet",
      "pet_rescued",
      "meeting_points",
      "needs",
      "delete_record",
      "help",
    ]);
  });

  it("cada entrada debe tener label (string no vacio) y callbackData (string no vacio)", () => {
    for (const entry of MENU_ENTRIES) {
      expect(entry.label).toBeTruthy();
      expect(typeof entry.label).toBe("string");
      expect(entry.callbackData).toBeTruthy();
      expect(typeof entry.callbackData).toBe("string");
    }
  });

  it("las labels deben estar en espanol", () => {
    const labels = MENU_ENTRIES.map((e) => e.label);
    expect(labels[0]).toMatch(/buscar|registrar|persona/i);
    expect(labels[1]).toMatch(/rescatad|persona/i);
    expect(labels[2]).toMatch(/buscar|registrar|mascota/i);
    expect(labels[3]).toMatch(/rescatad|mascota/i);
    expect(labels[4]).toMatch(/punto|encuentro/i);
    expect(labels[5]).toMatch(/necesidad/i);
    expect(labels[6]).toMatch(/borrar|registro/i);
    expect(labels[7]).toMatch(/ayuda/i);
  });
});

describe("MENU_ENTRY_IDS", () => {
  it("debe contener todos los 8 ids como const", () => {
    expect(Object.keys(MENU_ENTRY_IDS)).toHaveLength(8);
    expect(MENU_ENTRY_IDS.SEARCH_REGISTER_PERSON).toBe("search_register_person");
    expect(MENU_ENTRY_IDS.PERSON_RESCUED).toBe("person_rescued");
    expect(MENU_ENTRY_IDS.SEARCH_REGISTER_PET).toBe("search_register_pet");
    expect(MENU_ENTRY_IDS.PET_RESCUED).toBe("pet_rescued");
    expect(MENU_ENTRY_IDS.MEETING_POINTS).toBe("meeting_points");
    expect(MENU_ENTRY_IDS.NEEDS).toBe("needs");
    expect(MENU_ENTRY_IDS.DELETE_RECORD).toBe("delete_record");
    expect(MENU_ENTRY_IDS.HELP).toBe("help");
  });
});

describe("menuInlineButtons", () => {
  it("debe devolver un arreglo de filas de botones inline", () => {
    const buttons = menuInlineButtons();
    expect(Array.isArray(buttons)).toBe(true);
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("cada fila debe ser un arreglo de InlineButton con text y callbackData", () => {
    const buttons = menuInlineButtons();
    for (const row of buttons) {
      expect(Array.isArray(row)).toBe(true);
      for (const btn of row) {
        expect(btn).toHaveProperty("text");
        expect(btn).toHaveProperty("callbackData");
        expect(typeof btn.text).toBe("string");
        expect(typeof btn.callbackData).toBe("string");
      }
    }
  });

  it("debe contener todos los 8 entries como botones", () => {
    const buttons = menuInlineButtons();
    const allButtons = buttons.flat();
    const callbackDatas = allButtons.map((b) => b.callbackData);
    for (const entry of MENU_ENTRIES) {
      expect(callbackDatas).toContain(entry.callbackData);
    }
  });
});

describe("MenuEntry type", () => {
  it("debe satisfacer la forma correcta", () => {
    const entry: MenuEntry = {
      id: "search_register_person",
      label: "Buscar / Registrar persona",
      callbackData: "menu:search_register_person",
    };
    expect(entry.id).toBe("search_register_person");
  });
});

describe("MenuEntryId type", () => {
  it("MENU_ENTRY_IDS values deben satisfacer el tipo MenuEntryId", () => {
    const id: MenuEntryId = MENU_ENTRY_IDS.SEARCH_REGISTER_PERSON;
    expect(id).toBe("search_register_person");
  });
});
