// Statistics with fractions: outside core, which is integer-only.

/** 95% Wilson interval of a proportion `score / n` (a draw counts as half a win). Games on one world are not independent, so it is approximate. */
export function wilson(score: number, n: number): [number, number] {
  const z = 1.96, p = score / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; // (rounding can leave a bound a hair outside 0..1)
}
