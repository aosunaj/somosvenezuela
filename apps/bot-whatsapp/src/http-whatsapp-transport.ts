import type { WhatsAppTransport } from "./ports.js";

// Implementacion real del transporte: habla con WhatsApp Cloud API (Meta) via fetch.
//
//   POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
//   Authorization: Bearer {WHATSAPP_TOKEN}
//
// El token NUNCA se loggea ni se expone: se guarda privado en la instancia y solo
// viaja en la cabecera Authorization. Los errores de red se propagan como excepcion
// para que el llamador decida (el orquestador ya respondio al usuario por su cuenta).
//
// DECISION sobre los botones (Reply.buttons de la maquina):
// La maquina entrega un teclado como matriz de filas de etiquetas (p. ej. el menu son
// 4 botones en 2 filas; confirmar/cancelar son 2). WhatsApp Cloud API solo admite
// hasta 3 "reply buttons" por mensaje interactivo y con titulos <= 20 caracteres, lo
// que NO calza con todos nuestros teclados (el menu tiene 4 opciones). Para evitar
// truncados o ramas fragiles, mapeamos los botones a OPCIONES NUMERADAS dentro del
// texto del mensaje (mensaje de tipo `text`). La maquina ya acepta como entrada el
// TEXTO de la etiqueta del boton (MENU_TEXT / tokens de confirmar/omitir), de modo que
// el usuario puede responder escribiendo la etiqueta y el flujo funciona igual. Asi el
// adaptador sigue siendo fino y no duplica logica de dialogo.

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export class HttpWhatsAppTransport implements WhatsAppTransport {
  readonly #messagesUrl: string;
  readonly #token: string;

  constructor(token: string, phoneNumberId: string) {
    this.#token = token;
    this.#messagesUrl = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;
  }

  async sendMessage(
    to: string,
    text: string,
    buttons?: readonly (readonly string[])[],
  ): Promise<void> {
    const bodyText = this.#composeText(text, buttons);
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: bodyText },
    };

    const res = await fetch(this.#messagesUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // El token va aqui y solo aqui; esta clase nunca imprime su contenido.
        authorization: `Bearer ${this.#token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // No incluimos el cuerpo de la respuesta (podria reflejar datos sensibles).
      throw new Error(`WhatsApp sendMessage fallo con estado ${res.status}`);
    }
  }

  /**
   * Compone el texto final: si hay botones, los anexa como opciones numeradas para
   * que el usuario pueda elegir respondiendo con la etiqueta (que la maquina entiende).
   */
  #composeText(text: string, buttons?: readonly (readonly string[])[]): string {
    if (buttons === undefined || buttons.length === 0) {
      return text;
    }
    const labels = buttons.flat();
    if (labels.length === 0) {
      return text;
    }
    const options = labels.map((label, i) => `${i + 1}. ${label}`).join("\n");
    return `${text}\n\n${options}`;
  }
}
