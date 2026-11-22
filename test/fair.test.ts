import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASSIC_WORLD, SYMMETRIC_WORLD, fairLayout, generateFairWorld, generateWorld, isShiftSymmetric, reachableOnTorus } from '../src/core/gen.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { RULESETS } from '../src/core/rules.ts';
import { createSim } from '../src/core/sim.ts';
import { compileRules } from '../src/lang/index.ts';
import type { WorldMap } from '../src/core/types.ts';
import { colonyCount, exampleWorld } from '../web/colonies.ts';

const SUPPORTED = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 21, 22, 24, 25];
const copy = (m: WorldMap): WorldMap => ({ ...m, rock: m.rock.slice(), food: m.food.slice(), hill: m.hill.slice() });
const sum = (a: ArrayLike<number>): number => Array.from(a).reduce((x, y) => x + y, 0);

test('fair layouts: the tilings that give every colony a tile of 16 cells a side or more, and what is refused', () => {
  const have = Array.from({ length: 25 }, (_, i) => i + 2).filter((n) => fairLayout(n) !== null);
  assert.deepEqual(have, SUPPORTED);
  for (const n of SUPPORTED) {
    const l = fairLayout(n) as NonNullable<ReturnType<typeof fairLayout>>;
    assert.equal(l.across * l.down, n, `n=${n}`);
    assert.ok(l.w >= 16 && l.h >= 16 && l.h % 2 === 0 && l.across * l.w <= 200 && l.down * l.h <= 200, `n=${n}: ${JSON.stringify(l)}`);
  }
  assert.deepEqual(fairLayout(4), { across: 2, down: 2, w: 50, h: 50, hillRadius: 5 }, 'four colonies: a 100 x 100 world');
  assert.deepEqual(fairLayout(9), { across: 3, down: 3, w: 50, h: 50, hillRadius: 5 });
  for (const n of [1, 27, 2.5, Number.NaN]) assert.throws(() => fairLayout(n), /colonies must be 2 to 26/, String(n));
  for (const n of [13, 17, 19, 23, 26]) assert.throws(() => generateFairWorld(n, 1), new RegExp(`no fair world for ${n} colonies`), String(n));
});

test('a fair world: every colony has the same hill, the same food and the same rock, shifted; it is the same every time', () => {
  for (const n of SUPPORTED) {
    for (const seed of [1, 2]) {
      const m = generateFairWorld(n, seed), tag = `n=${n} seed=${seed}`;
      assert.ok(isShiftSymmetric(m), tag);
      assert.ok(m.H % 2 === 0 && m.W <= 200 && m.H <= 200, tag);
      const sizes = new Map<number, number>();
      for (const h of m.hill) if (h >= 0) sizes.set(h, (sizes.get(h) ?? 0) + 1);
      assert.deepEqual([...sizes.keys()].sort((a, b) => a - b), Array.from({ length: n }, (_, c) => c), tag);
      assert.equal(new Set(sizes.values()).size, 1, `${tag}: hills of equal size`);
      assert.equal(sum(m.food) % n, 0, tag);
      assert.equal(colonyCount(m.hill), Math.max(2, n), tag);
      assert.ok(reachableOnTorus(m), tag);
      const back = parseMap(formatMap(m));
      assert.deepEqual([back.W, back.H, Array.from(back.rock), Array.from(back.food), Array.from(back.hill)], [m.W, m.H, Array.from(m.rock), Array.from(m.food), Array.from(m.hill)], `${tag}: file round trip`);
    }
  }
  assert.equal(formatMap(generateFairWorld(5, 3)), formatMap(generateFairWorld(5, 3)), 'deterministic');
  assert.notEqual(formatMap(generateFairWorld(5, 3)), formatMap(generateFairWorld(5, 4)), 'the seed picks the world');
});

