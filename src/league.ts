// A league of n brains: n colonies on a world, n games per world, the brains rotating round the hills so that each brain takes each hill
// once (a Latin square: the place of a hill cancels out, whether or not the world is fair). A game is scored by the ranking points of
// `colonyResult`, 2 for each colony out-scored and 1 for each tie. docs/MATCH.md.
import { generateFairWorld } from './core/gen.ts';
import { parseMap } from './core/map.ts';
import { playColonies, worldFor } from './core/match.ts';
import { colonyResult } from './core/ranking.ts';
import { RULESETS } from './core/rules.ts';
import { tCritical95 } from './stats.ts';
import type { RulesId } from './core/rules.ts';
import type { Program, WorldMap } from './core/types.ts';
import { loadAnyBrain } from './lang/index.ts';

/** The entry in each hill in rotation r of n entries: hill h has entry (h + r) mod n. Over r = 0 .. n - 1 every entry takes every hill once. */
export const rotation = (n: number, r: number): number[] => Array.from({ length: n }, (_, h) => (h + r) % n);

export interface LeagueTask { seed: number; rot: number }
/** A game played: `food` is the nest food by hill. */
export interface LeagueGame extends LeagueTask { food: number[] }

/** Every game of a league of n entries on the given world seeds, in a fixed order: seed, rotation. */
export function leagueTasks(n: number, seeds: readonly number[]): LeagueTask[] {
  const out: LeagueTask[] = [];
  for (const seed of seeds) for (let rot = 0; rot < n; rot++) out.push({ seed, rot });
  return out;
}

export interface LeagueRow {
  entry: number;
  games: number;
  points: number;
  /** Sum of the ranks (1 = most food) and the games taken outright (`firsts`) or shared (`shared`, tied for the most food). */
  rankSum: number;
  firsts: number;
  shared: number;
  food: number;
  /** The points this entry took from each hill, and from each world (key = seed), to see where they came from. */
  byHill: number[];
  byWorld: Map<number, number>;
}

/** The table by points, then nest food, then entry number. */
export function leagueTable(n: number, games: readonly LeagueGame[]): LeagueRow[] {
  const rows: LeagueRow[] = Array.from({ length: n }, (_, entry) => ({
    entry, games: 0, points: 0, rankSum: 0, firsts: 0, shared: 0, food: 0, byHill: new Array<number>(n).fill(0), byWorld: new Map<number, number>(),
  }));
  for (const g of games) {
    const who = rotation(n, g.rot), res = colonyResult(g.food), top = res.rank.filter((r) => r === 1).length;
    for (let h = 0; h < n; h++) {
      const r = rows[who[h]];
      r.games++; r.points += res.points[h]; r.rankSum += res.rank[h]; r.food += g.food[h]; r.byHill[h] += res.points[h];
      r.byWorld.set(g.seed, (r.byWorld.get(g.seed) ?? 0) + res.points[h]);
      if (res.rank[h] === 1) { if (top === 1) r.firsts++; else r.shared++; }
    }
  }
  return rows.sort((x, y) => y.points - x.points || y.food - x.food || x.entry - y.entry);
}

/** Where the worlds of a league come from: a world per seed (mirrored for two brains, or the contest generator with `contest`; fair worlds
 * for n colonies), or one given map whose hills are the brains (the simulator seed still changes per world number). */
export type LeagueWorld = { kind: 'gen'; contest?: boolean } | { kind: 'map'; mapText: string };

const WORLD_CACHE = 16; // the games of a world are close together in the schedule

/** The colonies of a world: one per hill, at least two. */
const coloniesIn = (m: WorldMap): number => Math.max(2, 1 + Math.max(...m.hill));

/** The world of a league game of `n` brains, from its seed: a given map, or a generated one (mirrored for two brains, fair for n). */
export function leagueWorldOf(n: number, world: LeagueWorld, seed: number): WorldMap {
  if (world.kind === 'map') return parseMap(world.mapText);
  if (n === 2) return worldFor(seed, !world.contest);
  if (world.contest) throw new RangeError('the contest generator is for two brains');
  return generateFairWorld(n, seed);
}

