import { z } from "zod";

// Formas MINIMAS del webhook entrante de WhatsApp Cloud API que el adaptador
// necesita y SANEA. No modelamos el payload entero: solo lo que consumimos (mensajes
// de texto de un usuario). Validar con zod la entrada externa es guardrail #6: nada
// que venga de la red se usa sin pasar por aqui. Lo que no encaje se ignora con
// seguridad (el bot no rompe ante eventos raros: estados de entrega, reacciones,
// audios, ubicaciones, mensajes interactivos sin texto...).
//
// Estructura real del Cloud API (resumida):
//   { object: "whatsapp_business_account",
//     entry: [ { id, changes: [ { value: {
//       messaging_product: "whatsapp",
//       metadata: { phone_number_id, display_phone_number },
//       contacts: [...], messages: [ { from, id, timestamp, type, text: { body } } ],
//       statuses: [...]   // eventos de entrega: los ignoramos
//     }, field: "messages" } ] } ] }

/** Cuerpo de un mensaje de texto entrante: solo nos interesa `body`. */
const whatsappTextSchema = z.object({
  body: z.string(),
});

/**
 * Mensaje entrante. `from` es el `wa_id` del remitente (numero internacional sin
 * `+`). Solo procesamos `type: "text"`; el resto de campos se ignoran y otros tipos
 * (image, audio, interactive, button...) no traen `text` y se descartan aguas abajo.
 */
const whatsappMessageSchema = z.object({
  from: z.string(),
  // `text` es opcional: solo viene en mensajes de tipo texto.
  text: whatsappTextSchema.optional(),
});

/** Valor de un cambio: puede traer `messages` (entrantes) o `statuses` (entregas). */
const whatsappValueSchema = z.object({
  // Solo extraemos `messages`; ignoramos `statuses` y demas metadatos.
  messages: z.array(whatsappMessageSchema).optional(),
});

const whatsappChangeSchema = z.object({
  value: whatsappValueSchema,
});

const whatsappEntrySchema = z.object({
  changes: z.array(whatsappChangeSchema),
});

/**
 * Payload completo del webhook (POST). Iteramos `entry[].changes[].value.messages[]`
 * y nos quedamos solo con los mensajes de texto. Cualquier otra forma se ignora.
 */
export const whatsappWebhookSchema = z.object({
  entry: z.array(whatsappEntrySchema),
});

export type WhatsAppWebhook = z.infer<typeof whatsappWebhookSchema>;
export type WhatsAppMessage = z.infer<typeof whatsappMessageSchema>;
