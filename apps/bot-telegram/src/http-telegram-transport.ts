import type { TelegramTransport } from "./ports.js";

// Implementacion real del transporte: habla con el Bot API de Telegram via fetch.
//
// El token NUNCA se loggea ni se expone: se usa solo para construir la URL del
// endpoint y se mantiene privado en la instancia. Los errores de red se propagan
// como excepcion para que el llamador decida (en este slice, long polling reintenta).

const TELEGRAM_API_BASE = "https://api.telegram.org";

/** Mapea el teclado de la maquina (filas de etiquetas) al reply_markup de Telegram. */
interface ReplyKeyboardMarkup {
  readonly keyboard: readonly { readonly text: string }[][];
  readonly resize_keyboard: true;
  readonly one_time_keyboard: true;
}

export class HttpTelegramTransport implements TelegramTransport {
  readonly #sendMessageUrl: string;

  constructor(token: string) {
    // La URL incluye el token; por eso esta clase nunca imprime su contenido.
    this.#sendMessageUrl = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  }

  async sendMessage(
    chatId: number,
    text: string,
    buttons?: readonly (readonly string[])[],
  ): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (buttons !== undefined && buttons.length > 0) {
      body["reply_markup"] = this.#toReplyMarkup(buttons);
    }

    const res = await fetch(this.#sendMessageUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // No incluimos el cuerpo de la respuesta (podria llevar la URL con token).
      throw new Error(`Telegram sendMessage fallo con estado ${res.status}`);
    }
  }

  /** Convierte la matriz de etiquetas en un teclado de respuesta de Telegram. */
  #toReplyMarkup(buttons: readonly (readonly string[])[]): ReplyKeyboardMarkup {
    return {
      keyboard: buttons.map((row) => row.map((label) => ({ text: label }))),
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  }
}
