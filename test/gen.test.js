import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld, allReachable } from '../src/core/gen.ts';
import { disk, step } from '../src/core/hex.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import type { WorldMap } from '../src/core/types.ts';
import { parseIcfp } from '../src/core/asm.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';

const cellsOf = (m: WorldMap, pred: (p: number) => boolean): number[] => [...m.rock.keys()].filter((p) => pred(p));
const neighbours = (m: WorldMap, p: number): number[] => [0, 1, 2, 3, 4, 5].map((d) => step(p % m.W, (p / m.W) | 0, d))
  .filter(([x, y]) => x >= 0 && x < m.W && y >= 0 && y < m.H).map(([x, y]) => y * m.W + x);
const components = (m: WorldMap, cells: number[]): number => {
  const left = new Set(cells); let n = 0;
  while (left.size) {
    n++; const q: number[] = [left.values().next().value as number]; left.delete(q[0]);
    for (let i = 0; i < q.length; i++) for (const r of neighbours(m, q[i])) if (left.delete(r)) q.push(r);
  }
  return n;
};

test('generated worlds follow the task spec (section 3.1)', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const m = generateWorld(seed);
    assert.equal(m.W * m.H, 10000);
    const edge = (p: number): boolean => p % 100 === 0 || p % 100 === 99 || p < 100 || p >= 9900;
    assert.ok(cellsOf(m, edge).every((p) => m.rock[p]), 'rocky perimeter');
    const food = cellsOf(m, (p) => m.food[p] > 0);
    assert.equal(food.length, 96); // 8 blobs x 12 cells
    assert.ok(food.every((p) => m.food[p] === 5));
    assert.equal(food.reduce((s, p) => s + m.food[p], 0), 480);
    for (const c of [0, 1]) {
      const hill = cellsOf(m, (p) => m.hill[p] === c), set = new Set(hill);
      assert.equal(hill.length, 91);
      assert.ok(hill.some((p) => {
        const cells = disk(p % 100, (p / 100) | 0, 5).map(([x, y]) => y * 100 + x);
        return cells.length === 91 && cells.every((q) => set.has(q));
      }), `hill ${c} is a hexagon of side 6`);
    }
    // >= 1 empty cell between non-food elements: hills touch no rock and no other hill
    for (const p of cellsOf(m, (q) => m.hill[q] >= 0)) {
      for (const q of neighbours(m, p)) {
        assert.ok(!m.rock[q] && (m.hill[q] < 0 || m.hill[q] === m.hill[p]), `gap at ${p},${q}`);
      }
    }
    assert.equal(components(m, cellsOf(m, (p) => m.rock[p] === 1)), 11); // perimeter + ten separate rocks
    assert.ok(cellsOf(m, (p) => m.food[p] > 0 && (m.rock[p] === 1 || m.hill[p] >= 0)).length === 0);
    assert.ok(allReachable(m));
  }
});

test('generator is deterministic and the file format round-trips', () => {
  const a = formatMap(generateWorld(7));
  assert.equal(a, formatMap(generateWorld(7)));
  assert.notEqual(a, formatMap(generateWorld(8)));
  assert.equal(formatMap(parseMap(a)), a);
});

test('a generated world runs: 91 ants per colony, deterministic', () => {
  const ant = parseIcfp(readFileSync(new URL('./fixtures/starter.ant', import.meta.url), 'utf8'), CLASSIC);
  const run = () => {
    const sim = createSim({ map: generateWorld(3), programs: [ant, ant] });
    assert.deepEqual([sim.ants, sim.alive(0), sim.alive(1)], [182, 91, 91]);
    sim.run(3000);
    return sim.hash();
  };
  assert.equal(run(), run());
});
