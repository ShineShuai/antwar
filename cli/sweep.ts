#!/usr/bin/env node
// Sweep one Level 0 slider of a generated brain (docs/MATCH.md, docs/STEALING.md): the brain written at every level of the slider, each level
// against reference brains on the same worlds.
//   node cli/sweep.ts BRAIN --vs REFERENCE --param curiosity|boldness|sociability|settling [--seeds 20] [--from 1] [--rounds 100000]
//                     [--rules classic] [--symmetric] [--jobs N] [--json]
//        head to head: each level plays the reference on every world, once per colour, like cli/tourney.ts.
//   node cli/sweep.ts BRAIN REF1 [REF2 ...] --league --param ... [--seeds 20] [--from 1] [--rounds 100000] [--rules classic] [--world FILE] [--jobs N] [--json]
//        in a league: each level plays all the references at once, one colony each, every world once per rotation (cli/league.ts); a new
//        world per seed (mirrored for two brains, fair for more) or --world FILE. The level's points per game are compared with the fair share.
// BRAIN is a file the personality generator wrote (cli/personality.ts, or the workshop's sliders). Results do not depend on --jobs.
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { MATCH_ROUNDS } from '../src/core/match.ts';
import type { Game, Outcome, Task } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { headPlayer } from '../src/headtohead.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { leagueEngine, leagueTasks } from '../src/league.ts';
import type { LeagueGame, LeagueTask, LeagueWorld } from '../src/league.ts';
import { leagueSweepHeader, leagueSweepLines, leagueSweepRows, sweepHeader, sweepLines, sweepSummary, sweepTasks, sweepVariants } from '../src/sweep.ts';
import type { SweepParam } from '../src/sweep.ts';

type Setup = { kind: 'head'; texts: string[]; rules: RulesId; rounds: number; symmetric: boolean } | { kind: 'league'; texts: string[]; rules: RulesId; rounds: number; world: LeagueWorld };
type Item = Task | LeagueTask;
type Out = Outcome | number[];
const engine = (s: Setup): ((t: Item) => Out) => s.kind === 'head'
  ? headPlayer(s.texts.map((t) => loadAnyBrain(t, RULESETS[s.rules]).program), s) as (t: Item) => Out
  : leagueEngine(s.texts, s).play as (t: Item) => Out;

