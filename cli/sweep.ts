#!/usr/bin/env node
// Sweep one Level 0 slider of a generated brain against a reference brain (docs/MATCH.md, docs/STEALING.md).
//   node cli/sweep.ts BRAIN --vs REFERENCE --param curiosity|boldness|sociability|settling [--seeds 20] [--from 1] [--rounds 100000]
//                     [--rules classic] [--symmetric] [--jobs N] [--json]
// BRAIN is a file the personality generator wrote (cli/personality.ts, or the workshop's sliders): its text is written at every level of the
// slider, and each level plays the reference on every world, once per colour, like cli/tourney.ts. Results do not depend on --jobs.
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
import { sweepHeader, sweepLines, sweepSummary, sweepTasks, sweepVariants } from '../src/sweep.ts';
import type { SweepParam } from '../src/sweep.ts';

interface Setup { texts: string[]; rules: RulesId; rounds: number; symmetric: boolean }
const engine = (s: Setup): ((t: Task) => Outcome) => headPlayer(s.texts.map((t) => loadAnyBrain(t, RULESETS[s.rules]).program), s);

if (!isMainThread) {
  const run = engine(workerData as Setup);
  parentPort?.on('message', (m: { i: number; task: Task }) => parentPort?.postMessage({ i: m.i, out: run(m.task) }));
} else {
  const { values: o, positionals: files } = parseArgs({ allowPositionals: true, options: {
    vs: { type: 'string' }, param: { type: 'string' }, seeds: { type: 'string', default: '20' }, from: { type: 'string', default: '1' },
    rounds: { type: 'string', default: String(MATCH_ROUNDS) }, rules: { type: 'string', default: 'classic' }, symmetric: { type: 'boolean', default: false },
    jobs: { type: 'string', default: String(Math.min(4, availableParallelism())) }, json: { type: 'boolean', default: false },
  } });
  const die = (m: string): never => { console.error(m); process.exit(2); };
  const int = (v: string, lo: number, what: string): number => (/^\d+$/.test(v) && Number(v) >= lo ? Number(v) : die(`${what} must be an integer >= ${lo}`));
  if (files.length !== 1 || !o.vs || !o.param) die('usage: sweep.ts BRAIN --vs REFERENCE --param curiosity|boldness|sociability|settling [--seeds N] [--from SEED] [--rounds N] [--rules R] [--symmetric] [--jobs N] [--json]');
  if (!Object.hasOwn(RULESETS, o.rules)) die(`unknown ruleset "${o.rules}"; try ${Object.keys(RULESETS).join(', ')}`);
  const nSeeds = int(o.seeds, 1, '--seeds'), from = int(o.from, 0, '--from'), rounds = int(o.rounds, 0, '--rounds'), jobs = int(o.jobs, 1, '--jobs');
  const param = o.param as SweepParam, vsFile = o.vs as string;
  let variants: ReturnType<typeof sweepVariants>;
  try { variants = sweepVariants(readFileSync(files[0], 'utf8'), param); } catch (e) { variants = die(`${e instanceof Error ? e.message : String(e)} (see cli/personality.ts)`); }
  const setup: Setup = { texts: [...variants.map((v) => v.text), readFileSync(vsFile, 'utf8')], rules: o.rules as RulesId, rounds, symmetric: o.symmetric };
  try { engine(setup); } catch (e) { die(`${e instanceof Error ? e.message : String(e)} (in the reference brain)`); }
  const seeds = Array.from({ length: nSeeds }, (_, k) => from + k), tasks = sweepTasks(variants.length, seeds), outs: Outcome[] = new Array<Outcome>(tasks.length);
  if (jobs === 1) {
    const run = engine(setup);
    tasks.forEach((t, i) => { outs[i] = run(t); });
  } else {
    const workers = Array.from({ length: Math.min(jobs, tasks.length) }, () => new Worker(new URL(import.meta.url), { workerData: setup }));
    await new Promise<void>((resolve, reject) => {
      let next = 0, done = 0;
      const feed = (w: Worker): void => { if (next < tasks.length) { const i = next++; w.postMessage({ i, task: tasks[i] }); } };
      for (const w of workers) {
        w.on('message', (m: { i: number; out: Outcome }) => { outs[m.i] = m.out; if (++done === tasks.length) resolve(); else feed(w); });
        w.on('error', reject);
        feed(w);
      }
    }).finally(() => Promise.all(workers.map((w) => w.terminate())));
  }
  const games: Game[] = tasks.map((t, i) => ({ ...t, ...outs[i] })), rows = sweepSummary(variants.length, games);
  if (o.json) {
    console.log(JSON.stringify({ config: { rules: o.rules, rounds, seeds, symmetric: o.symmetric, param }, brain: files[0], reference: vsFile,
      variants: variants.map((v, i) => ({ value: v.value, label: v.label, base: v.base, ...rows[i] })), games }));
  } else {
    console.log(sweepHeader(basename(files[0]), param, basename(vsFile), nSeeds, rounds, o.rules as RulesId, o.symmetric, games.length));
    for (const line of sweepLines(param, variants, rows)) console.log(line);
  }
}
