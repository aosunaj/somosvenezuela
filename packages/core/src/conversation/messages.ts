import type { EstadoPersona } from "../enums.js";
import type {
  OwnedPerson,
  PublicNeed,
  PublicPerson,
  PublicPet,
  PublicZone,
} from "../schemas.js";

/** Etiquetas humanas y claras para el estado de un registro (sin jerga). */
const ESTADO_LABEL: Record<EstadoPersona, string> = {
  desaparecida: "desaparecida",
  encontrada_viva: "encontrada con vida",
  encontrada_herida: "encontrada herida",
  fallecida: "fallecida",
  reunida: "reunida",
  a_salvo: "a salvo",
};

// Textos de cara al usuario, en espanol neutral (sin voseo) y claros para gente
// no tecnica. Lema interno: "Nadie se queda atras." (CLAUDE.md, guardrails).
//
// Esta capa NO contiene logica de flujo: solo construye cadenas y teclados.
// Mantenerla separada permite testear la maquina por su comportamiento y, en el
// futuro, traducir o ajustar el tono sin tocar el reducer.

/** Etiquetas de los botones del menu principal y de confirmacion. */
export const BUTTON = {
  registrar: "Registrar persona",
  buscar: "Buscar persona",
  registrarMascota: "Registrar mascota",
  buscarMascota: "Buscar mascota",
  zonas: "Puntos de encuentro",
  necesidades: "Necesidades",
  rescatado: "Marcar como encontrada",
  borrar: "Borrar mi registro",
  ayuda: "Ayuda",
  confirmar: "Confirmar",
  cancelar: "Cancelar",
  omitir: "Omitir",
  noConectar: "No, volver al inicio",
} as const;

