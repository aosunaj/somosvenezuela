// Metricas de similitud locales y PURAS, en [0, 1].
//
// Dos familias complementarias:
//   - Levenshtein normalizada: robusta ante erratas cortas (transposiciones,
//     una letra de mas/menos). Buena para nombres parecidos.
//   - Similitud por trigramas (Dice sobre conjuntos de 3-gramas): robusta ante
//     reordenamientos y diferencias de longitud. Buena para descripciones.
//
// `combinedSimilarity` mezcla ambas: capta erratas Y reordenamientos.
//
// Todas asumen entrada YA normalizada (ver normalize.ts). No normalizan por su
// cuenta para no acoplar la metrica a una politica de normalizacion concreta.

/**
 * Distancia de Levenshtein (numero minimo de inserciones/borrados/sustituciones)
 * entre dos cadenas. Implementacion iterativa O(n*m) con una sola fila.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Fila previa de la matriz de programacion dinamica.
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = new Array<number>(b.length + 1);
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      // prev[j], curr[j-1] y prev[j-1] siempre estan definidos por construccion.
      const del = (prev[j] as number) + 1;
      const ins = (curr[j - 1] as number) + 1;
      const sub = (prev[j - 1] as number) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    prev = curr;
  }
  return prev[b.length] as number;
}

/**
 * Similitud por Levenshtein normalizada a [0, 1]:
 *   1 - distancia / max(len(a), len(b))
 * Dos cadenas vacias se consideran identicas (1).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Conjunto de trigramas de una cadena. Se rellena con un espacio de guarda al
 * inicio y al final para dar peso a los bordes de palabra, tecnica clasica de
 * pg_trgm. Devuelve un Set para comparacion por solapamiento.
 */
export function trigrams(value: string): ReadonlySet<string> {
  const result = new Set<string>();
  if (value.length === 0) return result;
  const padded = `  ${value} `;
  for (let i = 0; i + 3 <= padded.length; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

/**
 * Similitud por trigramas (coeficiente de Dice) en [0, 1]:
 *   2 * |A ∩ B| / (|A| + |B|)
 * Dos cadenas vacias se consideran identicas (1).
 */
export function trigramSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  // Recorremos el conjunto mas pequeno por eficiencia.
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const gram of small) {
    if (large.has(gram)) intersection++;
  }
  return (2 * intersection) / (ta.size + tb.size);
}

/**
 * Similitud combinada en [0, 1]: media ponderada de Levenshtein y trigramas.
 * Por defecto pesa ambas por igual; ajustable via `weightLevenshtein` en [0, 1].
 *   - Levenshtein capta erratas cortas (mejor en cadenas breves: nombres).
 *   - Trigramas capta reordenamientos y solapamientos (mejor en frases).
 */
export function combinedSimilarity(
  a: string,
  b: string,
  weightLevenshtein = 0.5,
): number {
  const w = clamp01(weightLevenshtein);
  const lev = levenshteinSimilarity(a, b);
  const tri = trigramSimilarity(a, b);
  return clamp01(w * lev + (1 - w) * tri);
}

/** Acota un numero al intervalo [0, 1]. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