if (!isMainThread) {
  const run = engine(workerData as Setup);
  parentPort?.on('message', (m: { i: number; task: Item }) => parentPort?.postMessage({ i: m.i, out: run(m.task) }));
} else {
  const { values: o, positionals: files } = parseArgs({ allowPositionals: true, options: {
    vs: { type: 'string' }, param: { type: 'string' }, league: { type: 'boolean', default: false }, world: { type: 'string' }, seeds: { type: 'string', default: '20' }, from: { type: 'string', default: '1' },
    rounds: { type: 'string', default: String(MATCH_ROUNDS) }, rules: { type: 'string', default: 'classic' }, symmetric: { type: 'boolean', default: false },
    jobs: { type: 'string', default: String(Math.min(4, availableParallelism())) }, json: { type: 'boolean', default: false },
  } });
  const die = (m: string): never => { console.error(m); process.exit(2); };
  const int = (v: string, lo: number, what: string): number => (/^\d+$/.test(v) && Number(v) >= lo ? Number(v) : die(`${what} must be an integer >= ${lo}`));
  const usage = 'usage: sweep.ts BRAIN --vs REFERENCE --param P [--seeds N] [--from SEED] [--rounds N] [--rules R] [--symmetric] [--jobs N] [--json]\n   or: sweep.ts BRAIN REF1 [REF2 ...] --league --param P [--seeds N] [--from SEED] [--rounds N] [--rules R] [--world FILE] [--jobs N] [--json]';
  if (!o.param || (o.league ? files.length < 2 || o.vs !== undefined : files.length !== 1 || !o.vs)) die(usage);
  if (!Object.hasOwn(RULESETS, o.rules)) die(`unknown ruleset "${o.rules}"; try ${Object.keys(RULESETS).join(', ')}`);
  const nSeeds = int(o.seeds, 1, '--seeds'), from = int(o.from, 0, '--from'), rounds = int(o.rounds, 0, '--rounds'), jobs = int(o.jobs, 1, '--jobs');
  const param = o.param as SweepParam, rules = o.rules as RulesId;
  let variants: ReturnType<typeof sweepVariants>;
  try { variants = sweepVariants(readFileSync(files[0], 'utf8'), param); } catch (e) { variants = die(`${e instanceof Error ? e.message : String(e)} (see cli/personality.ts)`); }
  const seeds = Array.from({ length: nSeeds }, (_, k) => from + k);

  /** Plays the tasks of a setup on `jobs` worker threads; the outcomes come back in the order of the tasks. */
  const play = async (setup: Setup, tasks: Item[]): Promise<Out[]> => {
    const outs = new Array<Out>(tasks.length);
    if (jobs === 1) { const run = engine(setup); tasks.forEach((t, i) => { outs[i] = run(t); }); return outs; }
    const workers = Array.from({ length: Math.min(jobs, tasks.length) }, () => new Worker(new URL(import.meta.url), { workerData: setup }));
    await new Promise<void>((resolve, reject) => {
      let next = 0, done = 0;
      const feed = (w: Worker): void => { if (next < tasks.length) { const i = next++; w.postMessage({ i, task: tasks[i] }); } };
      for (const w of workers) { w.on('message', (m: { i: number; out: Out }) => { outs[m.i] = m.out; if (++done === tasks.length) resolve(); else feed(w); }); w.on('error', reject); feed(w); }
    }).finally(() => Promise.all(workers.map((w) => w.terminate())));
    return outs;
  };
  const check = (setup: Setup): void => { try { engine(setup); } catch (e) { die(`${e instanceof Error ? e.message : String(e)} (in the other brains, or the world)`); } };

  if (o.league) {
    const refs = files.slice(1), n = refs.length + 1, refTexts = refs.map((f) => readFileSync(f, 'utf8'));
    const world: LeagueWorld = o.world === undefined ? { kind: 'gen' } : { kind: 'map', mapText: readFileSync(o.world, 'utf8') };
    const setups = variants.map((v): Setup => ({ kind: 'league', texts: [v.text, ...refTexts], rules, rounds, world }));
    check(setups[0]);
    const tasks = leagueTasks(n, seeds), all: LeagueGame[][] = [];
    for (const setup of setups) all.push((await play(setup, tasks)).map((food, i) => ({ ...(tasks[i] as LeagueTask), food: food as number[] })));
    const rows = leagueSweepRows(variants, all, seeds, n), refNames = refs.map((f) => basename(f));
    if (o.json) {
      console.log(JSON.stringify({ config: { rules, rounds, seeds, param, world: o.world ?? 'generated' }, brain: files[0], refs, variants: rows.map((r, i) => ({ value: r.variant.value, label: r.variant.label, base: r.variant.base, stat: { ...r.stat, byWorld: undefined, byHill: undefined }, refs: r.refs, games: all[i] })) }));
    } else {
      console.log(leagueSweepHeader(basename(files[0]), param, refNames, nSeeds, o.world ?? (n === 2 ? 'point-mirror worlds' : `fair worlds for ${n} colonies`), rounds, rules, all.reduce((a, g) => a + g.length, 0)));
      for (const line of leagueSweepLines(param, rows, n, refNames)) console.log(line);
    }
  } else {
    const vsFile = o.vs as string, setup: Setup = { kind: 'head', texts: [...variants.map((v) => v.text), readFileSync(vsFile, 'utf8')], rules, rounds, symmetric: o.symmetric };
    check(setup);
    const tasks = sweepTasks(variants.length, seeds), outs = await play(setup, tasks);
    const games: Game[] = tasks.map((t, i) => ({ ...t, ...(outs[i] as Outcome) })), rows = sweepSummary(variants.length, games);
    if (o.json) {
      console.log(JSON.stringify({ config: { rules: o.rules, rounds, seeds, symmetric: o.symmetric, param }, brain: files[0], reference: vsFile,
        variants: variants.map((v, i) => ({ value: v.value, label: v.label, base: v.base, ...rows[i] })), games }));
    } else {
      console.log(sweepHeader(basename(files[0]), param, basename(vsFile), nSeeds, rounds, rules, o.symmetric, games.length));
      for (const line of sweepLines(param, variants, rows)) console.log(line);
    }
  }
}
