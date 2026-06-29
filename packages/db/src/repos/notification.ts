import { z } from "zod";
import type { PlataformaCanal } from "core";
import type { DbClient } from "../client.js";
import { DbError } from "../errors.js";

// Repositorio de notificaciones. INTERNO (tabla `notifications` con RLS: solo
// service_role). Espeja migrations/0001_init.sql.
//
// CRITICO (guardrail #1): una notificacion liga un contacto/canal SENSIBLE con un
// payload a entregar. Uso EXCLUSIVO del backend. El worker/bot que entrega lee las
// pendientes y marca el resultado; nunca se expone a clientes publicos. El payload
// NO debe contener PII innecesaria (telefono en claro): el transporte ya conoce el
// chat_id por el canal.

// Espeja los CHECK del esquema: notifications.tipo / prioridad / estado.
const tipoNotificacionSchema = z.enum(["match", "alerta", "info"]);
const prioridadNotificacionSchema = z.enum(["normal", "alta"]);
const estadoNotificacionSchema = z.enum(["pendiente", "enviada", "fallida"]);

export type TipoNotificacion = z.infer<typeof tipoNotificacionSchema>;
export type PrioridadNotificacion = z.infer<typeof prioridadNotificacionSchema>;
export type EstadoNotificacion = z.infer<typeof estadoNotificacionSchema>;

/** Fila completa de la tabla base `notifications`. INTERNO: solo backend. */
export interface NotificationRow {
  id: string;
  contact_id: string | null;
  channel_id: string | null;
  tipo: TipoNotificacion;
  prioridad: PrioridadNotificacion;
  payload: unknown;
  estado: EstadoNotificacion;
  created_at: string;
}

/** Tipo de dominio de una notificacion (interno). */
export interface Notification {
  id: string;
  contact_id: string | null;
  channel_id: string | null;
  tipo: TipoNotificacion;
  prioridad: PrioridadNotificacion;
  payload: unknown;
  estado: EstadoNotificacion;
  created_at: string;
}

/**
 * Entrada de creacion de notificacion. estado lo fija el DEFAULT ('pendiente').
 * `payload` es JSON libre: NO incluir PII innecesaria (guardrail #1).
 */
export const notificationCreateSchema = z.object({
  contact_id: z.uuid().nullable().optional(),
  channel_id: z.uuid().nullable().optional(),
  tipo: tipoNotificacionSchema,
  prioridad: prioridadNotificacionSchema.optional(),
  payload: z.unknown().optional(),
});
export type NotificationCreate = z.infer<typeof notificationCreateSchema>;

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    contact_id: row.contact_id,
    channel_id: row.channel_id,
    tipo: row.tipo,
    prioridad: row.prioridad,
    payload: row.payload,
    estado: row.estado,
    created_at: row.created_at,
  };
}

export interface NotificationRepo {
  /** ESCRITURA INTERNA. Encola una notificacion (nace 'pendiente'). Solo backend. */
  create(input: NotificationCreate): Promise<Notification>;
  /**
   * LECTURA INTERNA. Lista notificaciones pendientes para que un worker las entregue.
   * Si se pasa `plataforma`, filtra A NIVEL DE BD por la plataforma del canal
   * (inner join con `channels`): cada bot solo ve las suyas, sin exponer chat_id de
   * una plataforma a otra (guardrail #1). El `limit` se aplica YA filtrado por
   * plataforma, de modo que las de otra plataforma no tapan a las propias.
   */
  listPending(limit?: number, plataforma?: PlataformaCanal): Promise<Notification[]>;
  /** ESCRITURA INTERNA. Marca una notificacion como enviada tras entregarla. */
  markSent(id: string): Promise<void>;
  /** ESCRITURA INTERNA. Marca una notificacion como fallida (reintentos/diagnostico). */
  markFailed(id: string): Promise<void>;
}

/** Construye el repositorio de notificaciones sobre un cliente Supabase de servicio. */
export function createNotificationRepo(client: DbClient): NotificationRepo {
  return {
    async create(input: NotificationCreate): Promise<Notification> {
      const data = notificationCreateSchema.parse(input);
      const insert = {
        contact_id: data.contact_id ?? null,
        channel_id: data.channel_id ?? null,
        tipo: data.tipo,
        prioridad: data.prioridad ?? "normal",
        payload: data.payload ?? null,
        // estado lo fija el DEFAULT del esquema ('pendiente').
      };

      const { data: row, error } = await client
        .from("notifications")
        .insert(insert)
        .select("*")
        .single<NotificationRow>();

      if (error) throw new DbError(`No se pudo crear la notificacion: ${error.message}`, error.code);
      if (!row) throw new DbError("Insert de notificacion no devolvio fila.");
      return rowToNotification(row);
    },

    async listPending(limit = 50, plataforma?: PlataformaCanal): Promise<Notification[]> {
      // Sin plataforma: comportamiento original (sin join), lista global.
      if (plataforma === undefined) {
        const { data, error } = await client
          .from("notifications")
          .select("*")
          .eq("estado", "pendiente")
          // Prioridad alta primero; dentro, las mas antiguas primero (FIFO).
          .order("prioridad", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(limit)
          .returns<NotificationRow[]>();

        if (error) throw new DbError(`No se pudieron listar notificaciones: ${error.message}`, error.code);
        return (data ?? []).map(rowToNotification);
      }

      // Con plataforma: filtramos en BD por la plataforma del canal con un inner
      // join de PostgREST (`channels!inner`). El inner join descarta las que no
      // tienen channel_id (no son entregables por un bot), y el `limit` se aplica
      // a las filas de ESTA plataforma. El cast a NotificationRow[] sigue valido:
      // rowToNotification solo lee campos de notification; `channels` embebido se
      // ignora.
      const { data, error } = await client
        .from("notifications")
        .select("*, channels!inner(plataforma)")
        .eq("estado", "pendiente")
        .eq("channels.plataforma", plataforma)
        // Prioridad alta primero; dentro, las mas antiguas primero (FIFO).
        .order("prioridad", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(limit)
        .returns<NotificationRow[]>();

      if (error) throw new DbError(`No se pudieron listar notificaciones: ${error.message}`, error.code);
      return (data ?? []).map(rowToNotification);
    },

    async markSent(id: string): Promise<void> {
      // Al marcar enviada, REDACTAMOS el payload (payload=null). Algunos avisos del
      // reencuentro llevan el telefono de la otra parte en el texto (unico punto de
      // intercambio tras el doble si); una vez entregado, NO debe quedar retenido en
      // reposo en la cola ni devolverse de nuevo por GET /notifications/pending
      // (guardrail #1: minimo dato de contacto, nada de retencion innecesaria). Para
      // las demas notificaciones el payload ya se entrego, asi que borrarlo no afecta.
      //
      // FOLLOW-UP: lo ideal a futuro es NO persistir nunca el telefono en la cola:
      // guardar un payload estructurado { match_id, tipo:'intercambio' } y que el bot
      // pida el telefono a un endpoint efimero autenticado por canal al entregar. Ese
      // endpoint efimero queda FUERA de alcance de este cambio (solo scrub + comentario).
      const { error } = await client
        .from("notifications")
        .update({ estado: "enviada", payload: null })
        .eq("id", id);
      if (error) throw new DbError(`No se pudo marcar enviada: ${error.message}`, error.code);
    },

    async markFailed(id: string): Promise<void> {
      const { error } = await client
        .from("notifications")
        .update({ estado: "fallida" })
        .eq("id", id);
      if (error) throw new DbError(`No se pudo marcar fallida: ${error.message}`, error.code);
    },
  };
}
