import type { OwnedPerson, PersonCreate, PetCreate } from "../schemas.js";
import type { PublicNeed, PublicPerson, PublicPet, PublicZone } from "../schemas.js";

// Tipos PUROS de la maquina de conversacion compartida (CLAUDE.md, 02-design.md).
// La maquina es el "cerebro" que reutilizan Telegram y WhatsApp; los adaptadores
// solo traducen transporte y formato. Aqui NO hay red, ni BD, ni efectos: solo datos.
//
// Contrato del reducer:
//   step(state, input) -> { state, replies, effect? }
//
// La maquina SOLO describe el efecto (que pedir al backend); el ADAPTADOR lo
// ejecuta y re-inyecta el resultado como `{ kind: 'effect_result', ... }`.

// ── Reply ────────────────────────────────────────────────────────────────────

/**
 * Mensaje de salida hacia el usuario. Texto en espanol neutral + teclado opcional.
 * `buttons` es una matriz de filas de etiquetas (el adaptador la traduce a su UI).
 * NUNCA contiene datos de contacto (guardrail #1).
 */
export interface Reply {
  readonly text: string;
  readonly buttons?: readonly (readonly string[])[];
}

// ── Effect ───────────────────────────────────────────────────────────────────

/**
 * Efecto que el ADAPTADOR ejecutara contra el backend (spec 01).
 * Union discriminada por `type`. La maquina lo produce con sus datos pero NO lo
 * ejecuta. Ningun efecto transporta `contact_id` ni dato de contacto: el vinculo
 * usuario<->canal lo gestiona el adaptador (channels), no esta maquina.
 */
export type Effect =
  | { readonly type: "create_person"; readonly data: PersonCreate }
  | { readonly type: "create_pet"; readonly data: PetCreate }
  // Busqueda GUIADA de personas: `query` es el nombre buscado (nombre + apellidos
  // juntos, como lo puntua el matcher token a token). `zona` y `descripcion` son los
  // campos estructurados opcionales que el matcher YA pondera (mejor score que un
  // unico texto libre). NO transporta contacto (guardrail #1).
  | {
      readonly type: "search_persons";
      readonly query: string;
      readonly zona?: string;
      readonly descripcion?: string;
      /**
       * Si la persona buscada es menor de edad (R2-4a).
       * El adaptador lo pasa a POST /searches; el backend lo confirma
       * server-side de forma conservadora (judgment-r3 item 5).
       */
      readonly es_menor?: boolean;
    }
  | { readonly type: "search_pets"; readonly query: string; readonly zona?: string }
  | { readonly type: "delete_person"; readonly personId: string }
  // Reporte del DUENO: marca su registro como encontrado con vida. El backend lo
  // autoriza por canal (igual que delete_person) y fija estado=encontrada_viva,
  // verificacion=sin_verificar (un reporte del dueno SUGIERE, no confirma; la
  // confirmacion oficial por entidad verificada es un paso aparte).
  | { readonly type: "mark_found"; readonly personId: string }
  // REENCUENTRO (Capa 2): tras una busqueda, el BUSCADOR elige UNA persona de los
  // resultados para iniciar el reencuentro. Su consentimiento es SINCRONO (esta en
  // conversacion). El adaptador anade su canal; el backend pide el consentimiento de
  // la otra parte. NO transporta contacto: solo el id publico de la persona elegida.
  | { readonly type: "request_reunion"; readonly personId: string }
  // El DUENO lista SUS PROPIOS registros para elegir cual marcar/borrar sin pegar
  // codigos. No lleva dato alguno: el adaptador anade el canal y el backend resuelve
  // los registros ligados a ese contacto. Devuelve la vista del dueno (sin contacto).
  | { readonly type: "list_my_persons" }
  // Vistas de SOLO LECTURA del mapa: no llevan query ni dato alguno; el adaptador
  // hace un GET publico al backend (paridad bot<->web). Sin contacto ni PII.
  | { readonly type: "list_zones" }
  | { readonly type: "list_needs" };

// ── Effect result (re-inyectado por el adaptador) ────────────────────────────

/**
 * Resultado de `create_person`: ok o fallo (sin detalle de contacto). Cuando es ok,
 * lleva el `id` del registro creado para poder entregarlo al usuario (derecho al
 * borrado, principio #5). El id NO es PII de contacto (guardrail #1).
 */
export type CreatePersonResult =
  | { readonly type: "create_person"; readonly ok: true; readonly id?: string }
  | { readonly type: "create_person"; readonly ok: false };

/**
 * Resultado de `create_pet`: ok o fallo. Cuando es ok, lleva el `id` de la mascota
 * creada para entregarlo al usuario (derecho al borrado). El id NO es PII de contacto.
 */
export type CreatePetResult =
  | { readonly type: "create_pet"; readonly ok: true; readonly id?: string }
  | { readonly type: "create_pet"; readonly ok: false };

