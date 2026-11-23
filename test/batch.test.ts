// The Evaluate panel's engine: the pool plays exactly the games of cli/tourney.ts, whatever the number of workers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFairWorld, generateWorld } from '../src/core/gen.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { playGame, schedule, worldFor } from '../src/core/match.ts';
import type { Game, Outcome } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { coloniesOf, fairness, fairnessCommand, fairnessHeader, fairnessLines, worldMaker } from '../src/fairness.ts';
import type { WorldSpec } from '../src/fairness.ts';
import { describe, headToHead, reproCommand } from '../src/headtohead.ts';
import { leagueCommand, leagueHeader, leagueLines, leagueSummary, leagueTasks } from '../src/league.ts';
import type { LeagueGame, LeagueWorld } from '../src/league.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { wilson } from '../src/stats.ts';
import { createBatchEngine } from '../web/batch-engine.ts';
import type { BatchReply, BatchRequest, FairOut } from '../web/batch-protocol.ts';
import { mapTextOf, worldSpec } from '../web/evaluate.ts';
import { BatchError, Cancelled, runBatch } from '../web/pool.ts';
import type { WorkerLike } from '../web/pool.ts';

const fx = (f: string): string => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const root = (f: string): string => fileURLToPath(new URL(`../${f}`, import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0; void hasPython;
const STARTER = fx('starter.ant'), IDLE = 'Drop 0';
const setup = { kind: 'head' as const, texts: [STARTER, IDLE], rules: 'classic' as const, rounds: 300, symmetric: true };

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

test('the pool finishes without a progress callback', async () => {
  const log = { made: 0, terminated: 0 };
  const outs = await runBatch(() => fakeWorker(log), 2, setup, schedule(2, [1, 2])).done;
  assert.equal(outs.length, 4); assert.ok(outs.every((o) => o.food.length === 2));
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
  const r = e.handle({ type: 'init', setup: { ...setup, texts: ['Drop 0', 'nope'] } }) as Extract<BatchReply, { type: 'error' }>;
  assert.equal(r.type, 'error'); assert.equal(r.brain, 1);
  assert.equal(e.handle({ type: 'init', setup: { ...setup, rules: 'nope' as never } }).type, 'error');
  assert.equal(e.handle({ type: 'init', setup }).type, 'ready');
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
    assert.equal(engine.handle({ type: 'init', setup }).type, 'ready');
    const mine = schedule(2, [5, 6]).map((t, i) => ({ ...t, ...(engine.handle({ type: 'play', i, task: t }) as Extract<BatchReply, { type: 'played' }>).out }));
    assert.deepEqual(mine, cli.games);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- one brain in every colony (the panel's fairness block, cli/fairness.ts)
const TRAIL = readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8');

/** The games of a fairness run in this process, as the panel's engine plays them. */
function engineFoods(world: WorldSpec, seeds: number[], rounds: number, rules: RulesId = 'classic'): number[][] {
  const e = createBatchEngine(), ready = e.handle({ type: 'init', setup: { kind: 'fair', text: TRAIL, rules, rounds, world } });
  assert.equal(ready.type, 'ready', JSON.stringify(ready));
  return seeds.map((seed, i) => ((e.handle({ type: 'play', i, task: { seed } }) as Extract<BatchReply, { type: 'played' }>).out as FairOut).food);
}

test('worldSpec: what the picker says the map is, and what can be asked of it', () => {
  const w = (kind: string, mapText = '') => ({ kind, mapText, seed: 7 });
  assert.deepEqual(worldSpec(w(''), true), { kind: 'contest', mapSeed: 7 });
  assert.deepEqual(worldSpec(w(''), false), { kind: 'contest' });
  assert.deepEqual(worldSpec(w('mirror'), true), { kind: 'mirror', mapSeed: 7 });
  assert.deepEqual(worldSpec(w('fair6'), false), { kind: 'fair', colonies: 6 });
  assert.deepEqual(worldSpec(w('fair3'), true), { kind: 'fair', colonies: 3, mapSeed: 7 });
  assert.deepEqual(worldSpec(w('4', 'MAP'), true), { kind: 'map', mapText: 'MAP' }, 'a ring example is one map');
  assert.equal(worldSpec(w('4', 'MAP'), false), undefined, 'and cannot be generated again');
  assert.deepEqual(worldSpec(w('custom', 'MAP'), true), { kind: 'map', mapText: 'MAP' });
  assert.equal(worldSpec(w('custom', 'MAP'), false), undefined);
});

test('worldMaker: a fixed map stays, a map seed fixes the generator, else a world per seed; bad specs throw', () => {
  const fixed = worldMaker({ kind: 'fair', colonies: 3, mapSeed: 4 });
  assert.equal(fixed(1), fixed(99), 'the same map object for every game');
  const per = worldMaker({ kind: 'fair', colonies: 3 });
  assert.notDeepEqual(per(1).rock, per(2).rock);
  assert.equal(coloniesOf(per(1)), 3);
  assert.equal(coloniesOf(worldMaker({ kind: 'mirror' })(3)), 2);
  assert.equal(coloniesOf(worldMaker({ kind: 'map', mapText: formatMap(generateFairWorld(4, 1)) })(5)), 4);
  assert.throws(() => worldMaker({ kind: 'fair', colonies: 13 })(1), /no fair world for 13/);
  assert.throws(() => worldMaker({ kind: 'map', mapText: 'not a map' }));
});

test('fairness batches: any number of workers gives the games of fairGame; init errors come back as errors', async () => {
  const world: WorldSpec = { kind: 'fair', colonies: 3, mapSeed: 1 }, seeds = [1, 2, 3, 4, 5];
  const expect = engineFoods(world, seeds, 600);
  assert.ok(expect.every((f) => f.length === 3));
  const fairSetup = { kind: 'fair' as const, text: TRAIL, rules: 'classic' as const, rounds: 600, world };
  for (const size of [1, 3, 9]) {
    const log = { made: 0, terminated: 0 };
    const outs = await runBatch(() => fakeWorker(log), size, fairSetup, seeds.map((seed) => ({ seed }))).done;
    assert.deepEqual(outs.map((o) => o.food), expect, `${size} workers`);
    assert.equal(log.terminated, log.made);
  }
  const e = createBatchEngine();
  assert.equal(e.handle({ type: 'init', setup: { ...fairSetup, world: { kind: 'fair', colonies: 13 } } }).type, 'error');
  const bad = e.handle({ type: 'init', setup: { ...fairSetup, text: 'nope' } }) as Extract<BatchReply, { type: 'error' }>;
  assert.equal(bad.type, 'error'); assert.equal(bad.brain, 0);
  assert.equal(e.handle({ type: 'init', setup: { ...fairSetup, world: { kind: 'map', mapText: 'x' } } }).type, 'error');
});

test('the panel and cli/fairness.ts: the same foods, the same verdict, the same table, for a fixed map, a map seed and a world per game', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fair-'));
  try {
    writeFileSync(join(dir, 'T.brain'), TRAIL);
    const mapText = formatMap(generateFairWorld(3, 2));
    writeFileSync(join(dir, 'W.world'), mapText);
    const cases: { spec: WorldSpec; rules: RulesId }[] = [
      { spec: { kind: 'fair', colonies: 3, mapSeed: 1 }, rules: 'classic' },
      { spec: { kind: 'mirror' }, rules: 'altorder' },
      { spec: { kind: 'map', mapText }, rules: 'classic' },
      { spec: { kind: 'contest', mapSeed: 3 }, rules: 'classic' },
    ];
    for (const { spec, rules } of cases) {
      const job = { brain: join(dir, 'T.brain'), world: join(dir, 'W.world'), spec, games: 3, from: 4, rounds: 700, rules };
      const argv = fairnessCommand(job).split(' ').slice(2);
      const run = (...extra: string[]) => spawnSync(process.execPath, [root('cli/fairness.ts'), ...argv, ...extra], { encoding: 'utf8' });
      const j = run('--json'), table = run();
      assert.equal(j.status, 0, j.stderr); assert.equal(table.status, 0, table.stderr);
      const mine = fairness(engineFoods(spec, [4, 5, 6], 700, rules));
      const { brain: _b, world: _w, rules: _r, rounds: _n, from: _f, ...cliResult } = JSON.parse(j.stdout) as Record<string, unknown>;
      assert.deepEqual(cliResult, JSON.parse(JSON.stringify(mine)), JSON.stringify(spec));
      const lines = table.stdout.trimEnd().split('\n');
      assert.equal(lines[0], fairnessHeader(join(dir, 'T.brain'), spec, join(dir, 'W.world'), 3, 700, rules));
      assert.deepEqual(lines.slice(1), fairnessLines(mine));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fairnessCommand: the flags of each kind of world', () => {
  const c = (spec: WorldSpec) => fairnessCommand({ brain: 'A.brain', world: 'W.world', spec, games: 200, from: 1, rounds: 30000, rules: 'classic' });
  assert.equal(c({ kind: 'contest' }), 'node cli/fairness.ts A.brain --games 200 --from 1 --rounds 30000 --rules classic');
  assert.equal(c({ kind: 'mirror', mapSeed: 5 }), 'node cli/fairness.ts A.brain --symmetric --map-seed 5 --games 200 --from 1 --rounds 30000 --rules classic');
  assert.equal(c({ kind: 'fair', colonies: 4 }), 'node cli/fairness.ts A.brain --colonies 4 --games 200 --from 1 --rounds 30000 --rules classic');
  assert.equal(c({ kind: 'map', mapText: '' }), 'node cli/fairness.ts A.brain --world W.world --games 200 --from 1 --rounds 30000 --rules classic');
});

// ---- league of the editors (the panel's third part, cli/league.ts)
const FORAGER = readFileSync(new URL('../ants/forager.rules', import.meta.url), 'utf8');

/** The games of a league in this process, as the panel's engine plays them. */
function engineLeague(texts: string[], world: LeagueWorld, seeds: number[], rounds: number, rules: RulesId = 'classic'): LeagueGame[] {
  const e = createBatchEngine(), ready = e.handle({ type: 'init', setup: { kind: 'league', texts, rules, rounds, world } });
  assert.equal(ready.type, 'ready', JSON.stringify(ready));
  return leagueTasks(texts.length, seeds).map((t, i) => ({ ...t, food: ((e.handle({ type: 'play', i, task: t }) as Extract<BatchReply, { type: 'played' }>).out as FairOut).food }));
}

test('league batches: any number of workers gives the games of the league player; errors come back as errors', async () => {
  const texts = [TRAIL, FORAGER, TRAIL], world: LeagueWorld = { kind: 'gen' }, seeds = [1, 2];
  const expect = engineLeague(texts, world, seeds, 500);
  assert.equal(expect.length, 6); assert.ok(expect.every((g) => g.food.length === 3));
  const tasks = leagueTasks(3, seeds);
  for (const size of [1, 4]) {
    const log = { made: 0, terminated: 0 };
    const outs = await runBatch(() => fakeWorker(log), size, { kind: 'league', texts, rules: 'classic', rounds: 500, world: { kind: 'gen' } }, tasks).done;
    assert.deepEqual(outs.map((o) => o.food), expect.map((g) => g.food), `${size} workers`);
    assert.equal(log.terminated, log.made);
  }
  const e = createBatchEngine(), setup = { kind: 'league' as const, texts, rules: 'classic' as const, rounds: 500, world };
  const bad = e.handle({ type: 'init', setup: { ...setup, texts: [TRAIL, 'nope', TRAIL] } }) as Extract<BatchReply, { type: 'error' }>;
  assert.equal(bad.type, 'error'); assert.equal(bad.brain, 1);
  assert.equal(e.handle({ type: 'init', setup: { ...setup, texts: Array.from({ length: 13 }, () => TRAIL) } }).type, 'error', 'no fair world for 13 colonies');
  assert.equal(e.handle({ type: 'init', setup: { ...setup, world: { kind: 'map', mapText: formatMap(generateFairWorld(4, 1)) } } }).type, 'error', 'a 4-colony map for 3 brains');
  assert.equal(e.handle({ type: 'init', setup: { ...setup, texts: [TRAIL, TRAIL, TRAIL], world: { kind: 'gen', contest: true } } }).type, 'error', 'the contest generator is for two brains');
});

test('the panel and cli/league.ts: the same games, the same table, for a world per seed (2 and 3 brains), a given map and the contest generator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'league-'));
  try {
    writeFileSync(join(dir, 'A.brain'), TRAIL); writeFileSync(join(dir, 'B.brain'), FORAGER); writeFileSync(join(dir, 'C.brain'), TRAIL);
    const mapText = formatMap(generateFairWorld(3, 2));
    writeFileSync(join(dir, 'W.world'), mapText);
    const cases: { names: string[]; world: LeagueWorld; label: string }[] = [
      { names: ['A', 'B'], world: { kind: 'gen' }, label: 'point-mirror worlds' },
      { names: ['A', 'B', 'C'], world: { kind: 'gen' }, label: 'fair worlds for 3 colonies' },
      { names: ['A', 'B', 'C'], world: { kind: 'map', mapText }, label: join(dir, 'W.world') },
      { names: ['A', 'B'], world: { kind: 'gen', contest: true }, label: 'contest worlds' },
    ];
    for (const { names, world, label } of cases) {
      const files = names.map((x) => join(dir, `${x}.brain`)), seeds = [4, 5];
      const argv = leagueCommand({ files, seeds: 2, from: 4, rounds: 400, rules: 'classic', world, worldFile: join(dir, 'W.world') }).split(' ').slice(2);
      const run = (...extra: string[]) => spawnSync(process.execPath, [root('cli/league.ts'), ...argv, ...extra], { encoding: 'utf8' });
      const j = run('--json'), table = run();
      assert.equal(j.status, 0, j.stderr); assert.equal(table.status, 0, table.stderr);
      const games = engineLeague(names.map((x) => readFileSync(join(dir, `${x}.brain`), 'utf8')), world, seeds, 400), n = names.length;
      assert.deepEqual((JSON.parse(j.stdout) as { games: unknown[] }).games, JSON.parse(JSON.stringify(games)), JSON.stringify(world));
      const lines = table.stdout.trimEnd().split('\n'), shown = files.map((f) => f.slice(f.lastIndexOf('/') + 1));
      assert.equal(lines[0], leagueHeader(n, seeds, label, 400, 'classic', games.length));
      assert.deepEqual(lines.slice(1), leagueLines(shown, leagueSummary(n, games, seeds)));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('leagueCommand and mapTextOf', () => {
  const c = (world?: LeagueWorld) => leagueCommand({ files: ['A.brain', 'B.brain'], seeds: 20, from: 1, rounds: 30000, rules: 'altorder', world, worldFile: 'W.world' });
  assert.equal(c({ kind: 'gen' }), 'node cli/league.ts A.brain B.brain --seeds 20 --from 1 --rounds 30000 --rules altorder');
  assert.equal(c({ kind: 'gen', contest: true }), 'node cli/league.ts A.brain B.brain --seeds 20 --from 1 --rounds 30000 --rules altorder --contest');
  assert.equal(c({ kind: 'map', mapText: '' }), 'node cli/league.ts A.brain B.brain --seeds 20 --from 1 --rounds 30000 --rules altorder --world W.world');
  assert.equal(mapTextOf({ kind: 'fair3', mapText: 'TEXT', seed: 1 }), 'TEXT');
  assert.equal(mapTextOf({ kind: '', mapText: '', seed: 5 }), formatMap(generateWorld(5)), 'the contest world of the seed box, as text');
  assert.equal(coloniesOf(parseMap(mapTextOf({ kind: '', mapText: '', seed: 5 }))), 2);
});
