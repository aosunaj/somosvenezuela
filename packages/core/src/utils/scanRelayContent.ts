// Shared phone-number scanner for relay content (judgment-r3 item 12).
//
// Used by:
//   - relay intercept in the Telegram adapter (PR4): BLOCKING pre-send check.
//   - guardrails:scan (PR6): audit scan of stored rows.
//
// guardrail #1: phone numbers MUST NEVER appear in relay-forwarded messages.
// If detected, the relay forward is REJECTED (not masked) and the sender is warned.
//
// The regex covers the patterns most common in a Venezuelan emergency context:
//   - Venezuelan numbers: +58 / 0058 / 0412-0499 / 04xx-XXXXXXX (7 digits) / local 11 digits
//   - Generic international: +<country><digits>, 10-digit sequences
//
// CONSERVATIVE by design: if in doubt, block. False positives are acceptable;
// false negatives would expose PII through the relay (guardrail breach).

/**
 * Result of scanning relay content for phone numbers.
 *   - `{ ok: true }`: no phone detected, safe to forward.
 *   - `{ ok: false; reason: string }`: phone detected, MUST NOT forward.
 */
export type ScanResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Phone detection regex — exported so guardrails:scan can reuse it without
 * importing the full function (judgment-r3 item 12: shared regex).
 *
 * Pattern breakdown:
 *   Group A: International prefix   (\+|00)\d{1,3}[\s.\-]?   — e.g. +58, 0058, +1, +34
 *   Group B: Venezuelan local       0(41[2-9]|42[0-6]|46[0-9])\d{7}  — 04xx-XXXXXXX (11 digits)
 *   Group C: Venezuelan without 0   (41[2-9]|42[0-6]|46[0-9])\d{7}   — 04xx without leading 0
 *   Group D: Generic 10-digit       \b\d{10}\b                — 10 consecutive digits
 *
 * Separators allowed between digit groups: space, dot, or hyphen ([\s.\-]?).
 */
export const PHONE_REGEX =
  /(?:(?:\+|00)\d{1,3}[\s.\-]?\d{1,4}[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}|0(?:41[2-9]|42[0-6]|46\d)[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}|(?:41[2-9]|42[0-6]|46\d)[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}|\b\d{10}\b)/;

/**
 * Scans relay message text for phone-number patterns.
 *
 * Returns `{ ok: true }` when no phone is found.
 * Returns `{ ok: false; reason }` when a phone is detected — the caller MUST
 * block the forward and warn the sender.
 *
 * NOTE: This is intentionally conservative. A 10-digit numeric sequence that is
 * NOT a phone (e.g. a case ID) will also trigger a block. This is the correct
 * tradeoff for a humanitarian safety system: block false positives, never miss
 * a real phone leak.
 */
export function scanRelayContent(text: string): ScanResult {
  if (PHONE_REGEX.test(text)) {
    return {
      ok: false,
      reason:
        "Por seguridad no reenviamos números de teléfono. " +
        "Compartí el contacto solo con /compartir_contacto cuando ambos estén de acuerdo.",
    };
  }
  return { ok: true };
}
