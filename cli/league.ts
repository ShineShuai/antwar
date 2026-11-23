#!/usr/bin/env node
// A league of n brains, n colonies on every world, n games per world with the brains rotating round the hills (docs/MATCH.md).
//   node cli/league.ts A.ant B.rules C.asm [...] [--seeds 20] [--from 1] [--rounds 100000] [--rules R] [--world FILE | --contest]
//                      [--jobs N] [--json] [--games]
// Worlds: for two brains point-mirror worlds, for more fair worlds for n colonies (n = 13, 17, 19, 23 and 26 have none: use --world), or
// one --world FILE whose hills are the brains (the simulator seed still changes per world number). --contest: the contest generator (two
// brains). The rules default to classic (any number of brains). A game is scored 2 points for each colony with less food and 1
// for each tie; the same brain may be listed twice (then the table shows what the place alone is worth). Results do not depend on --jobs.
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { MATCH_ROUNDS } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { leagueEngine, leagueHeader, leagueLines, leagueSummary, leagueTasks, rotation } from '../src/league.ts';
import type { LeagueGame, LeagueTask, LeagueWorld } from '../src/league.ts';

interface Setup { texts: string[]; rules: RulesId; rounds: number; world?: string; contest: boolean }

/** The brains compiled once, worlds cached by seed (src/league.ts). */
const engine = (s: Setup): ((t: LeagueTask) => number[]) =>
  leagueEngine(s.texts, { rules: s.rules, rounds: s.rounds, world: (s.world === undefined ? { kind: 'gen', contest: s.contest } : { kind: 'map', mapText: s.world }) satisfies LeagueWorld }).play;

if (!isMainThread) {
  const run = engine(workerData as Setup);
  parentPort?.on('message', (m: { i: number; task: LeagueTask }) => {
    try { parentPort?.postMessage({ i: m.i, food: run(m.task) }); } catch (e) { parentPort?.postMessage({ i: m.i, error: e instanceof Error ? e.message : String(e) }); }
  });
} else {
  const { values: o, positionals: files } = parseArgs({ allowPositionals: true, options: {
    seeds: { type: 'string', default: '20' }, from: { type: 'string', default: '1' }, rounds: { type: 'string', default: String(MATCH_ROUNDS) },
    rules: { type: 'string' }, world: { type: 'string' }, contest: { type: 'boolean', default: false },
    jobs: { type: 'string', default: String(Math.min(4, availableParallelism())) }, json: { type: 'boolean', default: false }, games: { type: 'boolean', default: false },
  } });
  const die = (m: string): never => { console.error(m); process.exit(2); };
  const int = (v: string, lo: number, what: string): number => (/^\d+$/.test(v) && Number(v) >= lo ? Number(v) : die(`${what} must be an integer >= ${lo}`));
  const n = files.length;
  if (n < 2 || n > 26) die('usage: league.ts A B [C ...] (2 to 26 brains) [--seeds N] [--from SEED] [--rounds N] [--rules R] [--world FILE | --contest] [--jobs N] [--json] [--games]');
  if (o.world !== undefined && o.contest) die('--world and --contest exclude each other');
  if (o.contest && n !== 2) die('--contest is the two-colony contest generator; use two brains');
  const rulesId = (o.rules ?? 'classic') as RulesId;
  if (!Object.hasOwn(RULESETS, rulesId)) die(`unknown ruleset "${rulesId}"; try ${Object.keys(RULESETS).join(', ')}`);
  const nSeeds = int(o.seeds, 1, '--seeds'), from = int(o.from, 0, '--from'), rounds = int(o.rounds, 0, '--rounds'), jobs = int(o.jobs, 1, '--jobs');
  const seeds = Array.from({ length: nSeeds }, (_, k) => from + k);
  // names: the file name, the whole path when two files share a name, name#k when the same file is listed twice
  const names = files.map((f, i) => {
    const b = basename(f), same = files.filter((g) => g === f).length, k = files.slice(0, i + 1).filter((g) => g === f).length;
    return same > 1 ? `${b}#${k}` : files.some((g, j) => j !== i && basename(g) === b) ? f : b;
  });
  const setup: Setup = { texts: files.map((f) => readFileSync(f, 'utf8')), rules: rulesId, rounds, world: o.world === undefined ? undefined : readFileSync(o.world, 'utf8'), contest: o.contest };
  const tasks = leagueTasks(n, seeds), foods: number[][] = new Array<number[]>(tasks.length);
  try {
    const run = engine(setup); // also compiles the brains here: a bad brain is reported once, not by every worker
    if (jobs === 1) {
      tasks.forEach((t, i) => { foods[i] = run(t); });
    } else {
      const workers = Array.from({ length: Math.min(jobs, tasks.length) }, () => new Worker(new URL(import.meta.url), { workerData: setup }));
      await new Promise<void>((resolve, reject) => {
        let next = 0, done = 0;
        const feed = (w: Worker): void => { if (next < tasks.length) { const i = next++; w.postMessage({ i, task: tasks[i] }); } };
        for (const w of workers) {
          w.on('message', (m: { i: number; food?: number[]; error?: string }) => {
            if (m.food === undefined) { reject(new Error(m.error)); return; }
            foods[m.i] = m.food;
            if (++done === tasks.length) resolve(); else feed(w);
          });
          w.on('error', reject);
          feed(w);
        }
      }).finally(() => Promise.all(workers.map((w) => w.terminate())));
    }
  } catch (e) { die(`${e instanceof Error ? e.message : String(e)}`); }
  const games: LeagueGame[] = tasks.map((t, i) => ({ ...t, food: foods[i] }));
  const summary = leagueSummary(n, games, seeds), { stats, hillMean } = summary;
  if (o.json) {
    console.log(JSON.stringify({ config: { rules: rulesId, rounds, seeds, world: o.world ?? (n === 2 ? (o.contest ? 'contest' : 'mirror') : 'fair') }, entries: names,
      table: stats.map((r) => ({ entry: r.entry, name: names[r.entry], games: r.games, points: r.points, mean: r.mean, ci: r.ci, rank: r.rank, firsts: r.firsts, shared: r.shared, food: r.food / r.games, byHill: r.byHill })), meanPointsByHill: hillMean, games }));
  } else {
    const world = o.world ?? (n === 2 ? (o.contest ? 'contest worlds' : 'point-mirror worlds') : `fair worlds for ${n} colonies`);
    console.log(leagueHeader(n, seeds, world, rounds, rulesId, games.length));
    for (const line of leagueLines(names, summary)) console.log(line);
    if (o.games) for (const g of games) console.log(`seed ${g.seed} rotation ${g.rot}: ${rotation(n, g.rot).map((e, h) => `${names[e]} ${g.food[h]}`).join(', ')}`);
  }
}