/** Teclado del menu principal. */
export function menuButtons(): string[][] {
  return [
    [BUTTON.registrar, BUTTON.buscar],
    [BUTTON.registrarMascota, BUTTON.buscarMascota],
    [BUTTON.zonas, BUTTON.necesidades],
    [BUTTON.rescatado],
    [BUTTON.borrar],
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
  "- Ver los puntos de encuentro y las zonas.\n" +
  "- Ver las necesidades de cada zona.\n" +
  "- Marcar como encontrada con vida a una persona que registraste.\n" +
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

/**
 * Mensaje final del registro de persona. Si el backend devolvio un id, se lo
 * entregamos al usuario para que pueda BORRAR su registro despues (principio #5,
 * derecho al borrado): "Borrar mi registro" pide ese codigo. El id de la persona
 * NO es dato de contacto, asi que mostrarlo no viola el guardrail #1.
 */
export function registerDone(id?: string): string {
  const base =
    "Registrado. Gracias por ayudar a que nadie se quede atras. " +
    "Avisaremos en cuanto haya una coincidencia.";
  if (id === undefined || id === "") return base;
  return (
    "Registrado. Guarda este codigo por si quieres borrar el registro luego: " +
    `${id}. Avisaremos en cuanto haya una coincidencia.`
  );
}

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

// ── Registro de mascota ──────────────────────────────────────────────────────

export const REGISTER_PET_ASK_NOMBRE =
  "Vamos a registrar una mascota. ¿Como se llama? Si no tiene nombre, pulsa Omitir.";

export const REGISTER_PET_ASK_TIPO =
  "¿Que tipo de animal es? (perro, gato...). Si no lo sabes, pulsa Omitir.";

export const REGISTER_PET_ASK_RAZA =
  "¿De que raza es? Si no la conoces, pulsa Omitir.";

export const REGISTER_PET_ASK_ZONA =
  "¿En que zona se le vio por ultima vez? Si no lo sabes, pulsa Omitir.";

export const REGISTER_PET_INVALID_TEXTO =
  "Ese dato quedo vacio. Escribe algo, o pulsa Omitir para dejarlo en blanco.";

/**
 * Aviso cuando la mascota quedo sin ningun dato (nombre, tipo, raza y zona vacios):
 * un registro asi no sirve para buscar, asi que re-pedimos al menos un dato.
 */
export const REGISTER_PET_EMPTY =
  "Necesitamos al menos un dato para poder buscar a la mascota. " +
  "Cuentanos su nombre, tipo, raza o zona.";

export const REGISTER_PET_FAILED =
  "No pudimos guardar la mascota ahora mismo. Por favor, intentalo de nuevo en un momento.";

/**
 * Mensaje final del registro de mascota. Como en personas, si el backend devolvio
 * un id se lo entregamos para que pueda borrar el registro luego (principio #5).
 * El id de la mascota NO es dato de contacto (guardrail #1).
 */
export function registerPetDone(id?: string): string {
  const base =
    "Registrada. Gracias por ayudar a reunir a las mascotas con sus familias. " +
    "Avisaremos en cuanto haya una coincidencia.";
  if (id === undefined || id === "") return base;
  return (
    "Registrada. Guarda este codigo por si quieres borrar el registro luego: " +
    `${id}. Avisaremos en cuanto haya una coincidencia.`
  );
}

/** Resumen del registro de mascota antes de confirmar. No incluye dato de contacto. */
export function petSummary(draft: {
  nombre?: string | null;
  tipo?: string | null;
  raza?: string | null;
  zona?: string | null;
}): string {
  return (
    "Revisa los datos de la mascota antes de guardar:\n" +
    `- Nombre: ${orDash(draft.nombre)}\n` +
    `- Tipo: ${orDash(draft.tipo)}\n` +
    `- Raza: ${orDash(draft.raza)}\n` +
    `- Zona: ${orDash(draft.zona)}\n\n` +
    "¿Confirmas el registro de la mascota?"
  );
}

// ── Busqueda guiada de persona ───────────────────────────────────────────────
//
// Espeja el flujo de REGISTRAR: pregunta paso a paso (nombre -> apellidos -> edad
// -> zona -> senas), cada paso SALTEABLE con Omitir. Mas campos estructurados = mejor
// parecido (el matcher pondera nombre, zona y descripcion). Tono calido y claro.

export const SEARCH_ASK_NOMBRE =
  "Vamos a buscar a una persona. ¿Cual es su nombre? Si no lo sabes, pulsa Omitir.";

export const SEARCH_ASK_APELLIDOS =
  "¿Cuales son sus apellidos? Si no los sabes, pulsa Omitir.";

export const SEARCH_ASK_EDAD =
  "¿Que edad tiene, aproximadamente? Escribe un numero, o pulsa Omitir si no la conoces.";

export const SEARCH_INVALID_EDAD =
  "Esa edad no es valida. Escribe un numero entre 0 y 129, o pulsa Omitir.";

export const SEARCH_ASK_ZONA =
  "¿En que zona se le vio por ultima vez? Si no lo sabes, pulsa Omitir.";

export const SEARCH_ASK_DESCRIPCION =
  "Cuentanos senas que ayuden a reconocerla (ropa, estatura, contexto). " +
  "Si no tienes datos, pulsa Omitir.";

export const SEARCH_INVALID_TEXTO =
  "Ese dato quedo vacio. Escribe algo, o pulsa Omitir para dejarlo en blanco.";

/**
 * Aviso cuando la busqueda quedo SIN ningun dato (todo omitido): no buscamos con
 * vacio. Re-pedimos amablemente al menos un dato para poder buscar.
 */
export const SEARCH_EMPTY =
  "Necesitamos al menos un dato para poder buscar. " +
  "Cuentanos su nombre, apellidos, zona o alguna sena.";

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
    // Honestidad: mostramos un PARECIDO, nunca una certeza (guardrail #4). El bot
    // sugiere "posible coincidencia"; quien busca decide.
    const score =
      typeof r.score === "number"
        ? ` · posible coincidencia · parecido: ${Math.round(r.score * 100)}%`
        : "";
    return (
      `${i + 1}. ${r.nombre}${apellidos}${zona}\n` +
      `   Estado: ${r.estado} · Fuente: ${r.fuente} · Verificacion: ${r.verificacion}${score}`
    );
  });
  return [header, ...lines].join("\n");
}

/**
 * Invitacion a CONECTAR tras mostrar resultados de personas. El buscador elige UNA
 * persona TOCANDO el boton con su numero (1, 2...); su consentimiento es sincrono
 * (esta aqui). Para no conectar, toca "No, volver al inicio". El numero es el de la
 * LISTA (no un telefono): lo decimos explicito porque la confusion con el telefono
 * dejaba a la gente colgada. No expone dato de contacto alguno (guardrail #1).
 */
export function searchConnectPrompt(count: number): string {
  // El "(del 1 al 1)" cuando hay UNA sola coincidencia no se entiende; lo evitamos.
  const elige =
    count === 1
      ? "Si es la persona que buscas y quieres que les ayudemos a reunirse, toca el boton 1."
      : "Si reconoces a alguien y quieres que les ayudemos a reunirse, toca el boton con su " +
        `numero de la lista (del 1 al ${count}).`;
  return (
    `${elige} Le avisaremos a quien lo registro para pedirle permiso; ` +
    "nadie comparte su contacto sin el si de ambas partes.\n" +
    'Si prefieres no conectar ahora, toca "No, volver al inicio".'
  );
}

/**
 * Teclado para elegir a quien conectar: un boton por cada coincidencia (1, 2...),
 * en filas de tres, mas un boton para volver sin conectar. Tocar elimina la
 * ambiguedad con "su numero" (que la gente confundia con un telefono).
 */
