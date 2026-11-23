// Food over time: src/series.ts, cli/series.ts, web/chart.ts and the batch kind 'series' agree with each other and with a plain game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFairWorld, generateWorld } from '../src/core/gen.ts';
import { formatMap } from '../src/core/map.ts';
import { playColonies } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { playSeries, seriesCommand, seriesGame } from '../src/series.ts';
import type { Series } from '../src/series.ts';
import { createBatchEngine } from '../web/batch-engine.ts';
import type { BatchReply, SeriesOut } from '../web/batch-protocol.ts';
import { chartModel, niceScale } from '../web/chart.ts';
import { runBatch } from '../web/pool.ts';
import type { WorkerLike } from '../web/pool.ts';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const root = (f: string): string => fileURLToPath(new URL(`../${f}`, import.meta.url));
const TRAIL = read('ants/trail.rules'), FORAGER = read('ants/forager.rules');

test('seriesGame: samples at round 0, every k rounds and the last round; the last sample is the game', () => {
  const job = { rules: 'classic' as const, rounds: 1100, every: 500 };
  const s = playSeries([TRAIL, FORAGER], job, 3);
  assert.deepEqual(s.at, [0, 500, 1000, 1100]);
  assert.equal(s.food.length, 4); assert.deepEqual(s.food[0], [0, 0]);
  assert.deepEqual(s.alive[0], s.alive[0].map(() => s.alive[0][0]), 'the colonies start alike');
  const programs = [TRAIL, FORAGER].map((t) => loadAnyBrain(t, RULESETS.classic).program);
  assert.deepEqual(s.food[3], playColonies(generateWorld(3), programs, 3, 1100, RULESETS.classic), 'the last sample is what a plain game gives');
  // nest food never falls without a thief in this pair? not promised: only check the shape and that sampling does not change the game
  const coarse = playSeries([TRAIL, FORAGER], { ...job, every: 1100 }, 3);
  assert.deepEqual(coarse.food[1], s.food[3], 'sampling does not disturb the game');
  assert.deepEqual(playSeries([TRAIL, FORAGER], { ...job, rounds: 0 }, 3).at, [0]);
  assert.throws(() => playSeries([TRAIL, FORAGER], { ...job, every: 0 }, 3), RangeError);
  assert.throws(() => playSeries([TRAIL, FORAGER], { ...job, rounds: -1 }, 3), RangeError);
  assert.throws(() => playSeries([TRAIL, FORAGER, TRAIL], job, 3), /hills|colonies/, 'the contest world has two hills');
});

test('seriesGame: a given map, three colonies', () => {
  const map = generateFairWorld(3, 2), mapText = formatMap(map);
  const s = playSeries([TRAIL, FORAGER, TRAIL], { rules: 'altorder', rounds: 600, every: 300, mapText }, 9);
  assert.deepEqual(s.at, [0, 300, 600]); assert.ok(s.food.every((r) => r.length === 3));
  const programs = [TRAIL, FORAGER, TRAIL].map((t) => loadAnyBrain(t, RULESETS.altorder).program);
  assert.deepEqual(s.food[2], playColonies(map, programs, 9, 600, RULESETS.altorder));
});

test('chart: nice scales and the model', () => {
  assert.deepEqual(niceScale(42), { step: 20, top: 60 });
  assert.deepEqual(niceScale(7), { step: 2, top: 8 });
  assert.deepEqual(niceScale(100), { step: 50, top: 100 });
  assert.deepEqual(niceScale(0), { step: 1, top: 4 });
  const m = chartModel({ x: [0, 500, 1000], lines: [{ label: 'A', color: '#f00', y: [0, 10, 20] }, { label: 'B', color: '#00f', y: [0, 0, 0] }] }, 320, 170);
  assert.equal(m.paths.length, 2);
  const { x0, y0, x1, y1 } = m.plot;
  assert.ok(m.paths[0].startsWith(`M${x0.toFixed(1)} ${y1.toFixed(1)} L`), 'a line starts at the origin');
  assert.ok(m.paths[0].endsWith(`${x1.toFixed(1)} ${(y1 - (20 / 20) * (y1 - y0)).toFixed(1)}`), 'and the highest value of a 0..20 axis reaches the top');
  assert.deepEqual(m.yTicks.map((t) => t.label), ['0', '5', '10', '15', '20']);
  assert.deepEqual(m.xTicks.map((t) => t.label), ['0', '500', '1k']);
  assert.ok(chartModel({ x: [0], lines: [{ label: 'A', color: '#000', y: [0] }] }).paths[0].startsWith('M'), 'one point, all zeros: no division by zero');
});

