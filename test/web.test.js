import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../web/engine.ts';
import { STARTER } from '../web/default-ant.ts';
import { LIGHT, center, createViewer, layout } from '../web/viewer.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { generateWorld } from '../src/core/gen.ts';
import { loadBrain } from '../src/core/asm.ts';
import type { Reply } from '../web/protocol.ts';

type Of<T extends Reply['type']> = Extract<Reply, { type: T }>;

test('loadBrain picks the format by content', () => {
  assert.equal(loadBrain(STARTER, CLASSIC).n, 16); // "else" absent from the comments
  assert.equal(loadBrain('Sense Ahead 1 0 Food ; else here\nMove 0 0', CLASSIC).n, 2);
  assert.equal(loadBrain('a: sense ahead food else a\ngoto a', CLASSIC).n, 2);
});

test('engine: init, run, frame; same hash as a direct sim', () => {
  const eng = createEngine();
  const ready = eng.handle({ type: 'init', seed: 3, rules: 'classic', brains: [STARTER, STARTER] }).msg as Of<'ready'>;
  assert.deepEqual([ready.type, ready.W, ready.H], ['ready', 100, 100]);
  const f = eng.handle({ type: 'run', n: 500 }).msg as Of<'frame'>;
  assert.equal(f.type, 'frame');
  assert.equal(f.cycle, 500);
  assert.equal(f.ants.length % 4, 0);
  assert.deepEqual(f.alive, [91, 91]);
  const P = loadBrain(STARTER, CLASSIC), sim = createSim({ map: generateWorld(3), programs: [P, P], seed: 3 });
  sim.run(500);
  assert.equal(f.hash, sim.hash());
  assert.equal((eng.handle({ type: 'frame' }).msg as Of<'frame'>).cycle, 500);
});

test('engine: errors come back as messages', () => {
  const eng = createEngine();
  assert.match((eng.handle({ type: 'run', n: 1 }).msg as Of<'error'>).message, /not initialised/);
  const bad = eng.handle({ type: 'init', seed: 1, brains: ['move else 0'] }).msg as Of<'error'>;
  assert.equal(bad.type, 'error');
  assert.match(bad.message, /line 1/);
  assert.match((eng.handle({ type: 'init', seed: 1, mapText: '5\n5\n', brains: [STARTER] }).msg as Of<'error'>).message, /rows/);
});

class FakeCtx {
  fillStyle = '';
  calls: Record<string, number> = {};
  count(name: string) { this.calls[name] = (this.calls[name] ?? 0) + 1; }
  beginPath() { this.count('beginPath'); } moveTo() {} lineTo() {} closePath() {} fill() { this.count('fill'); }
  fillRect() { this.count('fillRect'); } arc() { this.count('arc'); }
}

test('viewer: hex layout and draw call counts', () => {
  const L = layout(10, 10, 10);
  assert.deepEqual(center(L, 0, 0).map(Math.round), [5, 6]);
  assert.ok(center(L, 0, 1)[0] > center(L, 0, 0)[0], 'odd rows are shifted right');
  const W = 4, H = 4, N = 16;
  const world = { W, H, rock: new Uint8Array(N), hill: new Int8Array(N).fill(-1) };
  world.rock[0] = 1; world.hill[5] = 0;
  const ctx = new FakeCtx(), v = createViewer(ctx, world, layout(W, H, 10), LIGHT);
  const food = new Uint16Array(N); food[2] = 3; food[5] = 1; food[0] = 9; // food on rock is not drawn
  v.draw({ food, ants: Int32Array.from([5, 0, 0, 0, 6, 1, 2, 1, 7, 1, 0, 0]) });
  assert.equal(ctx.calls.fillRect, 1 + 2); // background + two food cells
  assert.equal(ctx.calls.arc, 3 + 1); // three ants + one carry dot
  assert.equal(ctx.calls.fill, 2 + 3 + 1); // rock + hill hexes, ants, carry dot
});
