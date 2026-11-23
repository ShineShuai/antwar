// Two brains on the same worlds, both colours: the summary the workshop's Evaluate panel shows, and the command that reproduces it.
// The games are those of `cli/tourney.ts A B` (docs/MATCH.md): schedule(2, seeds) played by playGame.
import { colourSplit, playGame, standings, worldFor } from './core/match.ts';
import type { Game, Outcome, Task } from './core/match.ts';
import { RULESETS } from './core/rules.ts';
import type { RulesId } from './core/rules.ts';
import type { Program, WorldMap } from './core/types.ts';
import { wilson } from './stats.ts';

export interface Side { points: number; wins: number; draws: number; losses: number; /** nest food won minus lost, summed over the games */ margin: number }
export interface HeadToHead {
  games: number; a: Side; b: Side;
  /** Brain a's score: (wins + draws / 2) / games, and its 95% Wilson interval. */
  share: number; interval: [number, number];
  /** Whose 95% interval of the score excludes 50%; null when neither does. */
  leader: 'a' | 'b' | null;
  /** Wins by hill (identical brains on mirrored worlds expose the move order). */
  hills: { first: number; second: number; draws: number };
}

/** Summarise games of entries 0 (a) and 1 (b). */
export function headToHead(games: readonly Game[]): HeadToHead {
  if (games.length === 0) throw new RangeError('no games');
  const rows = standings(2, games), side = (entry: number): Side => {
    const { points, wins, draws, losses, margin } = rows.find((r) => r.entry === entry) as (typeof rows)[number];
    return { points, wins, draws, losses, margin };
  };
  const a = side(0), b = side(1), n = games.length, score = a.wins + a.draws / 2, interval = wilson(score, n);
  return { games: n, a, b, share: score / n, interval, leader: interval[0] > 0.5 ? 'a' : interval[1] < 0.5 ? 'b' : null, hills: colourSplit(games) };
}

export interface Job { files: [string, string]; seeds: number; from: number; rounds: number; rules: RulesId; symmetric: boolean }

/** The `cli/tourney.ts` command that plays the same games. */
export const reproCommand = (j: Job): string =>
  `node cli/tourney.ts ${j.files.join(' ')} --seeds ${j.seeds} --from ${j.from} --rounds ${j.rounds} --rules ${j.rules}${j.symmetric ? ' --symmetric' : ''}`;

/** The result as text lines, for brains called `names`. */
export function describe(h: HeadToHead, names: readonly [string, string]): string[] {
  const pct = (x: number): string => (100 * x).toFixed(1), margin = (m: number): string => (m >= 0 ? '+' : '') + m;
  const row = (name: string, s: Side, score: number, lo: number, hi: number): string =>
    `${name}: ${s.points}/${2 * h.games} points, ${s.wins} won, ${s.draws} drawn, ${s.losses} lost, food ${margin(s.margin)}, score ${pct(score)}% [${pct(lo)}, ${pct(hi)}]`;
  const [lo, hi] = h.interval;
  return [
    row(names[0], h.a, h.share, lo, hi),
    row(names[1], h.b, 1 - h.share, 1 - hi, 1 - lo),
    h.leader ? `${names[h.leader === 'a' ? 0 : 1]} is ahead: the 95% interval of its score excludes 50%.`
      : 'No clear difference: the 95% interval of the score includes 50%, which is not proof that the brains are equal.',
    `${h.games} games, both colours on every world; games on one world are not independent, so the interval is approximate.`,
    `wins by hill: first ${h.hills.first}, second ${h.hills.second}, draws ${h.hills.draws} (the first hill's ants act first in a round).`,
  ];
}

const WORLD_CACHE = 16; // the games of a world (both colours, and every variant of a sweep) are close together in a schedule

/** Plays the games of a head-to-head batch: `t.a` and `t.b` are indices into `programs`; the world and the simulator seed come from `t.seed`. */
export function headPlayer(programs: readonly Program[], o: { rules: RulesId; rounds: number; symmetric: boolean }): (t: Task) => Outcome {
  const worlds = new Map<number, WorldMap>(), rules = RULESETS[o.rules];
  return (t) => {
    let map = worlds.get(t.seed);
    if (!map) {
      map = worldFor(t.seed, o.symmetric);
      if (worlds.size >= WORLD_CACHE) worlds.delete(worlds.keys().next().value as number);
      worlds.set(t.seed, map);
    }
    return playGame(map, programs[t.a], programs[t.b], t, o.rounds, rules);
  };
}