function fakeWorker(): WorkerLike {
  const engine = createBatchEngine();
  let dead = false;
  const w: WorkerLike = {
    onmessage: null, onerror: null,
    postMessage(m) { const r = engine.handle(m); setTimeout(() => { if (!dead) w.onmessage?.({ data: r }); }, 0); },
    terminate() { dead = true; },
  };
  return w;
}

test('the batch kind series: the pool returns the series of seriesGame; errors come back at init', async () => {
  const job = { rules: 'classic' as const, rounds: 800, every: 400 };
  const expect = playSeries([TRAIL, FORAGER], job, 5);
  const outs = await runBatch(fakeWorker, 3, { kind: 'series', texts: [TRAIL, FORAGER], ...job }, [{ seed: 5 }]).done;
  assert.deepEqual(outs[0].series, expect);
  const e = createBatchEngine(), setup = { kind: 'series' as const, texts: [TRAIL, FORAGER], ...job };
  assert.equal(e.handle({ type: 'init', setup }).type, 'ready');
  const bad = e.handle({ type: 'init', setup: { ...setup, texts: [TRAIL, 'nope'] } }) as Extract<BatchReply, { type: 'error' }>;
  assert.equal(bad.type, 'error'); assert.equal(bad.brain, 1);
  assert.equal(e.handle({ type: 'init', setup: { ...setup, every: 0 } }).type, 'error');
  assert.equal(e.handle({ type: 'init', setup: { ...setup, mapText: 'not a map' } }).type, 'error');
  assert.equal(e.handle({ type: 'init', setup: { ...setup, texts: [TRAIL, FORAGER, TRAIL] } }).type, 'error', 'three brains on the contest world');
});

test('the panel and cli/series.ts: the same numbers (the contest world of the seed; a given map with three colonies), and the command runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'series-'));
  try {
    for (const [name, text] of [['A', TRAIL], ['B', FORAGER], ['C', TRAIL]] as const) writeFileSync(join(dir, `${name}.brain`), text);
    const mapText = formatMap(generateFairWorld(3, 2));
    writeFileSync(join(dir, 'W.world'), mapText);
    const cases = [
      { names: ['A', 'B'], job: { rules: 'classic' as const, rounds: 900, every: 300 }, seed: 4 },
      { names: ['A', 'B', 'C'], job: { rules: 'altorder' as const, rounds: 700, every: 350, mapText }, seed: 6 },
    ];
    for (const { names, job, seed } of cases) {
      const files = names.map((x) => join(dir, `${x}.brain`));
      const argv = seriesCommand({ files, seed, job, worldFile: join(dir, 'W.world') }).split(' ').slice(2);
      const run = (...extra: string[]) => spawnSync(process.execPath, [root('cli/series.ts'), ...argv, ...extra], { encoding: 'utf8' });
      const j = run('--json'), table = run(), alive = run('--what', 'alive');
      assert.equal(j.status, 0, j.stderr); assert.equal(table.status, 0, table.stderr); assert.equal(alive.status, 0, alive.stderr);
      const mine: Series = playSeries(names.map((x) => read(`ants/${x === 'B' ? 'forager' : 'trail'}.rules`)), job, seed);
      assert.deepEqual((JSON.parse(j.stdout) as { series: Series }).series, JSON.parse(JSON.stringify(mine)));
      const rows = table.stdout.trimEnd().split('\n').slice(2).map((l) => l.trim().split(/\s+/).map(Number));
      assert.deepEqual(rows, mine.at.map((r, k) => [r, ...mine.food[k]]), 'the table is the food series');
      const arows = alive.stdout.trimEnd().split('\n').slice(2).map((l) => l.trim().split(/\s+/).map(Number));
      assert.deepEqual(arows, mine.at.map((r, k) => [r, ...mine.alive[k]]), '--what alive');
    }
    const cli = (...a: string[]) => spawnSync(process.execPath, [root('cli/series.ts'), ...a], { encoding: 'utf8' });
    assert.equal(cli(join(dir, 'A.brain'), join(dir, 'B.brain'), join(dir, 'C.brain')).status, 2, 'three brains need --world');
    assert.equal(cli(join(dir, 'A.brain'), join(dir, 'B.brain'), '--every', '0').status, 2);
    assert.equal(cli(join(dir, 'A.brain'), join(dir, 'B.brain'), '--what', 'x').status, 2);
    assert.equal(cli(join(dir, 'A.brain')).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('seriesCommand: with and without a map', () => {
  const c = (mapText?: string) => seriesCommand({ files: ['A.brain', 'B.brain'], seed: 7, job: { rules: 'classic', rounds: 100000, every: 500, mapText }, worldFile: 'W.world' });
  assert.equal(c(), 'node cli/series.ts A.brain B.brain --seed 7 --rounds 100000 --every 500 --rules classic');
  assert.equal(c('MAP'), 'node cli/series.ts A.brain B.brain --world W.world --seed 7 --rounds 100000 --every 500 --rules classic');
});
