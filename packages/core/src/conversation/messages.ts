import type { PublicPerson, PublicPet } from "../schemas.js";

// Textos de cara al usuario, en espanol neutral (sin voseo) y claros para gente
// no tecnica. Lema interno: "Nadie se queda atras." (CLAUDE.md, guardrails).
//
// Esta capa NO contiene logica de flujo: solo construye cadenas y teclados.
// Mantenerla separada permite testear la maquina por su comportamiento y, en el
// futuro, traducir o ajustar el tono sin tocar el reducer.

/** Etiquetas de los botones del menu principal y de confirmacion. */
export const BUTTON = {
  registrar: "Registrar persona",
  buscar: "Buscar",
  buscarMascota: "Buscar mascota",
  borrar: "Borrar mi registro",
  ayuda: "Ayuda",
  confirmar: "Confirmar",
  cancelar: "Cancelar",
  omitir: "Omitir",
} as const;

/** Teclado del menu principal. */
export function menuButtons(): string[][] {
  return [
    [BUTTON.registrar, BUTTON.buscar],
    [BUTTON.buscarMascota, BUTTON.borrar],
    [BUTTON.ayuda],
  ];
}

/** Teclado de confirmacion (confirmar / cancelar). */
export function confirmButtons(): string[][] {
  return [[BUTTON.confirmar, BUTTON.cancelar]];
}

/** Teclado para pasos opcionales: permite omitir o cancelar. */
export function skipButtons(): string[][] {
  return [[BUTTON.omitir, BUTTON.cancelar]];
}

// ── Bienvenida / ayuda ───────────────────────────────────────────────────────

export const WELCOME =
  "Hola, somos SomosVenezuela. Estamos aqui para ayudarte a buscar y reunir a quienes faltan. " +
  "Nadie se queda atras.\n\n" +
  "Elige una opcion para empezar:";

export const HELP =
  "Puedo ayudarte a:\n" +
  "- Registrar a una persona desaparecida.\n" +
  "- Buscar entre los registros existentes.\n" +
  "- Buscar una mascota perdida.\n" +
  "- Borrar un registro que hayas creado.\n\n" +
  "En cualquier momento puedes escribir /cancelar para volver al inicio.";

export const CANCELLED = "Listo, volvimos al inicio. ¿En que te ayudamos?";

export const UNKNOWN_COMMAND =
  "No reconozco esa opcion. Elige una del menu o escribe /ayuda.";

// ── Registro de persona ──────────────────────────────────────────────────────

export const REGISTER_ASK_NOMBRE =
  "Vamos a registrar a una persona. ¿Cual es su nombre?";

export const REGISTER_INVALID_NOMBRE =
  "Necesito un nombre para continuar. Por favor, escribe el nombre de la persona.";

export const REGISTER_ASK_APELLIDOS =
  "¿Cuales son sus apellidos? Si no los sabes, pulsa Omitir.";

export const REGISTER_ASK_EDAD =
  "¿Que edad tiene? Escribe un numero, o pulsa Omitir si no la conoces.";

export const REGISTER_INVALID_EDAD =
  "Esa edad no es valida. Escribe un numero entre 0 y 129, o pulsa Omitir.";

export const REGISTER_ASK_ZONA =
  "¿En que zona se le vio por ultima vez? Si no lo sabes, pulsa Omitir.";

export const REGISTER_ASK_DESCRIPCION =
  "Cuentanos senas que ayuden a reconocerla (ropa, estatura, contexto). " +
  "Si no tienes datos, pulsa Omitir.";

export const REGISTER_INVALID_TEXTO =
  "Ese dato quedo vacio. Escribe algo, o pulsa Omitir para dejarlo en blanco.";

export const REGISTER_DONE =
  "Registrado. Gracias por ayudar a que nadie se quede atras. " +
  "Avisaremos en cuanto haya una coincidencia.";

export const REGISTER_FAILED =
  "No pudimos guardar el registro ahora mismo. Por favor, intentalo de nuevo en un momento.";

/** Muestra "(sin dato)" cuando un campo opcional quedo vacio. */
function orDash(value: string | null | undefined): string {
  return value == null || value === "" ? "(sin dato)" : value;
}

/** Resumen del registro antes de confirmar. No incluye dato de contacto alguno. */
export function registerSummary(draft: {
  nombre: string;
  apellidos?: string | null;
  edad?: number | null;
  zona?: string | null;
  descripcion?: string | null;
}): string {
  return (
    "Revisa los datos antes de guardar:\n" +
    `- Nombre: ${draft.nombre}\n` +
    `- Apellidos: ${orDash(draft.apellidos)}\n` +
    `- Edad: ${draft.edad == null ? "(sin dato)" : String(draft.edad)}\n` +
    `- Zona: ${orDash(draft.zona)}\n` +
    `- Descripcion: ${orDash(draft.descripcion)}\n\n` +
    "¿Confirmas el registro?"
  );
}

