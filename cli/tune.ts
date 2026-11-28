#!/usr/bin/env node
// Tune a generated brain automatically (docs/TUNING.md): a hill climb over its Level 0 personality, scored against one reference brain.
//   node cli/tune.ts BRAIN --vs REFERENCE [--seeds 12] [--from 1] [--rounds 30000] [--rules classic] [--contest] [--objective margin|points]
//                    [--max-steps 6] [--z 2] [--mix] [--confirm 40] [--jobs N] [--state FILE --budget SECONDS] [--out FILE] [--json]
// BRAIN is a file the personality generator wrote (cli/personality.ts, or the workshop's sliders). Every step plays the brain and each
// brain one move away (a slider one level up or down; with --mix, 10 points of the role mix moved) against REFERENCE on --seeds fresh
// worlds, both colours, and takes the move whose paired gain has z >= --z. Worlds are mirrored (fair for two colonies; --contest: the
// contest generator's). --objective margin (default) climbs the relative nest-food margin, which shows small gains; points the ranking
// points. At the end the tuned brain and the start each play --confirm worlds no step used (0: skip).
// With --state FILE every game is kept in FILE; --budget SECONDS stops before the next evaluation once that time has passed and exits 3:
// run the same command again to go on (one command lasts at most a few minutes here, and the games are the same whatever --jobs).
// Exit codes: 0 done, 2 bad arguments, 3 out of budget (the run is saved).
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import type { Game, Outcome, Task } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { headPlayer } from '../src/headtohead.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { OBJECTIVES, climb, confirm, confirmLines, neighbors, stepLines, tuneHeader, worldScores } from '../src/tune.ts';
import type { Objective } from '../src/tune.ts';

interface Setup { texts: [string, string]; rules: RulesId; rounds: number; symmetric: boolean }
const engine = (s: Setup): ((t: Task) => Outcome) => headPlayer(s.texts.map((t) => loadAnyBrain(t, RULESETS[s.rules]).program), s);

