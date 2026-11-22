// A league of n brains: n colonies on a world, n games per world, the brains rotating round the hills so that each brain takes each hill
// once (a Latin square: the place of a hill cancels out, whether or not the world is fair). A game is scored by the ranking points of
// `colonyResult`, 2 for each colony out-scored and 1 for each tie. docs/MATCH.md.
import { colonyResult } from './core/ranking.ts';

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
