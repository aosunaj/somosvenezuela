import { z } from "zod";

// Formas MINIMAS del API de Telegram que el adaptador necesita y SANEA.
//
// No modelamos el update entero de Telegram: solo lo que consumimos (mensajes de
// texto de un chat). Validar con zod la entrada externa es guardrail #6: nada que
// venga de la red se usa sin pasar por aqui. Lo que no encaje se ignora con
// seguridad (el bot no rompe ante updates raros: ediciones, fotos, callbacks...).

/** Chat de Telegram: solo nos interesa su id numerico. */
const telegramChatSchema = z.object({
  id: z.number(),
});

/** Mensaje de Telegram: chat + texto opcional (otros campos se ignoran). */
const telegramMessageSchema = z.object({
  chat: telegramChatSchema,
  text: z.string().optional(),
});

/**
 * Update de Telegram (long polling / getUpdates). Solo extraemos `update_id`
 * (para avanzar el offset) y `message`. Cualquier otro tipo de update se ignora.
 */
export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: telegramMessageSchema.optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/** Respuesta de getUpdates: un sobre con la lista de updates. */
export const getUpdatesResponseSchema = z.object({
  ok: z.boolean(),
  result: z.array(telegramUpdateSchema),
});