test('isShiftSymmetric is not fooled: one extra food, one rock fewer, a damaged hill, hills of another shape, or a world that is only point-symmetric', () => {
  const m = generateFairWorld(3, 1);
  const free = m.food.findIndex((f, p) => !f && !m.rock[p] && m.hill[p] < 0), rock = m.rock.findIndex((r) => r === 1);
  const food = m.food.findIndex((f) => f > 0), hill = m.hill.findIndex((h, p) => h === 1 && m.hill[p - 1] === 1);
  assert.ok(isShiftSymmetric(m));
  const plusFood = copy(m); plusFood.food[free] = 5; assert.equal(isShiftSymmetric(plusFood), false, 'one extra food');
  const lessFood = copy(m); lessFood.food[food] = 4; assert.equal(isShiftSymmetric(lessFood), false, 'one packet fewer');
  const lessRock = copy(m); lessRock.rock[rock] = 0; assert.equal(isShiftSymmetric(lessRock), false, 'one rock fewer');
  const moved = copy(m); moved.hill[hill] = -1; assert.equal(isShiftSymmetric(moved), false, 'one hill cell missing');
  const last = (c: number): number => m.hill.reduce((at, h, p) => (h === c ? p : at), -1);
  const swapped = copy(m); swapped.hill[last(1)] = 2; swapped.hill[last(2)] = 1; assert.equal(isShiftSymmetric(swapped), false, 'two cells traded between hills: equal sizes, different shapes');
  assert.equal(isShiftSymmetric(generateWorld(1, SYMMETRIC_WORLD)), false, 'the point mirror is not a shift');
  assert.equal(isShiftSymmetric(generateWorld(1, CLASSIC_WORLD)), false);
  assert.equal(isShiftSymmetric(parseMap(exampleWorld(3))), false, 'the ring example world is only similar');
  const one = copy(m); one.hill.forEach((h, p) => { if (h > 0) one.hill[p] = -1; }); assert.equal(isShiftSymmetric(one), false, 'a single colony');
});

test('reachable round the edges: a food packet sealed in by rock is found out', () => {
  const m = generateFairWorld(2, 1);
  assert.ok(reachableOnTorus(m));
  const sealed = copy(m), p = sealed.food.findIndex((f) => f > 0);
  const around = (cx: number, cy: number): number[] => (cy % 2 ? [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]] : [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]])
    .map(([dx, dy]) => ((cy + dy + sealed.H) % sealed.H) * sealed.W + ((cx + dx + sealed.W) % sealed.W));
  // wall in the whole 12-cell blob that contains p: every neighbour of a food cell that is not food gets rock
  const blob = new Set<number>([p]); for (const q of blob) for (const r of around(q % sealed.W, Math.floor(q / sealed.W))) if (sealed.food[r] > 0) blob.add(r);
  for (const q of blob) for (const r of around(q % sealed.W, Math.floor(q / sealed.W))) if (!blob.has(r)) { sealed.rock[r] = 1; sealed.hill[r] = -1; }
  assert.equal(reachableOnTorus(sealed), false);
});

test('colonies play on a fair world: all of them forage, and none is ahead for being in a better place (3 colonies, 10 worlds)', () => {
  const rules = RULESETS.colonies;
  const prog = compileRules(readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8'), rules).program;
  const totals = [0, 0, 0];
  for (let seed = 1; seed <= 10; seed++) {
    const map = generateFairWorld(3, seed);
    const sim = createSim({ map, programs: [prog, prog, prog], seed, rules });
    assert.equal(sim.ants, 3 * 91, 'one ant per hill cell');
    sim.run(20000);
    sim.score().forEach((v, c) => { totals[c] += v; });
  }
  const mean = sum(totals) / 3;
  assert.ok(mean > 1500, `mean food per colony over 10 worlds: ${mean / 10}`);
  assert.ok(totals.every((t) => t > 0.7 * mean && t < 1.3 * mean), `food by colony: ${totals.join(' ')}`);
});
