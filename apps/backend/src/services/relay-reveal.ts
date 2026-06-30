import type { AuditRepo } from "db";
import type { RelayRepo } from "db";
import type { NotificationRepo } from "db";
import type { ContactRepo } from "db";

// Servicio de revelado bilateral de contacto (PR7).
//
// El teléfono NUNCA se intercambia hasta que AMBAS partes lo pidieron explícitamente.
//
// Flujo:
//   1. Leer relay con sus partes y flags de reveal.
//   2. Determinar qué parte es la que llama (a o b).
//   3. Si la parte ya pidió (idempotente): solo confirmar estado de espera o bilateral.
//   4. Si no había pedido: marcar reveal_requested_<parte>=true.
//   5. Si tras marcar AMBAS son true:
//       a. Leer el teléfono de CADA contacto.
//       b. Notificar a party_a con el teléfono de party_b y viceversa.
//       c. Actualizar state='contact_revealed'.
//       d. Escribir evento de auditoría.
//   6. Si solo una pedido: notificar al solicitante (espera) + avisar al otro lado
//      que su par quiere compartir contacto (SIN teléfono).
//
// GUARDRAIL #1: el teléfono NUNCA aparece en payloads parciales ni logs.
// GUARDRAIL #5: close_relays_and_delete_contact sigue funcionando después del reveal.

/** Estado que devuelve el servicio tras procesar la solicitud de reveal. */
export const REVEAL_STATUS = {
  WAITING_OTHER: "waiting_other",
  REVEALED: "revealed",
} as const;

export type RevealStatus = (typeof REVEAL_STATUS)[keyof typeof REVEAL_STATUS];

/** Dependencias del servicio de reveal (solo repos, sin Fastify). */
export interface RevealDeps {
  readonly relayRepo: Pick<
    RelayRepo,
    "getRelayParties" | "markRevealRequested" | "getActiveRelay" | "closeRelay"
  >;
  readonly contactRepo: Pick<ContactRepo, "getById">;
  readonly notificationRepo: Pick<NotificationRepo, "create">;
  readonly auditRepo: Pick<AuditRepo, "writeContactReveal">;
}

/** Input del servicio: relay_id + canal que solicita el reveal. */
export interface RevealInput {
  relayId: string;
  callerChannelId: string;
}

/** Resultado del servicio. */
export interface RevealResult {
  status: RevealStatus;
}

/**
 * Procesa la solicitud de reveal bilateral de contacto.
 *
 * Devuelve { status: 'waiting_other' } si solo una parte lo ha pedido, o
 * { status: 'revealed' } si ambas partes lo han pedido y el intercambio se realizó.
 *
 * Lanza un error si callerChannelId no pertenece al relay (esto lo valida la ruta
 * antes de llamar al servicio; no se repite aquí para mantener el servicio puro).
 */
export async function requestReveal(
  deps: RevealDeps,
  input: RevealInput,
): Promise<RevealResult> {
  const { relayId, callerChannelId } = input;

  const parties = await deps.relayRepo.getRelayParties(relayId);
  if (!parties) {
    throw new Error(`relay ${relayId} no encontrado`);
  }

  // Determinar qué parte es la que llama
  const isPartyA = callerChannelId === parties.partyAChannelId;
  const isPartyB = callerChannelId === parties.partyBChannelId;
  const callerParty = isPartyA ? "a" : isPartyB ? "b" : null;

  if (callerParty === null) {
    throw new Error("canal ajeno al relay");
  }

  const callerAlreadyRequested =
    callerParty === "a" ? parties.revealRequestedA : parties.revealRequestedB;
  const otherAlreadyRequested =
    callerParty === "a" ? parties.revealRequestedB : parties.revealRequestedA;

  // Idempotencia: si la parte que llama ya lo pidió, no volver a marcar
  if (!callerAlreadyRequested) {
    await deps.relayRepo.markRevealRequested(relayId, callerParty);
  }

  const bothRequested = otherAlreadyRequested; // la otra ya había pedido

  if (bothRequested) {
    // BILATERAL: ambas partes han solicitado → revelar teléfonos
    return doReveal(deps, parties, callerParty);
  }

  // PARCIAL: solo esta parte pidió (o ya lo había pedido)
  const callerChannelIdLocal =
    callerParty === "a" ? parties.partyAChannelId : parties.partyBChannelId;
  const otherChannelId =
    callerParty === "a" ? parties.partyBChannelId : parties.partyAChannelId;

  if (!callerAlreadyRequested) {
    // Primera solicitud: avisar al otro lado que alguien quiere compartir
    await deps.notificationRepo.create({
      channel_id: otherChannelId,
      tipo: "info",
      prioridad: "normal",
      payload: {
        mensaje: [
          "La otra persona quiere compartir su contacto contigo.",
          "Si también querés compartir el tuyo, escribe /compartir_contacto.",
        ].join(" "),
      },
    });
  }

  // Confirmar al solicitante que está esperando
  await deps.notificationRepo.create({
    channel_id: callerChannelIdLocal,
    tipo: "info",
    prioridad: "normal",
    payload: {
      mensaje:
        "Solicitud enviada. Compartiremos el contacto cuando la otra persona también lo acepte.",
    },
  });

  return { status: REVEAL_STATUS.WAITING_OTHER };
}

/**
 * Realiza el intercambio bilateral de contactos.
 * El teléfono se lee SOLO aquí, en el momento exacto del intercambio.
 * GUARDRAIL #1: nunca antes de este punto.
 */
async function doReveal(
  deps: RevealDeps,
  parties: Awaited<ReturnType<RevealDeps["relayRepo"]["getRelayParties"]>> & object,
  callerParty: "a" | "b",
): Promise<RevealResult> {
  // Leer teléfonos de AMBOS contactos. Solo en este momento exacto.
  const [contactA, contactB] = await Promise.all([
    deps.contactRepo.getById(parties.partyAContactId),
    deps.contactRepo.getById(parties.partyBContactId),
  ]);

  // Construir mensajes con el teléfono de la OTRA parte
  const phoneA = contactA?.telefono ?? null;
  const phoneB = contactB?.telefono ?? null;

  const msgForA = phoneB
    ? `El contacto de la otra persona es: ${phoneB}. Podéis reuniros directamente.`
    : "La otra persona aceptó compartir su contacto. Pronto recibirás sus datos.";

  const msgForB = phoneA
    ? `El contacto de la otra persona es: ${phoneA}. Podéis reuniros directamente.`
    : "La otra persona aceptó compartir su contacto. Pronto recibirás sus datos.";

  // Enviar notificaciones a AMBAS partes simultáneamente
  await Promise.all([
    deps.notificationRepo.create({
      channel_id: parties.partyAChannelId,
      tipo: "info",
      prioridad: "alta",
      payload: { mensaje: msgForA },
    }),
    deps.notificationRepo.create({
      channel_id: parties.partyBChannelId,
      tipo: "info",
      prioridad: "alta",
      payload: { mensaje: msgForB },
    }),
  ]);

  // Auditoría: evento de reveal bilateral (sin teléfonos)
  // Best-effort: no bloquea el reveal si falla
  try {
    await deps.auditRepo.writeContactReveal({
      relayId: parties.relayId,
      partyAChannelId: parties.partyAChannelId,
      partyBChannelId: parties.partyBChannelId,
    });
  } catch {
    // Auditoría es best-effort: el intercambio ya se realizó
  }

  // Silenciar el caller (informado por la notificación anterior)
  void callerParty;

  return { status: REVEAL_STATUS.REVEALED };
}
