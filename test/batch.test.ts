// The Evaluate panel's engine: the pool plays exactly the games of cli/tourney.ts, whatever the number of workers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playGame, schedule, worldFor } from '../src/core/match.ts';
import type { Game, Outcome } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import { describe, headToHead, reproCommand } from '../src/headtohead.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { wilson } from '../src/stats.ts';
import { createBatchEngine } from '../web/batch-engine.ts';
import type { BatchReply, BatchRequest, BatchSetup } from '../web/batch-protocol.ts';
import { BatchError, Cancelled, runBatch } from '../web/pool.ts';
import type { WorkerLike } from '../web/pool.ts';

const fx = (f: string): string => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const root = (f: string): string => fileURLToPath(new URL(`../${f}`, import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0; void hasPython;
const STARTER = fx('starter.ant'), IDLE = 'Drop 0';
const setup: BatchSetup = { texts: [STARTER, IDLE], rules: 'classic', rounds: 300, symmetric: true };

/** A worker in this process: replies on a later tick, as a real one does. */
function fakeWorker(log: { made: number; terminated: number }): WorkerLike {
  const engine = createBatchEngine();
  log.made++;
  const w: WorkerLike = {
    onmessage: null, onerror: null,
    postMessage(m: BatchRequest) { const r = engine.handle(m); setTimeout(() => { if (!terminated) w.onmessage?.({ data: r }); }, 0); },
    terminate() { terminated = true; log.terminated++; },
  };
  let terminated = false;
  return w;
}

test('wilson: known values, symmetric around one half, narrower with more games', () => {
  const [lo, hi] = wilson(50, 100);
  assert.ok(Math.abs(lo - 0.4038) < 1e-3 && Math.abs(hi - 0.5962) < 1e-3, `${lo} ${hi}`);
  const [l2, h2] = wilson(0, 10);
  assert.equal(l2, 0, 'a clean zero, not -0.0'); assert.ok(Math.abs(h2 - 0.2775) < 1e-3);
  assert.equal(wilson(10, 10)[1], 1);
  assert.ok(wilson(500, 1000)[1] - wilson(500, 1000)[0] < hi - lo);
});

test('the pool plays the games of playGame, in task order, with any number of workers', async () => {
  const seeds = [1, 2, 3], tasks = schedule(2, seeds), rules = RULESETS.classic;
  const programs = setup.texts.map((t) => loadAnyBrain(t, rules).program);
  const expect: Outcome[] = tasks.map((t) => playGame(worldFor(t.seed, true), programs[t.a], programs[t.b], t, setup.rounds, rules));
  for (const size of [1, 2, 4, 99]) {
    const log = { made: 0, terminated: 0 }, seen: number[] = [];
    const outs = await runBatch(() => fakeWorker(log), size, setup, tasks, (n) => seen.push(n)).done;
    assert.deepEqual(outs, expect, `${size} workers`);
    assert.deepEqual(seen, [1, 2, 3, 4, 5, 6], 'progress counts every game once');
    assert.equal(log.made, Math.min(size, tasks.length)); assert.equal(log.terminated, log.made, 'all workers are released');
  }
});

test('the pool: nothing to play, a brain that does not compile, a worker that fails, cancel', async () => {
  const log = { made: 0, terminated: 0 };
  assert.deepEqual(await runBatch(() => fakeWorker(log), 2, setup, []).done, []);
  assert.equal(log.made, 0, 'no workers for no games');

  const bad = runBatch(() => fakeWorker(log), 2, { ...setup, texts: [STARTER, 'this is not a brain'] }, schedule(2, [1]));
  await assert.rejects(bad.done, (e: unknown) => e instanceof BatchError && e.brain === 1 && e.message.length > 0);
  assert.equal(log.terminated, log.made, 'released after the error');

  const broken: WorkerLike = { onmessage: null, onerror: null, postMessage() { setTimeout(() => broken.onerror?.({ message: 'boom' }), 0); }, terminate() {} };
  await assert.rejects(runBatch(() => broken, 1, setup, schedule(2, [1])).done, /boom/);

  const l2 = { made: 0, terminated: 0 }, run = runBatch(() => fakeWorker(l2), 2, setup, schedule(2, [1, 2, 3, 4, 5, 6]));
  run.cancel();
  await assert.rejects(run.done, Cancelled);
  assert.equal(l2.terminated, l2.made);
  run.cancel(); // twice is harmless
});

test('the engine: init errors name the brain; play before init; unknown ruleset', () => {
  const e = createBatchEngine();
  assert.equal(e.handle({ type: 'play', i: 0, task: { a: 0, b: 1, seed: 1, swap: false } }).type, 'error');
  const r = e.handle({ type: 'init', ...setup, texts: ['Drop 0', 'nope'] }) as Extract<BatchReply, { type: 'error' }>;
  assert.equal(r.type, 'error'); assert.equal(r.brain, 1);
  assert.equal(e.handle({ type: 'init', ...setup, rules: 'nope' as never }).type, 'error');
  assert.equal(e.handle({ type: 'init', ...setup }).type, 'ready');
});

test('headToHead and its text', () => {
  const g = (a: number, b: number, swap: boolean): Game => ({ a: 0, b: 1, seed: 1, swap, food: [a, b], alive: [1, 1], hash: 0 });
  const games = [g(5, 3, false), g(4, 4, true), g(0, 2, false), g(7, 1, true)];
  const h = headToHead(games);
  assert.deepEqual(h.a, { points: 5, wins: 2, draws: 1, losses: 1, margin: 6 });
  assert.deepEqual(h.b, { points: 3, wins: 1, draws: 1, losses: 2, margin: -6 });
  assert.equal(h.share, 5 / 8); assert.equal(h.leader, null, 'four games decide nothing');
  assert.deepEqual(h.hills, { first: 1, second: 2, draws: 1 });
  const many = Array.from({ length: 60 }, (_, k) => g(k % 10 === 0 ? 1 : 9, 3, k % 2 === 1));
  assert.equal(headToHead(many).leader, 'a');
  assert.equal(headToHead(many.map((x) => ({ ...x, food: [x.food[1], x.food[0]] as [number, number] }))).leader, 'b');
  const lines = describe(h, ['A', 'B']);
  assert.match(lines[0], /^A: 5\/8 points, 2 won, 1 drawn, 1 lost, food \+6, score 62\.5% \[/);
  assert.match(lines[1], /^B: 3\/8 points, 1 won, 1 drawn, 2 lost, food -6, score 37\.5% \[/);
  assert.match(lines[2], /^No clear difference/);
  assert.throws(() => headToHead([]), RangeError);
  assert.equal(reproCommand({ files: ['A.brain', 'B.brain'], seeds: 20, from: 1, rounds: 100000, rules: 'classic', symmetric: true }),
    'node cli/tourney.ts A.brain B.brain --seeds 20 --from 1 --rounds 100000 --rules classic --symmetric');
});

test('the panel and cli/tourney.ts play the same games (outcomes, hashes), and the command it shows runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h2h-'));
  try {
    writeFileSync(join(dir, 'A.brain'), STARTER); writeFileSync(join(dir, 'B.brain'), IDLE);
    const job = { files: ['A.brain', 'B.brain'] as [string, string], seeds: 2, from: 5, rounds: 300, rules: 'classic' as const, symmetric: true };
    const cmd = reproCommand(job).split(' ').slice(2).map((a) => (a.endsWith('.brain') ? join(dir, a) : a));
    const r = spawnSync('node', [root('cli/tourney.ts'), ...cmd, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const cli = JSON.parse(r.stdout) as { games: Game[] };
    const engine = createBatchEngine();
    assert.equal(engine.handle({ type: 'init', texts: [STARTER, IDLE], rules: 'classic', rounds: 300, symmetric: true }).type, 'ready');
    const mine = schedule(2, [5, 6]).map((t, i) => ({ ...t, ...(engine.handle({ type: 'play', i, task: t }) as Extract<BatchReply, { type: 'played' }>).out }));
    assert.deepEqual(mine, cli.games);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
