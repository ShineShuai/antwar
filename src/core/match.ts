// Match layer: every pair plays every world twice, once per colour; a game is worth 2 (more nest food), 1 (equal) or 0
// points (reference, Matches tab). Integers only; statistics with fractions live in cli/tourney.ts. See docs/MATCH.md.
import { CLASSIC_WORLD, SYMMETRIC_WORLD, generateWorld } from './gen.ts';
import { points } from './ranking.ts';
import { CLASSIC, createSim } from './sim.ts';
import type { Program, Rules, WorldMap } from './types.ts';

/** A match is exactly this long (Classic). */
export const MATCH_ROUNDS = 100000;

/** Points for one game from the nest food of a colony and of its opponent (for more than two colonies: `colonyResult`). */
export { points };

/** The world of a seed: the contest generator, or its point-mirror symmetric variant for ranked matches. */
export const worldFor = (seed: number, symmetric: boolean): WorldMap => generateWorld(seed, symmetric ? SYMMETRIC_WORLD : CLASSIC_WORLD);

/** One game to play. `a` and `b` are entry numbers; with `swap`, `a` takes the second hill (the colony whose ants act later). */
export interface Task { a: number; b: number; seed: number; swap: boolean }
/** What a game came to, from the point of view of `task.a`. */
export interface Outcome {
  /** Nest food of a and of b at the end. */
  food: [number, number];
  /** Ants of a and of b still alive. */
  alive: [number, number];
  /** State hash after the last round: anyone can re-run the game and compare. */
  hash: number;
}
export type Game = Task & Outcome;

/** Play one game: the world and the simulator RNG both come from `task.seed`. */
export function playGame(map: WorldMap, a: Program, b: Program, task: Pick<Task, 'seed' | 'swap'>, rounds = MATCH_ROUNDS, rules: Rules = CLASSIC): Outcome {
  const sim = createSim({ map, programs: task.swap ? [b, a] : [a, b], seed: task.seed, rules });
  sim.run(rounds);
  const f = sim.score(), mine = task.swap ? 1 : 0;
  return { food: [f[mine], f[1 - mine]], alive: [sim.alive(mine), sim.alive(1 - mine)], hash: sim.hash() };
}

/** Every game of a round-robin among `entries` brains on the given world seeds, in a fixed order: pair, seed, colour. */
export function schedule(entries: number, seeds: readonly number[]): Task[] {
  const out: Task[] = [];
  for (let a = 0; a < entries; a++) {
    for (let b = a + 1; b < entries; b++) {
      for (const seed of seeds) for (const swap of [false, true]) out.push({ a, b, seed, swap });
    }
  }
  return out;
}

export interface Standing {
  entry: number; games: number; points: number; wins: number; draws: number; losses: number;
  /** Nest food won minus nest food lost, summed over the games (the ladder's tie-break). */
  margin: number;
}

/** Standings by points, then food margin, then entry number. */
export function standings(entries: number, games: readonly Game[]): Standing[] {
  const rows: Standing[] = Array.from({ length: entries }, (_, entry) => ({ entry, games: 0, points: 0, wins: 0, draws: 0, losses: 0, margin: 0 }));
  for (const g of games) {
    for (const [who, mine, theirs] of [[g.a, g.food[0], g.food[1]], [g.b, g.food[1], g.food[0]]] as const) {
      const r = rows[who], p = points(mine, theirs);
      r.games++; r.points += p; r.margin += mine - theirs;
      if (p === 2) r.wins++; else if (p === 1) r.draws++; else r.losses++;
    }
  }
  return rows.sort((x, y) => y.points - x.points || y.margin - x.margin || x.entry - y.entry);
}

/** `points[i][j]`: points entry i took from entry j (out of 2 per game); `games[i][j]`: games they played. */
export function pairwise(entries: number, games: readonly Game[]): { points: number[][]; games: number[][] } {
  const grid = (): number[][] => Array.from({ length: entries }, () => new Array<number>(entries).fill(0));
  const pts = grid(), n = grid();
  for (const g of games) {
    pts[g.a][g.b] += points(g.food[0], g.food[1]); pts[g.b][g.a] += points(g.food[1], g.food[0]);
    n[g.a][g.b]++; n[g.b][g.a]++;
  }
  return { points: pts, games: n };
}

/** Who won by hill: the first colony (acts first in a round), the second, or nobody. Identical brains on mirrored worlds expose the bias of the move order. */
export function colourSplit(games: readonly Game[]): { first: number; second: number; draws: number } {
  const out = { first: 0, second: 0, draws: 0 };
  for (const g of games) {
    if (g.food[0] === g.food[1]) out.draws++;
    else if ((g.food[0] > g.food[1]) === !g.swap) out.first++; // a won from the first hill, or b won while a sat on the second
    else out.second++;
  }
  return out;
}
