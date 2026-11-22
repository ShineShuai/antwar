// Behavioural fairness. A world is fair for a brain when that brain, in every colony, wins about equally often: each of n colonies
// should have the most food in 1/n of the games (equal food splits the win). This module judges a list of games, one row of nest food
// per game, one column per colony, all colonies running the same brain on the same map or on maps of the same generator. Statistics
// with fractions live here, outside core (docs/MATCH.md). The ranking points are those of `colonyResult`.
import { colonyResult } from './core/ranking.ts';

/** Two-sided p-value of a standard normal z (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
export function normalTwoSidedP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
}

export interface ColonyRow {
  colony: number;
  /** Games won, a tie for the most food counting 1 / (the colonies tied). */
  wins: number;
  /** wins / games: 1 / n when fair. */
  share: number;
  /** (wins - games / n) in standard deviations of a fair game, and the two-sided p-value of it. */
  z: number;
  p: number;
  /** Mean ranking points (n - 1 when fair) and mean nest food. */
  points: number;
  food: number;
}

export interface Fairness {
  games: number;
  colonies: number;
  rows: ColonyRow[];
  /** The smallest p of the colonies times the number of colonies (Bonferroni), at most 1: the chance of so uneven a split from fair play. */
  p: number;
  /** Half-width of the 95% interval of one colony's win share if play is fair: a bias below this cannot be seen with this many games. */
  resolution: number;
  /** No bias found at the level `alpha`: p >= alpha. That is not proof of fairness; see `resolution`. */
  fair: boolean;
  /** Fewer than MIN_EXPECTED expected wins per colony (games < MIN_EXPECTED * colonies): the normal approximation of the z-test is
   * poor there and false alarms exceed `alpha` (14% for 26 colonies and 100 games, simulated). Play more games before trusting `fair`. */
  thin: boolean;
}

/** Rule of thumb for the normal approximation of a win count: at least this many expected wins per colony. */
export const MIN_EXPECTED = 10;

export function fairness(foods: readonly (readonly number[])[], alpha = 0.05): Fairness {
  const games = foods.length, n = games > 0 ? foods[0].length : 0;
  if (games < 1 || n < 2 || foods.some((f) => f.length !== n)) throw new RangeError('fairness needs at least one game, each with the nest food of the same 2 or more colonies');
  const wins = new Array<number>(n).fill(0), points = new Array<number>(n).fill(0), food = new Array<number>(n).fill(0);
  for (const f of foods) {
    const top = Math.max(...f), leaders = f.filter((v) => v === top).length, res = colonyResult(f);
    for (let c = 0; c < n; c++) {
      if (f[c] === top) wins[c] += 1 / leaders;
      points[c] += res.points[c]; food[c] += f[c];
    }
  }
  const sd = Math.sqrt(games * (1 / n) * (1 - 1 / n));
  const rows: ColonyRow[] = wins.map((w, colony) => {
    const z = (w - games / n) / sd;
    return { colony, wins: w, share: w / games, z, p: normalTwoSidedP(z), points: points[colony] / games, food: food[colony] / games };
  });
  const p = Math.min(1, n * Math.min(...rows.map((r) => r.p)));
  return { games, colonies: n, rows, p, resolution: 1.96 * Math.sqrt(((1 / n) * (1 - 1 / n)) / games), fair: p >= alpha, thin: games < MIN_EXPECTED * n };
}