/** Plays the games of a league of the given brains. `world(seed)` is the world of a seed (throws when it cannot be made). */
export function leaguePlayer(programs: readonly Program[], o: { rules: RulesId; rounds: number; world: LeagueWorld }): { world(seed: number): WorldMap; play(t: LeagueTask): number[] } {
  const n = programs.length, rules = RULESETS[o.rules], worlds = new Map<number, WorldMap>();
  if (o.world.kind === 'gen' && o.world.contest && n !== 2) throw new RangeError('the contest generator is for two brains');
  const fixed = o.world.kind === 'map' ? parseMap(o.world.mapText) : undefined;
  const world = (seed: number): WorldMap => {
    let map = fixed ?? worlds.get(seed);
    if (!map) {
      map = leagueWorldOf(n, o.world, seed);
      if (worlds.size >= WORLD_CACHE) worlds.delete(worlds.keys().next().value as number);
      worlds.set(seed, map);
    }
    if (coloniesIn(map) !== n) throw new RangeError(`the world has ${coloniesIn(map)} colonies but ${n} brains were given`);
    return map;
  };
  return { world, play: (t) => playColonies(world(t.seed), rotation(n, t.rot).map((e) => programs[e]), t.seed, o.rounds, rules) };
}

/** Compiles the brains (a bad one throws with its message) and returns the player. */
export function leagueEngine(texts: readonly string[], o: { rules: RulesId; rounds: number; world: LeagueWorld }): ReturnType<typeof leaguePlayer> {
  return leaguePlayer(texts.map((t) => loadAnyBrain(t, RULESETS[o.rules]).program), o);
}

export interface LeagueStat extends LeagueRow {
  /** Mean points per game, the 95% half-width over the worlds (Student's t of the standard error: the worlds are the sample), mean rank. */
  mean: number; ci: number; rank: number;
}
export interface LeagueSummary { stats: LeagueStat[]; /** Mean points by hill: n - 1 each when the place does not matter. */ hillMean: number[] }

/** The table with its statistics: `seeds` are the worlds played. */
export function leagueSummary(n: number, games: readonly LeagueGame[], seeds: readonly number[]): LeagueSummary {
  const table = leagueTable(n, games), nSeeds = seeds.length;
  const stats = table.map((r) => {
    const per = seeds.map((s) => (r.byWorld.get(s) ?? 0) / n), mean = r.points / r.games;
    const sd = nSeeds > 1 ? Math.sqrt(per.reduce((a, x) => a + (x - mean) ** 2, 0) / (nSeeds - 1)) : 0;
    return { ...r, mean, ci: nSeeds > 1 ? (tCritical95(nSeeds - 1) * sd) / Math.sqrt(nSeeds) : 0, rank: r.rankSum / r.games };
  });
  return { stats, hillMean: Array.from({ length: n }, (_, h) => table.reduce((a, r) => a + r.byHill[h], 0) / (nSeeds * n)) };
}

/** What `cli/league.ts` prints under its first line, for brains called `names`. */
export function leagueLines(names: readonly string[], sum: LeagueSummary): string[] {
  const n = names.length, fair = n - 1, w = Math.max(5, ...names.map((x) => x.length));
  const out = [` # ${'brain'.padEnd(w)}  points  per game        rank  1st  shared  food`];
  sum.stats.forEach((r, k) => {
    const per = `${r.mean.toFixed(2)} +-${r.ci.toFixed(2)}`;
    out.push(`${String(k + 1).padStart(2)} ${names[r.entry].padEnd(w)}  ${String(r.points).padStart(6)}  ${per.padEnd(13)} ${r.rank.toFixed(2).padStart(5)}  ${String(r.firsts).padStart(3)}  ${String(r.shared).padStart(6)}  ${(r.food / r.games).toFixed(0).padStart(4)}`);
  });
  out.push('', `A game gives ${n * (n - 1)} points in all, ${fair} to each colony on average (+- is the 95% interval over the worlds).`,
    `Mean points by hill, ${fair} each when the place does not matter: ${sum.hillMean.map((x, h) => `${String.fromCharCode(65 + h)} ${x.toFixed(2)}`).join(', ')}`);
  return out;
}

/** The first line of a league report. */
export const leagueHeader = (n: number, seeds: readonly number[], world: string, rounds: number, rules: RulesId, games: number): string =>
  `${n} brains, ${seeds.length} worlds (seeds ${seeds[0]}..${seeds[seeds.length - 1]}; ${world}), ${n} rotations each, ${rounds} rounds, rules ${rules}; ${games} games`;

/** The `cli/league.ts` command that plays the same games; `files` are the brains, `world` the map file. */
export const leagueCommand = (o: { files: string[]; seeds: number; from: number; rounds: number; rules: RulesId; world?: LeagueWorld; worldFile: string }): string =>
  ['node cli/league.ts', ...o.files, `--seeds ${o.seeds} --from ${o.from} --rounds ${o.rounds} --rules ${o.rules}`,
    o.world?.kind === 'map' ? `--world ${o.worldFile}` : o.world?.contest ? '--contest' : ''].filter(Boolean).join(' ');