/**
 * Resultado de `search_persons`. Los resultados llegan como VISTA PUBLICA
 * (`PublicPerson`, sin `contact_id`) opcionalmente con un `score` 0..1.
 */
export type SearchPersonsResult = {
  readonly type: "search_persons";
  readonly results: ReadonlyArray<PublicPerson & { readonly score?: number }>;
};

/**
 * Resultado de `search_pets`. Los resultados llegan como VISTA PUBLICA
 * (`PublicPet`, sin `contact_id`) opcionalmente con un `score` 0..1.
 */
export type SearchPetsResult = {
  readonly type: "search_pets";
  readonly results: ReadonlyArray<PublicPet & { readonly score?: number }>;
};

/** Resultado de `delete_person`: ok o fallo. */
export type DeletePersonResult =
  | { readonly type: "delete_person"; readonly ok: true }
  | { readonly type: "delete_person"; readonly ok: false };

/**
 * Resultado de `mark_found`: ok o fallo. Espeja `delete_person`: el "no es el dueno"
 * (403 del backend) se modela IGUAL que cualquier otro fallo como `ok: false`, para
 * no revelar si el registro existe ni de quien es (guardrail #1).
 */
export type MarkFoundResult =
  | { readonly type: "mark_found"; readonly ok: true }
  | { readonly type: "mark_found"; readonly ok: false };

/**
 * Resultado de `request_reunion`. Discrimina por `status` para que la maquina de un
 * mensaje cálido y adecuado SIN exponer contacto alguno (el intercambio real ocurre
 * despues, asincronamente, por notificacion tras el doble si):
 *   - 'requested' : se aviso a la otra parte y se espera su respuesta.
 *   - 'minor'     : la persona es menor; requiere entidad verificada (guardrail #2).
 *   - 'failed'    : no se pudo iniciar (no encontrada o error). Mensaje generico, sin
 *                   revelar si el registro existe ni de quien es (guardrail #1).
 */
export type RequestReunionResult =
  | { readonly type: "request_reunion"; readonly status: "requested" }
  | { readonly type: "request_reunion"; readonly status: "minor" }
  | { readonly type: "request_reunion"; readonly status: "failed" };

/**
 * Resultado de `list_my_persons`: los registros del DUENO (los ligados a su canal).
 * Vista del dueno `OwnedPerson` (id + datos para reconocerlo + estado; SIN contacto,
 * guardrail #1). Lista vacia => el canal no tiene registros propios en este chat.
 */
export type ListMyPersonsResult = {
  readonly type: "list_my_persons";
  readonly persons: readonly OwnedPerson[];
};

/**
 * Resultado de `list_zones`: las zonas publicas (puntos de encuentro) del mapa.
 * Vista publica `PublicZone` (sin contacto ni identidad interna, guardrail #1).
 */
export type ListZonesResult = {
  readonly type: "list_zones";
  readonly zones: readonly PublicZone[];
};

/**
 * Resultado de `list_needs`: las necesidades publicas por zona del mapa.
 * Vista publica `PublicNeed` (sin contacto ni identidad interna, guardrail #1).
 */
export type ListNeedsResult = {
  readonly type: "list_needs";
  readonly needs: readonly PublicNeed[];
};

/** Union de todos los resultados que el adaptador puede re-inyectar. */
export type EffectResult =
  | CreatePersonResult
  | CreatePetResult
  | SearchPersonsResult
  | SearchPetsResult
  | DeletePersonResult
  | MarkFoundResult
  | RequestReunionResult
  | ListMyPersonsResult
  | ListZonesResult
  | ListNeedsResult;

// ── Input ────────────────────────────────────────────────────────────────────

/**
 * Entrada a la maquina. Union discriminada por `kind`:
 *  - `text`          : texto libre del usuario.
 *  - `command`       : comando (`/start`, `/ayuda`, `/cancelar`...), normalizado por el adaptador.
 *  - `effect_result` : resultado de un efecto ya ejecutado, re-inyectado por el adaptador.
 */
export type ConversationInput =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "effect_result"; readonly result: EffectResult };

// ── Draft (datos acumulados durante un flujo) ────────────────────────────────

/** Datos recogidos paso a paso durante el registro de una persona. */
export interface RegisterDraft {
  readonly nombre?: string;
  readonly apellidos?: string | null;
  readonly edad?: number | null;
  readonly zona?: string | null;
  readonly descripcion?: string | null;
}

/**
 * Datos recogidos paso a paso durante la BUSQUEDA guiada de una persona. TODOS
 * opcionales y SALTEABLES (espeja el flujo de registrar): quien busca puede no saber
 * todos los datos. Al menos uno debe quedar relleno para poder buscar (no se busca con
 * vacio). La `edad` se recoge para el futuro; el matcher de hoy no la pondera.
 */
