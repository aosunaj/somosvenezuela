import { createHmac, timingSafeEqual } from "node:crypto";

// Verificacion de la firma de los webhooks de WhatsApp Cloud API (guardrail #6:
// "verificar firmas de webhooks y origenes"). Meta firma cada POST con el App Secret
// de la app y envia el resultado en el header `X-Hub-Signature-256`:
//
//     X-Hub-Signature-256: sha256=<HMAC_SHA256(appSecret, rawBody)>  (hex)
//
// Debemos calcular el mismo HMAC sobre el CUERPO CRUDO (los bytes exactos recibidos,
// NO el JSON re-serializado) y compararlo en tiempo constante. Si no coincide, el
// origen no es Meta (o el cuerpo fue manipulado) y el llamador debe rechazar con 401.
//
// Nunca registramos el secreto ni la firma; esta funcion solo devuelve un booleano.

const PREFIX = "sha256=";

/**
 * Devuelve `true` solo si `signatureHeader` es exactamente
 * `"sha256=" + HMAC_SHA256(appSecret, rawBody)` en hex. Cualquier ausencia, formato
 * invalido o discrepancia devuelve `false`. La comparacion es de tiempo constante
 * (`timingSafeEqual`) para no filtrar informacion por canal lateral de temporizado.
 *
 * @param rawBody         Cuerpo crudo del POST tal cual llego (Buffer o string).
 * @param signatureHeader Valor del header `X-Hub-Signature-256` (o `undefined`).
 * @param appSecret       App Secret de la app de Meta (WHATSAPP_APP_SECRET).
 */
export function verifySignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (signatureHeader === undefined || !signatureHeader.startsWith(PREFIX)) {
    return false;
  }

  const provided = signatureHeader.slice(PREFIX.length);
  // Una firma valida es hex de 64 caracteres (32 bytes). Si no, rechazamos sin
  // intentar la comparacion (evita excepciones de Buffer.from con datos basura).
  if (!/^[0-9a-f]{64}$/i.test(provided)) {
    return false;
  }

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", appSecret).update(body).digest("hex");

  // Ambos buffers miden 32 bytes (hex de 64): timingSafeEqual no lanza por longitud.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