// ── Busqueda ─────────────────────────────────────────────────────────────────

export const SEARCH_ASK_QUERY =
  "¿A quien buscas? Escribe un nombre, una zona o una descripcion.";

export const SEARCH_INVALID_QUERY =
  "Necesito algun dato para buscar. Escribe un nombre, una zona o una descripcion.";

export const SEARCH_NO_RESULTS =
  "No encontramos coincidencias por ahora. El registro sigue creciendo: vuelve a intentarlo mas tarde.";

export const SEARCH_FAILED =
  "No pudimos completar la busqueda ahora mismo. Por favor, intentalo de nuevo en un momento.";

/**
 * Formatea los resultados de busqueda para mostrarlos al usuario.
 * NUNCA incluye dato de contacto: recibe `PublicPerson` (sin `contact_id`).
 * Muestra nombre, zona, estado, fuente, verificacion y, si llega, el score.
 */
export function searchResults(
  results: ReadonlyArray<PublicPerson & { score?: number }>,
): string {
  const header = `Encontramos ${results.length} ${
    results.length === 1 ? "coincidencia" : "coincidencias"
  }:`;
  const lines = results.map((r, i) => {
    const apellidos = r.apellidos ? ` ${r.apellidos}` : "";
    const zona = r.zona ? `, zona: ${r.zona}` : "";
    const score =
      typeof r.score === "number" ? `, similitud: ${Math.round(r.score * 100)}%` : "";
    return (
      `${i + 1}. ${r.nombre}${apellidos}${zona}\n` +
      `   Estado: ${r.estado} · Fuente: ${r.fuente} · Verificacion: ${r.verificacion}${score}`
    );
  });
  return [header, ...lines].join("\n");
}

// ── Busqueda de mascotas ─────────────────────────────────────────────────────

export const SEARCH_PET_ASK_QUERY =
  "¿Que mascota buscas? Escribe su nombre, el tipo (perro, gato...), la raza o la zona.";

export const SEARCH_PET_INVALID_QUERY =
  "Necesito algun dato para buscar. Escribe el nombre, el tipo, la raza o la zona de la mascota.";

export const SEARCH_PET_NO_RESULTS =
  "No encontramos mascotas que coincidan por ahora. El registro sigue creciendo: vuelve a intentarlo mas tarde.";

export const SEARCH_PET_FAILED =
  "No pudimos completar la busqueda ahora mismo. Por favor, intentalo de nuevo en un momento.";

/**
 * Formatea los resultados de busqueda de mascotas para mostrarlos al usuario.
 * NUNCA incluye dato de contacto: recibe `PublicPet` (sin `contact_id`).
 * Muestra nombre, tipo, raza, zona, estado, fuente, verificacion y, si llega, el score.
 */
export function searchPetResults(
  results: ReadonlyArray<PublicPet & { score?: number }>,
): string {
  const header = `Encontramos ${results.length} ${
    results.length === 1 ? "coincidencia" : "coincidencias"
  }:`;
  const lines = results.map((r, i) => {
    const nombre = r.nombre ?? "Sin nombre";
    const tipo = r.tipo ? `, tipo: ${r.tipo}` : "";
    const raza = r.raza ? `, raza: ${r.raza}` : "";
    const zona = r.zona ? `, zona: ${r.zona}` : "";
    const score =
      typeof r.score === "number" ? `, similitud: ${Math.round(r.score * 100)}%` : "";
    return (
      `${i + 1}. ${nombre}${tipo}${raza}${zona}\n` +
      `   Estado: ${r.estado} · Fuente: ${r.fuente} · Verificacion: ${r.verificacion}${score}`
    );
  });
  return [header, ...lines].join("\n");
}

// ── Borrado ──────────────────────────────────────────────────────────────────

export const DELETE_ASK_ID =
  "Para borrar un registro necesito su identificador. Pegalo aqui tal como lo recibiste.";

export const DELETE_INVALID_ID =
  "Ese identificador no tiene el formato correcto. Revisa y vuelve a pegarlo.";

/** Pide confirmacion antes de borrar; el id se muestra para que el usuario lo verifique. */
export function deleteConfirm(personId: string): string {
  return (
    `Vas a borrar el registro ${personId}.\n` +
    "Esta accion no se puede deshacer. ¿Confirmas el borrado?"
  );
}

export const DELETE_DONE =
  "Registro borrado. Si necesitas algo mas, aqui estamos.";

export const DELETE_FAILED =
  "No pudimos borrar el registro ahora mismo. Comprueba el identificador o intentalo mas tarde.";
