import type { PersonCreate, PetCreate } from "../schemas.js";
import type { PublicPerson, PublicPet } from "../schemas.js";

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
  | { readonly type: "search_persons"; readonly query: string; readonly zona?: string }
  | { readonly type: "search_pets"; readonly query: string; readonly zona?: string }
  | { readonly type: "delete_person"; readonly personId: string };

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

/** Union de todos los resultados que el adaptador puede re-inyectar. */
export type EffectResult =
  | CreatePersonResult
  | CreatePetResult
  | SearchPersonsResult
  | SearchPetsResult
  | DeletePersonResult;

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
      readonly step: "query" | "searching";
      readonly query?: string;
    }
  | {
      readonly flow: "search_pets";
      readonly step: "query" | "searching";
      readonly query?: string;
    }
  | {
      readonly flow: "delete";
      readonly step: "id" | "confirm" | "deleting";
      readonly personId?: string;
    };

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
