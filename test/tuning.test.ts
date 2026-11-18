import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMap } from '../src/core/map.ts';
import { createSim } from '../src/core/sim.ts';
import { compileRules } from '../src/lang/index.ts';

const TRAIL = readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8');
const code = (asm: string): string => asm.split('\n').filter((l) => !l.trimStart().startsWith(';')).join('\n');
const FOOD = 8, W = 14;

/** An ant at x = 1 of a corridor with a food trail on x = 2..last (codes counting up from the nest, as the kit writes them);
 * returns the round in which the last trail cell is eaten, or 0 if it never is. */
function eatRound(seed: number, last: number): number {
  const wall = '# '.repeat(W).trim();
  const row = Array.from({ length: W }, (_, x) => (x === 0 || x === W - 1 ? '#' : x === 1 ? '+' : '.')).join(' ');
  const map = parseMap(`${W}\n4\n${[wall, row, wall, wall].join('\n')}\n`);
  const s = createSim({ map, programs: [compileRules('kit trail\nkit foodtrail\nalways -> follow trail').program], seed, wrap: false });
  const snap = s.snapshot();
  for (let x = 2; x <= last; x++) snap[12 + (W + x) * 5 + 2] = (1 << ((x - 1) % 3)) | FOOD; // same layout the corridor tests of lang.test.ts use
  s.restore(snap);
  for (let r = 1; r <= 600; r++) {
    s.step();
    if (!(s.marks[W + last] & FOOD)) return r;
  }
  return 0;
}

test('follow trail eats a dead end every time: the round it happens does not depend on the random numbers', () => {
  const rounds = Array.from({ length: 25 }, (_, i) => eatRound(i + 1, 6));
  assert.ok(rounds[0] > 0, 'the dead end is eaten');
  assert.deepEqual([...new Set(rounds)], [rounds[0]], `eaten in rounds ${[...new Set(rounds)].join(', ')}`);
});

test('the lowered follow trail has one flip (the random step off a blocked lane) and none at the dead end', () => {
  const asm = code(compileRules('kit trail\nkit foodtrail\nalways -> follow trail').asm);
  assert.deepEqual([...asm.matchAll(/flipzero (\d+)/g)].map((m) => Number(m[1])), [2]);
});

test('ants/trail.rules is 382 instructions and 239 states (it was 385 and 242 while a dead end was eaten 1 time in 4)', () => {
  const c = compileRules(TRAIL);
  assert.deepEqual([c.instructions, c.program.n], [382, 239]);
});
