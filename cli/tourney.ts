#!/usr/bin/env node
// Round-robin tournament: every pair plays every world twice, once per colour; a game is 2 / 1 / 0 points (docs/MATCH.md).
//   node cli/tourney.ts A.ant B.rules C.asm ... [--seeds 20] [--from 1] [--rounds 100000] [--rules classic]
//                       [--symmetric] [--jobs N] [--json] [--games]
// Brains: official .ant, flat assembly or .rules (by content). The world and the simulator RNG of a game both come from its
// seed; --symmetric uses point-mirror worlds (ranked). Results do not depend on --jobs.
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { MATCH_ROUNDS, colourSplit, pairwise, schedule, standings } from '../src/core/match.ts';
import type { Game, Outcome, Task } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { headPlayer } from '../src/headtohead.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { wilson } from '../src/stats.ts';

interface Setup { texts: string[]; rules: RulesId; rounds: number; symmetric: boolean }

/** Everything needed to play tasks: the brains compiled once, worlds cached by seed (src/headtohead.ts). */
const engine = (s: Setup): ((t: Task) => Outcome) => headPlayer(s.texts.map((t) => loadAnyBrain(t, RULESETS[s.rules]).program), s);

if (!isMainThread) {
  const run = engine(workerData as Setup);
  parentPort?.on('message', (m: { i: number; task: Task }) => parentPort?.postMessage({ i: m.i, out: run(m.task) }));
} else {
  const { values: o, positionals: files } = parseArgs({ allowPositionals: true, options: {
    seeds: { type: 'string', default: '20' }, from: { type: 'string', default: '1' }, rounds: { type: 'string', default: String(MATCH_ROUNDS) },
    rules: { type: 'string', default: 'classic' }, symmetric: { type: 'boolean', default: false }, jobs: { type: 'string', default: String(Math.min(4, availableParallelism())) },
    json: { type: 'boolean', default: false }, games: { type: 'boolean', default: false },
  } });
  const die = (m: string): never => { console.error(m); process.exit(2); };
  const int = (v: string, lo: number, what: string): number => (/^\d+$/.test(v) && Number(v) >= lo ? Number(v) : die(`${what} must be an integer >= ${lo}`));
  if (files.length < 2) die('usage: tourney.ts A B [C ...] [--seeds N] [--from SEED] [--rounds N] [--rules R] [--symmetric] [--jobs N] [--json] [--games]');
  if (!Object.hasOwn(RULESETS, o.rules)) die(`unknown ruleset "${o.rules}"; try ${Object.keys(RULESETS).join(', ')}`);
  const nSeeds = int(o.seeds, 1, '--seeds'), from = int(o.from, 0, '--from'), rounds = int(o.rounds, 0, '--rounds'), jobs = int(o.jobs, 1, '--jobs');
  const seeds = Array.from({ length: nSeeds }, (_, k) => from + k);
  const base = files.map((f) => basename(f)), names = base.map((b, i) => (base.indexOf(b) === i && base.lastIndexOf(b) === i ? b : files[i]));
  const setup: Setup = { texts: files.map((f) => readFileSync(f, 'utf8')), rules: o.rules as RulesId, rounds, symmetric: o.symmetric };
  try { engine(setup); } catch (e) { die(`${e instanceof Error ? e.message : String(e)} (in one of the brains)`); }

  const tasks = schedule(files.length, seeds), outs: Outcome[] = new Array<Outcome>(tasks.length);
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
  const games: Game[] = tasks.map((t, i) => ({ ...t, ...outs[i] }));
  const table = standings(files.length, games), pair = pairwise(files.length, games), split = colourSplit(games);

  if (o.json) {
    console.log(JSON.stringify({ config: { rules: o.rules, rounds, seeds, symmetric: o.symmetric }, entries: names, standings: table, pairwise: pair, colourSplit: split, games }));
  } else {
    console.log(`${files.length} brains, ${nSeeds} worlds (seeds ${from}..${from + nSeeds - 1}${o.symmetric ? ', symmetric' : ''}), both colours, ${rounds} rounds, rules ${o.rules}; ${games.length} games`);
    const w = Math.max(5, ...names.map((n) => n.length));
    console.log(`${' #'} ${'brain'.padEnd(w)}  points   W   D   L   food +/-  score% [95% interval]`);
    table.forEach((r, k) => {
      const [lo, hi] = wilson(2 * r.wins + r.draws, 2 * r.games), pct = (x: number): string => (100 * x).toFixed(1);
      console.log(`${String(k + 1).padStart(2)} ${names[r.entry].padEnd(w)}  ${String(r.points).padStart(6)} ${String(r.wins).padStart(3)} ${String(r.draws).padStart(3)} ${String(r.losses).padStart(3)}` +
        `  ${(r.margin >= 0 ? '+' : '') + r.margin}`.padEnd(11) + ` ${pct((r.wins + r.draws / 2) / r.games).padStart(5)}  [${pct(lo)}, ${pct(hi)}]`);
    });
    console.log('\npoints taken by the row brain from the column brain (of 2 per game):');
    console.log(`${''.padEnd(w)}  ${names.map((n) => n.slice(0, 8).padStart(8)).join(' ')}`);
    names.forEach((n, i) => console.log(`${n.padEnd(w)}  ${names.map((_, j) => (i === j ? '       -' : `${pair.points[i][j]}/${2 * pair.games[i][j]}`.padStart(8))).join(' ')}`));
    console.log(`\nwins by hill: first ${split.first}, second ${split.second}, draws ${split.draws} (the first hill's ants act first in a round)`);
    if (o.games) {
      for (const g of games) console.log(`${names[g.a]} vs ${names[g.b]}  seed ${g.seed}${g.swap ? ' swapped' : ''}: food ${g.food[0]}-${g.food[1]}  alive ${g.alive[0]}-${g.alive[1]}  hash ${g.hash}`);
    }
  }
}
