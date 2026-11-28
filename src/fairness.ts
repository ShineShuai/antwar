// Behavioural fairness. A world is fair for a brain when that brain, in every colony, wins about equally often: each of n colonies
// should have the most food in 1/n of the games (equal food splits the win). This module judges a list of games, one row of nest food
// per game, one column per colony, all colonies running the same brain on the same map or on maps of the same generator. Statistics
// with fractions live here, outside core (docs/MATCH.md). The ranking points are those of `colonyResult`.
import { generateFairWorld } from './core/gen.ts';
import { parseMap } from './core/map.ts';
import { playColonies, worldFor } from './core/match.ts';
import { colonyResult } from './core/ranking.ts';
import type { RulesId } from './core/rules.ts';
import type { Program, Rules, WorldMap } from './core/types.ts';

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
  /** Two colonies and at least two games: colony A's nest food minus colony B's per game (`foodVsOthers`), a finer look than win chance. */
  pair?: FoodVsOthers;
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
  return { games, colonies: n, rows, p, resolution: 1.96 * Math.sqrt(((1 / n) * (1 - 1 / n)) / games), fair: p >= alpha, thin: games < MIN_EXPECTED * n,
    ...(n === 2 && games >= 2 ? { pair: foodVsOthers(foods)[0] } : {}) };
}

/** Where the worlds of a fairness run come from. `mapSeed` fixes the map (only the simulator seed varies, which tests the map); without
 * it every game has its own world from its seed (which tests the generator). `map` is one given world. */
export interface WorldSpec { kind: 'contest' | 'mirror' | 'fair' | 'map'; colonies?: number; mapSeed?: number; mapText?: string }

/** The colonies of a world: one per hill, at least two. */
export const coloniesOf = (m: WorldMap): number => Math.max(2, 1 + Math.max(...m.hill));

/** The world of a game, from its seed. Throws for a given map that does not parse or a fair world that cannot be made. */
export function worldMaker(spec: WorldSpec): (seed: number) => WorldMap {
  const fixed = spec.kind === 'map' ? parseMap(spec.mapText ?? '') : undefined;
  const make = (seed: number): WorldMap => (spec.kind === 'fair' ? generateFairWorld(spec.colonies ?? 2, seed) : worldFor(seed, spec.kind === 'mirror'));
  let cache: WorldMap | undefined;
  return (seed) => fixed ?? (spec.mapSeed !== undefined ? (cache ??= make(spec.mapSeed)) : make(seed));
}

/** One game with the same brain in every colony of the map: the nest food of each colony. */
export const fairGame = (map: WorldMap, program: Program, seed: number, rounds: number, rules: Rules): number[] =>
  playColonies(map, Array.from({ length: coloniesOf(map) }, () => program), seed, rounds, rules);

/** What a fairness run is about, as the first line of its report. `file` names a given map. */
export const worldLabel = (spec: WorldSpec, file = 'the map'): string => spec.kind === 'map' ? `map ${file}`
  : `${spec.kind === 'fair' ? `fair worlds, ${spec.colonies} colonies` : spec.kind === 'mirror' ? 'symmetric worlds' : 'contest worlds'}${spec.mapSeed !== undefined ? `, the map of seed ${spec.mapSeed}` : ', a new world per game'}`;

export const fairnessHeader = (brain: string, spec: WorldSpec, file: string, games: number, rounds: number, rules: RulesId): string =>
  `${brain} in every colony | ${worldLabel(spec, file)} | ${games} games of ${rounds} rounds | rules ${rules}`;

/** The table, the verdict and, for too few games, the warning: what `cli/fairness.ts` prints under its first line. */
/** z of the nest-food lean that is called out beside "no bias found" (two-sided p = 0.01): win chance is coarse, nest food sees a lean sooner. */
export const FOOD_LEAN_Z = 2.58;

export function fairnessLines(r: Fairness): string[] {
  const n = r.colonies, pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
  const out = ['colony  win chance  z       mean points  mean food'];
  for (const row of r.rows) out.push(`${String.fromCharCode(65 + row.colony).padEnd(7)} ${pct(row.share).padEnd(11)} ${row.z.toFixed(2).padStart(5)}   ${row.points.toFixed(2).padStart(11)}  ${row.food.toFixed(1).padStart(9)}`);
  out.push(`fair would be ${pct(1 / n)} each and ${n - 1} point${n === 2 ? '' : 's'}. ${r.fair ? 'No bias found' : 'BIASED'} (p = ${r.p.toFixed(3)}, Bonferroni over ${n} colonies); a bias below +-${pct(r.resolution)} of win chance cannot be seen with ${r.games} games.`);
  if (r.pair) { // two colonies: the paired nest food. A hint, not a verdict: the verdict is the win chance
    const a = r.pair;
    out.push(`nest food A - B per game: ${a.mean >= 0 ? '+' : '-'}${Math.abs(a.mean).toFixed(1)} +-${(1.96 * a.se).toFixed(1)} (95%), z = ${a.z.toFixed(2)}`);
    if (Math.abs(a.z) >= FOOD_LEAN_Z) out.push(`nest food leans to ${a.z > 0 ? 'A' : 'B'} (z = ${a.z.toFixed(2)}): the map may favour that colony a little; play more games to see whether win chance follows.`);
  }
  if (r.thin) out.push(`warning: under ${MIN_EXPECTED} expected wins per colony (${r.games} games, ${n} colonies): the test raises false alarms; use at least ${MIN_EXPECTED * n} games.`);
  return out;
}

/** The `cli/fairness.ts` command that plays the same games; `brain` and `world` are the files it reads. */
export function fairnessCommand(o: { brain: string; world: string; spec: WorldSpec; games: number; from: number; rounds: number; rules: RulesId }): string {
  const w = o.spec.kind === 'map' ? `--world ${o.world}` : o.spec.kind === 'fair' ? `--colonies ${o.spec.colonies}` : o.spec.kind === 'mirror' ? '--symmetric' : '';
  const seed = o.spec.mapSeed !== undefined ? `--map-seed ${o.spec.mapSeed}` : '';
  return ['node cli/fairness.ts', o.brain, w, seed, `--games ${o.games} --from ${o.from} --rounds ${o.rounds} --rules ${o.rules}`].filter(Boolean).join(' ');
}

export interface FoodVsOthers { colony: number; /** mean over the games of this colony's food minus the mean food of the others */ mean: number; /** standard error of that mean */ se: number; z: number }

/** A more sensitive look than win chance: per game, each colony's nest food against the mean of the others (the world is the same for all,
 * so the world's richness drops out). Under fair play every mean is 0. Several colonies are tested at once: compare |z| with the Bonferroni
 * threshold, and confirm anything found on fresh seeds. Needs at least 2 games and 2 colonies. */
export function foodVsOthers(foods: readonly (readonly number[])[]): FoodVsOthers[] {
  const G = foods.length, n = foods[0]?.length ?? 0;
  if (G < 2 || n < 2) throw new RangeError('needs at least 2 games of at least 2 colonies');
  return Array.from({ length: n }, (_, colony) => {
    const d = foods.map((f) => f[colony] - (f.reduce((a, x) => a + x, 0) - f[colony]) / (n - 1)), mean = d.reduce((a, x) => a + x, 0) / G;
    const se = Math.sqrt(d.reduce((a, x) => a + (x - mean) ** 2, 0) / (G - 1) / G);
    return { colony, mean, se, z: se > 0 ? mean / se : 0 };
  });
}