if (!isMainThread) {
  let run: ((t: Task) => Outcome) | undefined;
  parentPort?.on('message', (m: { type: 'init'; setup: Setup } | { type: 'play'; i: number; task: Task }) => {
    if (m.type === 'init') { run = engine(m.setup); parentPort?.postMessage({ type: 'ready' }); } else parentPort?.postMessage({ type: 'done', i: m.i, out: (run as (t: Task) => Outcome)(m.task) });
  });
} else {
  const { values: o, positionals: files } = parseArgs({ allowPositionals: true, options: {
    vs: { type: 'string' }, seeds: { type: 'string', default: '12' }, from: { type: 'string', default: '1' }, rounds: { type: 'string', default: '30000' }, rules: { type: 'string', default: 'classic' },
    contest: { type: 'boolean', default: false }, objective: { type: 'string', default: 'margin' }, 'max-steps': { type: 'string', default: '6' }, z: { type: 'string', default: '2' },
    mix: { type: 'boolean', default: false }, confirm: { type: 'string', default: '40' }, jobs: { type: 'string', default: String(Math.min(4, availableParallelism())) },
    state: { type: 'string' }, budget: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean', default: false },
  } });
  const die = (m: string): never => { console.error(m); process.exit(2); };
  const int = (v: string, lo: number, what: string): number => (/^\d+$/.test(v) && Number(v) >= lo ? Number(v) : die(`${what} must be an integer >= ${lo}`));
  if (files.length !== 1 || !o.vs) die('usage: tune.ts BRAIN --vs REFERENCE [--seeds N] [--from SEED] [--rounds N] [--rules R] [--contest] [--objective margin|points] [--max-steps N] [--z Z] [--mix] [--confirm N] [--jobs N] [--state FILE --budget SECONDS] [--out FILE] [--json]');
  if (!Object.hasOwn(RULESETS, o.rules)) die(`unknown ruleset "${o.rules}"; try ${Object.keys(RULESETS).join(', ')}`);
  if (!OBJECTIVES.includes(o.objective as Objective)) die(`--objective is one of ${OBJECTIVES.join(', ')}`);
  if (o.budget !== undefined && o.state === undefined) die('--budget needs --state FILE: the games done so far are kept there');
  const nSeeds = int(o.seeds, 2, '--seeds'), from = int(o.from, 0, '--from'), rounds = int(o.rounds, 0, '--rounds'), maxSteps = int(o['max-steps'], 1, '--max-steps'), jobs = int(o.jobs, 1, '--jobs');
  const nConfirm = int(o.confirm, 0, '--confirm'), z = Number(o.z), budget = o.budget === undefined ? Infinity : int(o.budget, 1, '--budget');
  if (!(z > 0)) die('--z must be a number > 0');
  if (nConfirm === 1) die('--confirm needs 2 or more worlds (or 0)');
  const rules = o.rules as RulesId, objective = o.objective as Objective, symmetric = !o.contest;
  const vsFile = o.vs as string, startText = readFileSync(files[0], 'utf8'), refText = readFileSync(vsFile, 'utf8');
  try { neighbors(startText, o.mix); } catch (e) { die(`${e instanceof Error ? e.message : String(e)} (see cli/personality.ts)`); }
  try { engine({ texts: [startText, refText], rules, rounds, symmetric }); } catch (e) { die(`${e instanceof Error ? e.message : String(e)} (in the brain or the reference)`); }

  // ---- the games, kept in the state file
  const sig = JSON.stringify({ vs: refText, rules, rounds, symmetric });
  let cache: Record<string, Outcome[]> = {};
  if (o.state !== undefined) {
    let saved: { v: number; sig: string; games: Record<string, Outcome[]> } | undefined;
    try { saved = JSON.parse(readFileSync(o.state, 'utf8')); } catch { saved = undefined; }
    if (saved) { if (saved.v !== 1 || saved.sig !== sig) die(`${o.state} belongs to a run with another reference, ruleset, length or kind of world: use another file`); cache = saved.games; }
  }
  const save = (): void => { if (o.state !== undefined) { writeFileSync(`${o.state}.tmp`, JSON.stringify({ v: 1, sig, games: cache })); renameSync(`${o.state}.tmp`, o.state); } };

  const workers: Worker[] = jobs === 1 ? [] : Array.from({ length: jobs }, () => new Worker(new URL(import.meta.url)));
  for (const w of workers) w.on('error', (e) => { console.error(e); process.exit(1); });
  const once = (w: Worker, type: string): Promise<void> => new Promise((res) => { const h = (m: { type: string }): void => { if (m.type === type) { w.off('message', h); res(); } }; w.on('message', h); });
  const play = async (setup: Setup, tasks: Task[]): Promise<Outcome[]> => {
    if (workers.length === 0) { const run = engine(setup); return tasks.map(run); }
    await Promise.all(workers.map((w) => { const ready = once(w, 'ready'); w.postMessage({ type: 'init', setup }); return ready; }));
    const outs = new Array<Outcome>(tasks.length);
    await new Promise<void>((resolve) => {
      let next = 0, done = 0;
      const feed = (w: Worker): void => { if (next < tasks.length) { const i = next++; w.postMessage({ type: 'play', i, task: tasks[i] }); } };
      for (const w of workers) { w.on('message', (m: { type: string; i: number; out: Outcome }) => { if (m.type !== 'done') return; outs[m.i] = m.out; if (++done === tasks.length) resolve(); else feed(w); }); feed(w); }
    }).finally(() => workers.forEach((w) => w.removeAllListeners('message')));
    return outs;
  };
  class OutOfBudget extends Error {}
  const t0 = performance.now();
  let played = 0, cached = 0;
  /** The games of `text` against the reference on these worlds, both colours (from the state file when played before). */
  const games = async (text: string, seeds: readonly number[]): Promise<Game[]> => {
    const tasks: Task[] = seeds.flatMap((seed) => [false, true].map((swap) => ({ a: 0, b: 1, seed, swap }))), key = `${seeds[0]}+${seeds.length}|${text}`;
    if (cache[key]) cached++;
    else {
      if ((performance.now() - t0) / 1000 > budget) throw new OutOfBudget();
      cache[key] = await play({ texts: [text, refText], rules, rounds, symmetric }, tasks); played++; save();
    }
    return tasks.map((t, i) => ({ ...t, ...cache[key][i] }));
  };

  const name = basename(files[0]), vs = basename(vsFile);
  const log = (...l: string[]): void => { if (!o.json) for (const x of l) console.log(x); };
  log(tuneHeader(name, vs, { objective, seeds: nSeeds, rounds, rules: o.rules, symmetric, z, maxSteps }));
  try {
    const result = await climb(startText, async (text, seeds) => worldScores(await games(text, seeds), objective), { seeds: nSeeds, from, maxSteps, z, mix: o.mix }, (rec) => log('', ...stepLines(rec)));
    log('', result.stopped === 'optimum' ? 'The climb stopped: no move has a clear gain.' : `The climb stopped after ${maxSteps} steps (--max-steps).`);
    log(result.path.length ? `path: ${result.path.map((m) => m.label).join('; ')}` : 'The brain did not change.');
    let confirmation;
    if (result.best !== startText && nConfirm > 0) {
      const seeds = Array.from({ length: nConfirm }, (_, i) => from + 1_000_000 + i);
      confirmation = confirm(await games(startText, seeds), await games(result.best, seeds));
      log('', ...confirmLines(confirmation, vs, nConfirm));
    }
    if (o.out !== undefined) { writeFileSync(o.out, result.best); log('', `The tuned brain is in ${o.out}.`); }
    if (o.json) console.log(JSON.stringify({ config: { brain: files[0], vs: vsFile, rules, rounds, symmetric, objective, seeds: nSeeds, from, maxSteps, z, mix: o.mix, confirm: nConfirm }, steps: result.steps, stopped: result.stopped, path: result.path, best: result.best, ...(confirmation ? { confirmation } : {}) }));
    process.exitCode = 0;
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
    console.error(`out of budget after ${played} candidates played (${cached} from ${o.state}): run the same command again to go on.`);
    process.exitCode = 3;
  } finally { await Promise.all(workers.map((w) => w.terminate())); }
}