export interface SearchDraft {
  readonly nombre?: string | null;
  readonly apellidos?: string | null;
  readonly edad?: number | null;
  readonly zona?: string | null;
  readonly descripcion?: string | null;
  /**
   * Si la persona buscada es menor de edad. Se recoge en el paso 'menor'
   * mediante pregunta EXPLÍCITA (R2-4a). Nunca tiene default silencioso.
   */
  readonly es_menor?: boolean | null;
}

/**
 * Datos recogidos paso a paso durante el registro de una mascota. TODOS opcionales
 * (espeja `petCreateSchema`): una mascota puede no tener nombre/raza conocidos.
 */
export interface PetDraft {
  readonly nombre?: string | null;
  readonly tipo?: string | null;
  readonly raza?: string | null;
  readonly zona?: string | null;
}

// ── State ────────────────────────────────────────────────────────────────────

/**
 * Estado de la conversacion. Union discriminada por `flow`; cada flujo lleva su
 * propio `step` (punto del dialogo) y, si aplica, su `draft` con lo acumulado.
 * El estado es serializable: el adaptador puede persistirlo entre mensajes.
 */
export type ConversationState =
  | { readonly flow: "idle" }
  | {
      readonly flow: "register";
      readonly step:
        | "nombre"
        | "apellidos"
        | "edad"
        | "zona"
        | "descripcion"
        | "confirm"
        | "submitting";
      readonly draft: RegisterDraft;
    }
  | {
      readonly flow: "register_pet";
      readonly step: "nombre" | "tipo" | "raza" | "zona" | "confirm" | "submitting";
      readonly draft: PetDraft;
    }
  | {
      readonly flow: "search";
      // Pasos GUIADOS (nombre -> apellidos -> edad -> zona -> descripcion), cada uno
      // salteable, espejando el registro. Tras recolectar se dispara la busqueda
      // ('searching') y, con resultados, se ofrece conectar ('choosing'/'requesting').
      readonly step:
        | "nombre"
        | "apellidos"
        | "edad"
        | "zona"
        | "descripcion"
        // Paso EXPLÍCITO: ¿la persona buscada es menor? (R2-4a / guardrail #2).
        // Nunca se omite ni tiene default silencioso.
        | "menor"
        | "searching"
        | "choosing"
        | "requesting";
      // Datos acumulados durante la recoleccion guiada (presente en los pasos guiados).
      readonly draft?: SearchDraft;
      // En 'choosing'/'requesting': ids PUBLICOS de las personas mostradas, en el orden
      // en que se listaron. El buscador elige por su numero; el id NO es PII (guardrail #1).
      readonly candidates?: readonly string[];
    }
  | {
      readonly flow: "search_pets";
      readonly step: "query" | "searching";
      readonly query?: string;
    }
  // Borrado (derecho al olvido): al entrar se listan los registros del DUENO
  // ('loading'); con la lista, elige uno por su numero ('choosing'); confirma
  // ('confirm') y se emite el efecto ('deleting'). YA NO se pegan codigos: la gente
  // en emergencia no los guarda. El backend autoriza por canal igual que antes.
  | {
      readonly flow: "delete";
      readonly step: "loading" | "choosing" | "confirm" | "deleting";
      // En 'choosing': los registros propios mostrados (para elegir por numero).
      readonly persons?: readonly OwnedPerson[];
      // En 'confirm'/'deleting': el registro elegido (id + nombre para el mensaje).
      readonly personId?: string;
      readonly nombre?: string;
    }
  // Reporte del dueno "apareci con vida": espeja el flujo delete (lista -> elige ->
  // confirma -> emite el efecto -> espera el resultado). El backend autoriza por
  // canal igual que el borrado. MEJORA FUTURA: distinguir encontrada_herida.
  | {
      readonly flow: "mark_found";
      readonly step: "loading" | "choosing" | "confirm" | "marking";
      readonly persons?: readonly OwnedPerson[];
      readonly personId?: string;
      readonly nombre?: string;
    }
  // Vistas de SOLO LECTURA del mapa: al entrar se emite el effect y se queda en
  // `loading` esperando el `effect_result` con la lista; luego vuelve a idle.
  | { readonly flow: "browse_zones"; readonly step: "loading" }
  | { readonly flow: "browse_needs"; readonly step: "loading" };

/** Estado inicial: menu/idle. */
export const initialState: ConversationState = { flow: "idle" };

// ── Resultado del reducer ────────────────────────────────────────────────────

/**
 * Salida de `step`: el nuevo estado, las respuestas a enviar y, opcionalmente, un
 * unico efecto a ejecutar por el adaptador. Tras ejecutarlo, el adaptador re-inyecta
 * `{ kind: 'effect_result', result }` y la maquina emite la respuesta final.
 */
export interface StepResult {
  readonly state: ConversationState;
  readonly replies: readonly Reply[];
  readonly effect?: Effect;
}
