// Nest food (and ants alive) over time in one game, sampled every `every` rounds: what the workshop's Evaluate panel charts, and what
// `cli/series.ts` prints. Outside core: it takes no part in a game, it only watches one.
import { generateWorld } from './core/gen.ts';
import { parseMap } from './core/map.ts';
import { RULESETS } from './core/rules.ts';
import type { RulesId } from './core/rules.ts';
import { createSim } from './core/sim.ts';
import type { Program, WorldMap } from './core/types.ts';
import { loadAnyBrain } from './lang/index.ts';

export interface Series {
  every: number;
  rounds: number;
  /** The rounds sampled: 0, every, 2 * every, ... and the last round. */
  at: number[];
  /** `food[k][c]`: nest food of colony c at round `at[k]`; `alive[k][c]`: its ants still alive. */
  food: number[][];
  alive: number[][];
}

export interface SeriesJob {
  rules: RulesId;
  rounds: number;
  every: number;
  /** The world as map text (hills = colonies); without it the contest generator's world of the seed, for two brains. */
  mapText?: string;
}

/** The world of a series: the given map, or the contest generator's world of the seed (the workshop's default world). */
export const seriesWorld = (job: Pick<SeriesJob, 'mapText'>, seed: number): WorldMap => (job.mapText ? parseMap(job.mapText) : generateWorld(seed));

/** Plays one game of the given programs, one per hill, and samples it. The simulator seed is `seed` (and the world's, when generated). */
export function seriesGame(programs: readonly Program[], job: SeriesJob, seed: number): Series {
  if (!Number.isInteger(job.every) || job.every < 1) throw new RangeError('every must be a whole number of rounds, at least 1');
  if (!Number.isInteger(job.rounds) || job.rounds < 0) throw new RangeError('rounds must be a whole number, at least 0');
  const map = seriesWorld(job, seed), n = programs.length, hills = Math.max(2, 1 + Math.max(...map.hill));
  if (hills !== n) throw new RangeError(`the world has ${hills} colonies but ${n} brains were given`);
  const sim = createSim({ map, programs: [...programs], seed, rules: RULESETS[job.rules] });
  const out: Series = { every: job.every, rounds: job.rounds, at: [], food: [], alive: [] };
  const sample = (r: number): void => { out.at.push(r); out.food.push(Array.from(sim.score())); out.alive.push(Array.from({ length: n }, (_, c) => sim.alive(c))); };
  sample(0);
  for (let r = 0; r < job.rounds;) { const k = Math.min(job.every, job.rounds - r); sim.run(k); r += k; sample(r); }
  return out;
}

/** Compiles the brains (a bad one throws with its message) and plays the game. */
export const playSeries = (texts: readonly string[], job: SeriesJob, seed: number): Series =>
  seriesGame(texts.map((t) => loadAnyBrain(t, RULESETS[job.rules]).program), job, seed);

/** The `cli/series.ts` command that gives the same numbers; `files` are the brains, `worldFile` the map file (used when the job has a map). */
export const seriesCommand = (o: { files: string[]; seed: number; job: SeriesJob; worldFile: string }): string =>
  ['node cli/series.ts', ...o.files, o.job.mapText ? `--world ${o.worldFile}` : '', `--seed ${o.seed} --rounds ${o.job.rounds} --every ${o.job.every} --rules ${o.job.rules}`].filter(Boolean).join(' ');
