// What the page needs to show a game of a batch in the viewer: the world as text, who sits on each hill, the seed. Outside core: it only
// describes games, it plays none. The replay of a `WatchSpec` ends in the numbers the batch recorded (test/watch.test.ts).
import { generateWorld } from './core/gen.ts';
import { formatMap } from './core/map.ts';
import { worldFor } from './core/match.ts';
import type { Task } from './core/match.ts';
import type { RulesId } from './core/rules.ts';
import { coloniesOf, worldMaker } from './fairness.ts';
import type { WorldSpec } from './fairness.ts';
import { leagueWorldOf, rotation } from './league.ts';
import type { LeagueTask, LeagueWorld } from './league.ts';

export interface WatchSpec {
  /** One line about the game: who, which world. */
  title: string;
  /** The world as map text (the viewer's replay engine takes text). */
  mapText: string;
  /** The brain on each hill, first hill first (hill A is red, hill B blue, ...), and its name. */
  brains: string[];
  hills: string[];
  rules: RulesId;
  /** The world seed, which is also the simulator seed of the games of a batch. */
  seed: number;
  /** The length of the game. */
  rounds: number;
}

const letter = (c: number): string => String.fromCharCode(65 + c);

/** A head-to-head game (`cli/tourney.ts`, and a sweep): entries `t.a` and `t.b` of `texts`/`names`; with `t.swap` entry a takes the second hill. */
export function watchHead(t: Task, o: { texts: readonly string[]; names: readonly string[]; rules: RulesId; rounds: number; symmetric: boolean }): WatchSpec {
  const pair = (x: readonly string[]): string[] => (t.swap ? [x[t.b], x[t.a]] : [x[t.a], x[t.b]]);
  const hills = pair(o.names);
  return { title: `${hills[0]} (red) vs ${hills[1]} (blue), world ${t.seed}${o.symmetric ? ' (mirrored)' : ''}`, mapText: formatMap(worldFor(t.seed, o.symmetric)),
    brains: pair(o.texts), hills, rules: o.rules, seed: t.seed, rounds: o.rounds };
}

/** A league game (`cli/league.ts`): the brains rotate round the hills. */
export function watchLeague(t: LeagueTask, o: { texts: readonly string[]; names: readonly string[]; rules: RulesId; rounds: number; world: LeagueWorld }): WatchSpec {
  const n = o.texts.length, order = rotation(n, t.rot), hills = order.map((e) => o.names[e]);
  return { title: `${hills.map((h, c) => (h === letter(c) ? h : `${h} (${letter(c)})`)).join(', ')}: world ${t.seed}, rotation ${t.rot}`, mapText: formatMap(leagueWorldOf(n, o.world, t.seed)),
    brains: order.map((e) => o.texts[e]), hills, rules: o.rules, seed: t.seed, rounds: o.rounds };
}

/** A fairness game (`cli/fairness.ts`): one brain on every hill of the world of `seed`. */
export function watchFair(seed: number, o: { text: string; name: string; rules: RulesId; rounds: number; world: WorldSpec }): WatchSpec {
  const map = worldMaker(o.world)(seed), n = coloniesOf(map);
  return { title: `${o.name} on every hill, world ${o.world.mapSeed ?? seed}, simulator seed ${seed}`, mapText: formatMap(map),
    brains: Array.from({ length: n }, () => o.text), hills: Array.from({ length: n }, () => o.name), rules: o.rules, seed, rounds: o.rounds };
}

/** The match of the workshop: one brain per colony on the map (no text: the contest generator's world of the seed). */
export function watchMatch(o: { texts: readonly string[]; names: readonly string[]; mapText?: string; seed: number; rules: RulesId; rounds: number }): WatchSpec {
  return { title: `${o.names.join(', ')}: seed ${o.seed}`, mapText: o.mapText ? o.mapText : formatMap(generateWorld(o.seed)),
    brains: [...o.texts], hills: [...o.names], rules: o.rules, seed: o.seed, rounds: o.rounds };
}
