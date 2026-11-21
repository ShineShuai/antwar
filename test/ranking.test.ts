import test from 'node:test';
import assert from 'node:assert/strict';
import { points as matchPoints } from '../src/core/match.ts';
import { colonyResult, points } from '../src/core/ranking.ts';

test('two colonies: exactly the contest scoring, 2 / 1 / 0', () => {
  assert.equal(matchPoints, points, 'match.ts re-exports it');
  assert.deepEqual(colonyResult([5, 3]), { rank: [1, 2], points: [2, 0] });
  assert.deepEqual(colonyResult([3, 5]), { rank: [2, 1], points: [0, 2] });
  assert.deepEqual(colonyResult([4, 4]), { rank: [1, 1], points: [1, 1] });
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) assert.deepEqual(colonyResult([a, b]).points, [points(a, b), points(b, a)]);
});

test('more colonies: 2 points for each colony out-scored, 1 for each tie; equal food shares a rank and leaves a gap', () => {
  assert.deepEqual(colonyResult([10, 8, 3]), { rank: [1, 2, 3], points: [4, 2, 0] });
  assert.deepEqual(colonyResult([10, 8, 8]), { rank: [1, 2, 2], points: [4, 1, 1] });
  assert.deepEqual(colonyResult([8, 10, 8, 3]), { rank: [2, 1, 2, 4], points: [3, 6, 3, 0] });
  assert.deepEqual(colonyResult([7, 7, 7]), { rank: [1, 1, 1], points: [2, 2, 2] });
  assert.deepEqual(colonyResult([0, 0, 0, 0]), { rank: [1, 1, 1, 1], points: [3, 3, 3, 3] });
  assert.deepEqual(colonyResult([1, 2, 3, 4, 5]).points, [0, 2, 4, 6, 8]);
});

test('properties over 3,000 random games of 2 to 26 colonies: the points always add up, only the order of the food counts', () => {
  let seed = 99;
  const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  for (let g = 0; g < 3000; g++) {
    const n = 2 + rnd(25), food = Array.from({ length: n }, () => rnd(1 + rnd(40))); // few distinct values: many ties
    const r = colonyResult(food);
    assert.equal(r.points.reduce((a, b) => a + b, 0), n * (n - 1), `${food}: the points of a game add up to n * (n - 1)`);
    for (let c = 0; c < n; c++) {
      assert.equal(r.points[c] % 1, 0);
      assert.equal(r.rank[c], 1 + food.filter((x) => x > food[c]).length, `${food}: rank of ${c}`);
      for (let d = 0; d < n; d++) {
        if (food[c] === food[d]) assert.deepEqual([r.rank[c], r.points[c]], [r.rank[d], r.points[d]], 'equal food, equal result');
        if (food[c] > food[d]) assert.ok(r.rank[c] < r.rank[d] && r.points[c] > r.points[d], `${food}: more food ranks higher and scores more`);
      }
    }
    assert.deepEqual(colonyResult(food.map((x) => 3 * x + 7)), r, 'only the order counts');
    const reversed = colonyResult([...food].reverse());
    assert.deepEqual([...reversed.points].reverse(), r.points, 'the colony letters do not matter');
  }
});