export function connectButtons(count: number): string[][] {
  const numbers = Array.from({ length: count }, (_, i) => String(i + 1));
  const rows: string[][] = [];
  for (let i = 0; i < numbers.length; i += 3) {
    rows.push(numbers.slice(i, i + 3));
  }
  rows.push([BUTTON.noConectar]);
  return rows;
}

export const REUNION_REQUEST_INVALID =
  "No entendi cual elegiste. Toca el boton con el numero de la persona con la que quieres " +
  'conectar (1, 2...), o "No, volver al inicio".';

/**
 * Confirmacion al buscador tras pedir el reencuentro. AUN no se comparte contacto:
 * avisamos a la otra parte y esperamos su respuesta. Mensaje calido y honesto.
 */
export const REUNION_REQUESTED =
  "Listo. Le avisamos a quien registro a esa persona y le pedimos permiso para conectarlos. " +
  "Si acepta, te pondremos en contacto. Gracias por confiar en SomosVenezuela: nadie se queda atras.";

/**
 * Respuesta cuando la persona elegida es MENOR (guardrail #2 antitrata). No se conecta
 * de forma automatica: este caso lo gestiona una entidad verificada. Tono cuidadoso.
 */
export const REUNION_MINOR_BLOCKED =
  "Para proteger a los menores de edad, este caso no se conecta de forma automatica. " +
  "Una entidad verificada se encargara de acompañar el reencuentro de forma segura. " +
  "Gracias por tu comprension.";

/**
 * Fallo generico al iniciar el reencuentro. No revela si el registro existe ni de
 * quien es (guardrail #1): un mensaje neutro y amable.
 */
export const REUNION_REQUEST_FAILED =
  "No pudimos iniciar la conexion ahora mismo. Por favor, intentalo de nuevo en un momento.";

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
    // Honestidad: mostramos un PARECIDO, nunca una certeza (guardrail #4).
    const score =
      typeof r.score === "number"
        ? ` · posible coincidencia · parecido: ${Math.round(r.score * 100)}%`
        : "";
    return (
      `${i + 1}. ${nombre}${tipo}${raza}${zona}\n` +
      `   Estado: ${r.estado} · Fuente: ${r.fuente} · Verificacion: ${r.verificacion}${score}`
    );
  });
  return [header, ...lines].join("\n");
}

// ── Mapa: zonas (puntos de encuentro) ────────────────────────────────────────

export const ZONES_EMPTY =
  "Todavia no hay puntos de encuentro publicados. En cuanto se agreguen, los veras aqui. " +
  "Gracias por estar pendiente.";

/**
 * Formatea el listado de zonas (puntos de encuentro) del mapa para mostrarlo en el
 * chat. Vista publica `PublicZone`: nombre y estado. NUNCA incluye dato de contacto
 * ni la identidad de quien actualizo la zona (guardrail #1).
 */
export function zonesList(zones: readonly PublicZone[]): string {
  const header = `Puntos de encuentro (${zones.length} ${
    zones.length === 1 ? "zona" : "zonas"
  }):`;
  const lines = zones.map(
    (z) => `• ${z.nombre} — estado: ${z.estado == null || z.estado === "" ? "sin dato" : z.estado}`,
  );
  return [header, ...lines].join("\n");
}

// ── Mapa: necesidades por zona ───────────────────────────────────────────────

export const NEEDS_EMPTY =
  "Por ahora no hay necesidades publicadas. En cuanto se registren, las veras aqui. " +
  "Gracias por querer ayudar.";

/** Orden de prioridad para mostrar las necesidades: lo mas urgente primero. */
const URGENCIA_ORDEN: Record<PublicNeed["urgencia"], number> = {
  critica: 0,
  alta: 1,
  media: 2,
  baja: 3,
};

/**
 * Formatea el listado de necesidades por zona. Las ORDENA por urgencia (critica
 * primero) para que lo mas grave salte a la vista. Vista publica `PublicNeed`: tipo,
 * urgencia, descripcion y la referencia de zona. Sin dato de contacto (guardrail #1).
 */
export function needsList(needs: readonly PublicNeed[]): string {
  const header = `Necesidades (${needs.length} ${
    needs.length === 1 ? "registro" : "registros"
  }):`;
  const ordered = [...needs].sort(
    (a, b) => URGENCIA_ORDEN[a.urgencia] - URGENCIA_ORDEN[b.urgencia],
  );
  const lines = ordered.map((n) => {
    const descripcion = n.descripcion == null || n.descripcion === "" ? "(sin detalle)" : n.descripcion;
    return `• [${n.urgencia}] ${n.tipo}: ${descripcion} (zona: ${n.zone_id})`;
  });
  return [header, ...lines].join("\n");
}

// ── Tus registros (lista del dueno para marcar / borrar SIN pegar codigos) ────
//
// Antes el bot pedia "pega el identificador". Nadie en una emergencia guarda esos
// codigos: era un muro. Ahora el bot LISTA los registros que creaste desde este chat
// y eliges TOCANDO un numero. El backend ya sabe cuales son tuyos por el canal.

