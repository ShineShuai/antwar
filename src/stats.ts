// Statistics with fractions: outside core, which is integer-only.

/** 95% Wilson interval of a proportion `score / n` (a draw counts as half a win). Games on one world are not independent, so it is approximate. */
export function wilson(score: number, n: number): [number, number] {
  const z = 1.96, p = score / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; // (rounding can leave a bound a hair outside 0..1)
}

/** Two-sided 95% critical value of Student's t with `df` degrees of freedom (the 97.5% quantile): a table up to 30, then the Cornish-Fisher
 * expansion round z = 1.96 (error under 0.0005 from 30). 1.96 as df grows. */
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export function tCritical95(df: number): number {
  if (!Number.isInteger(df) || df < 1) throw new RangeError('degrees of freedom: a whole number from 1');
  if (df <= T975.length) return T975[df - 1];
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}
