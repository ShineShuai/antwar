import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../web/engine.ts';
import { STARTER } from '../web/default-ant.ts';
import { LIGHT, cellAt, center, createViewer, layout } from '../web/viewer.ts';
import { describeCell } from '../web/inspect.ts';
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
  assert.equal(f.ants.length % 6, 0);
  assert.equal(f.ants.length / 6, 182);
  assert.equal(f.marks.length, 2 * 100 * 100);
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
  const marks = new Uint8Array(2 * N); marks[6] = 0b101; marks[N + 7] = 0b1; marks[0] = 0b1; // marks on rock are not drawn
  const ants = Int32Array.from([0, 5, 0, 0, 0, 3, 1, 6, 1, 2, 1, 7, 2, 7, 1, 0, 0, 9]);
  v.draw({ food, marks, ants });
  assert.equal(ctx.calls.fillRect, 1 + 2); // background + two food cells
  const before = ctx.calls.fillRect;
  v.draw({ food, marks, ants }, { marks: true });
  assert.equal(ctx.calls.fillRect - before, 1 + 2 + 3); // + three scent pips
  assert.equal(ctx.calls.arc, 2 * (3 + 1)); // two draws: three ants + one carry dot each
  assert.equal(ctx.calls.fill, 2 * (2 + 3 + 1)); // rock + hill hexes, ants, carry dot, twice
});

test('cellAt inverts center for every cell, and tolerates offsets', () => {
  const W = 7, H = 6, L = layout(W, H, 12);
  for (let p = 0; p < W * H; p++) {
    const [cx, cy] = center(L, p % W, (p / W) | 0);
    assert.equal(cellAt(L, W, H, cx, cy), p);
    assert.equal(cellAt(L, W, H, cx + L.w * 0.3, cy), p);
    assert.equal(cellAt(L, W, H, cx, cy - L.h * 0.3), p);
  }
  assert.equal(cellAt(L, W, H, -50, -50), -1);
});

test('describeCell lists food, scents and ants', () => {
  const W = 3, H = 3, N = 9, marks = new Uint8Array(2 * N);
  marks[4] = 0b101; marks[N + 4] = 0b10;
  const food = new Uint16Array(N); food[4] = 7;
  const ants = Int32Array.from([12, 4, 1, 2, 1, 8]);
  assert.equal(describeCell({ food, marks, ants }, W, H, 4),
    'cell 1,1 | food 7 | scent A: 0,2 | scent B: 1 | ant #12 (B) state 8, facing SW, carrying 1');
  assert.equal(describeCell({ food, marks, ants }, W, H, 0), 'cell 0,0');
});