/**
 * Lista numerada de TUS registros (vista del dueno). Muestra nombre, zona y estado
 * en lenguaje claro. No incluye dato de contacto alguno (guardrail #1).
 */
export function myPersonsList(persons: readonly OwnedPerson[]): string {
  const header = "Estos son tus registros:";
  const lines = persons.map((p, i) => {
    const apellidos = p.apellidos ? ` ${p.apellidos}` : "";
    const zona = p.zona ? `, zona: ${p.zona}` : "";
    return `${i + 1}. ${p.nombre}${apellidos}${zona} — estado: ${ESTADO_LABEL[p.estado]}`;
  });
  return [header, ...lines].join("\n");
}

/**
 * Teclado para elegir uno de TUS registros: un boton por registro (1, 2...), en filas
 * de tres, mas Cancelar. Tocar evita pegar codigos (lo que antes trababa a la gente).
 */
export function pickPersonButtons(count: number): string[][] {
  const numbers = Array.from({ length: count }, (_, i) => String(i + 1));
  const rows: string[][] = [];
  for (let i = 0; i < numbers.length; i += 3) {
    rows.push(numbers.slice(i, i + 3));
  }
  rows.push([BUTTON.cancelar]);
  return rows;
}

// ── Borrado ──────────────────────────────────────────────────────────────────

export const DELETE_PICK =
  "Toca el numero del registro que quieres borrar, o pulsa Cancelar.";

/** Cuando el canal no tiene registros propios en este chat: nada que borrar. */
export const DELETE_NONE =
  "No encontramos registros tuyos en este chat. Solo puedes borrar los que registraste " +
  "desde aqui. Si necesitas algo mas, escribe /ayuda.";

export const DELETE_PICK_INVALID =
  "No entendi cual elegiste. Toca el numero de la lista, o pulsa Cancelar.";

/** Pide confirmacion antes de borrar; muestra el NOMBRE elegido (no un codigo). */
export function deleteConfirm(nombre: string): string {
  return (
    `Vas a borrar el registro de ${nombre}.\n` +
    "Esta accion no se puede deshacer. ¿Confirmas el borrado?"
  );
}

export const DELETE_DONE =
  "Registro borrado. Si necesitas algo mas, aqui estamos.";

export const DELETE_FAILED =
  "No pudimos borrar el registro ahora mismo. Por favor, intentalo de nuevo en un momento.";

// ── Rescatado (el dueno marca su registro como encontrado con vida) ──────────

export const MARK_FOUND_PICK =
  "Que alegria. Toca el numero del registro que quieres marcar como encontrado con vida, " +
  "o pulsa Cancelar.";

/** Cuando el canal no tiene registros propios en este chat: nada que marcar. */
export const MARK_FOUND_NONE =
  "No encontramos registros tuyos en este chat. Solo puedes marcar los que registraste " +
  "desde aqui. Si necesitas algo mas, escribe /ayuda.";

export const MARK_FOUND_PICK_INVALID =
  "No entendi cual elegiste. Toca el numero de la lista, o pulsa Cancelar.";

/**
 * Pide confirmacion antes de marcar como encontrada. Aclara que es un reporte del
 * dueno (sin verificar): la confirmacion oficial la hace una entidad verificada
 * aparte. Muestra el NOMBRE elegido (no un codigo).
 */
export function markFoundConfirm(nombre: string): string {
  return (
    `Vas a marcar a ${nombre} como ENCONTRADO con vida.\n` +
    "Quedara como reporte tuyo (sin verificar) hasta que una entidad lo confirme. " +
    "¿Confirmas?"
  );
}

export const MARK_FOUND_DONE =
  "Marcado como encontrado con vida. Gracias por avisar: nadie se queda atras.";

export const MARK_FOUND_FAILED =
  "No pudimos marcar el registro ahora mismo. Por favor, intentalo de nuevo en un momento.";

// ── Búsqueda — pregunta de menor (R2-4a) ────────────────────────────────────
//
// CRÍTICO (guardrail #2 / R2-4): la búsqueda DEBE preguntar si la persona es
// menor de forma EXPLÍCITA. `es_menor` nunca tiene default silencioso en la
// recolección conversacional; el backend lo confirma server-side al crear la
// búsqueda (judgment-r3 item 5).

export const SEARCH_ASK_MENOR =
  "Una pregunta importante: ¿la persona que buscas es menor de edad (menos de 18 años)?";

export const SEARCH_MENOR_INVALID =
  "Por favor, responde Sí o No. ¿La persona que buscas es menor de 18 años?";

/** Teclado para la pregunta de menor: Sí / No. */
export function menorButtons(): string[][] {
  return [["Sí", "No"]];
}
