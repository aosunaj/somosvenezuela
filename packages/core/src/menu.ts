// Menu principal del bot — 8 entradas en el orden especificado (Slice M, spec-delta).
// Los identificadores siguen convenciones en ingles; los labels son en espanol neutro.
// Este modulo es PURO: no importa red, BD ni efectos. Solo datos y helpers.

// ── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Identificadores internos de las 8 entradas del menu principal.
 * Const object para tener values en runtime (TypeScript skill pattern).
 */
export const MENU_ENTRY_IDS = {
  SEARCH_REGISTER_PERSON: "search_register_person",
  PERSON_RESCUED: "person_rescued",
  SEARCH_REGISTER_PET: "search_register_pet",
  PET_RESCUED: "pet_rescued",
  MEETING_POINTS: "meeting_points",
  NEEDS: "needs",
  DELETE_RECORD: "delete_record",
  HELP: "help",
} as const;

/** Union de todos los ids de entradas del menu. */
export type MenuEntryId = (typeof MENU_ENTRY_IDS)[keyof typeof MENU_ENTRY_IDS];

/** Una entrada del menu: id interno, label en espanol y callbackData para el teclado inline. */
export interface MenuEntry {
  readonly id: MenuEntryId;
  /** Texto visible al usuario (en espanol neutro). */
  readonly label: string;
  /**
   * Dato que Telegram envia al bot cuando el usuario toca el boton inline.
   * Prefijo "menu:" para que el handler lo reconozca sin ambiguedad.
   */
  readonly callbackData: string;
}

/** Boton inline para el teclado de Telegram (texto visible + callbackData). */
export interface InlineButton {
  readonly text: string;
  readonly callbackData: string;
}

// ── Datos del menu ────────────────────────────────────────────────────────────

/**
 * Las 8 entradas del menu en el orden exacto del spec (Slice M):
 *  1. Buscar/Registrar persona
 *  2. Persona rescatada
 *  3. Buscar/Registrar mascota
 *  4. Mascota rescatada
 *  5. Puntos de encuentro
 *  6. Necesidades
 *  7. Borrar mi registro
 *  8. Ayuda
 */
export const MENU_ENTRIES: readonly MenuEntry[] = [
  {
    id: MENU_ENTRY_IDS.SEARCH_REGISTER_PERSON,
    label: "Buscar / Registrar persona",
    callbackData: "menu:search_register_person",
  },
  {
    id: MENU_ENTRY_IDS.PERSON_RESCUED,
    label: "Persona rescatada",
    callbackData: "menu:person_rescued",
  },
  {
    id: MENU_ENTRY_IDS.SEARCH_REGISTER_PET,
    label: "Buscar / Registrar mascota",
    callbackData: "menu:search_register_pet",
  },
  {
    id: MENU_ENTRY_IDS.PET_RESCUED,
    label: "Mascota rescatada",
    callbackData: "menu:pet_rescued",
  },
  {
    id: MENU_ENTRY_IDS.MEETING_POINTS,
    label: "Puntos de encuentro",
    callbackData: "menu:meeting_points",
  },
  {
    id: MENU_ENTRY_IDS.NEEDS,
    label: "Necesidades",
    callbackData: "menu:needs",
  },
  {
    id: MENU_ENTRY_IDS.DELETE_RECORD,
    label: "Borrar mi registro",
    callbackData: "menu:delete_record",
  },
  {
    id: MENU_ENTRY_IDS.HELP,
    label: "Ayuda",
    callbackData: "menu:help",
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Genera el teclado inline del menu principal: una fila por entrada (un boton cada una).
 * Devuelve `InlineButton[][]` que el adaptador convierte al formato de Telegram.
 *
 * Una entrada por fila facilita la lectura en pantallas pequeñas (movil en emergencia).
 */
export function menuInlineButtons(): InlineButton[][] {
  return MENU_ENTRIES.map((entry) => [
    { text: entry.label, callbackData: entry.callbackData },
  ]);
}

/**
 * Resuelve un callbackData recibido de Telegram al MenuEntryId correspondiente.
 * Devuelve null si el callbackData no corresponde a ninguna entrada del menu.
 */
export function resolveMenuCallbackData(callbackData: string): MenuEntryId | null {
  const entry = MENU_ENTRIES.find((e) => e.callbackData === callbackData);
  return entry?.id ?? null;
}
