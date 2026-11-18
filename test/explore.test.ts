import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { RulesError, compileRules } from '../src/lang/index.ts';
import { EXPLORE_DEFAULT } from '../src/lang/parse.ts';

const TRAIL = readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8');
const code = (asm: string): string => asm.split('\n').filter((l) => !l.trimStart().startsWith(';')).join('\n');
const flips = (src: string): number[] => [...code(compileRules(src).asm).matchAll(/flipzero (\d+)/g)].map((m) => Number(m[1]));

test('explore turns 1 step in N: the default is 64, "explore N" sets it (2 to 64), anything else is an error with its line', () => {
  assert.equal(EXPLORE_DEFAULT, 64);
  assert.deepEqual(flips('always -> explore').slice(0, 1), [64]);
  for (const n of [2, 5, 13, 64]) assert.deepEqual(flips(`always -> explore ${n}`).slice(0, 1), [n], `explore ${n}`);
  const bad = (src: string, re: RegExp): void => assert.throws(() => compileRules(src), (e) => e instanceof RulesError && re.test(e.message), src);
  bad('always -> explore 1', /^line 1: "explore N": N must be a number from 2 to 64/);
  bad('when food ahead -> move\nalways -> explore 65', /^line 2: "explore N": N must be a number from 2 to 64/);
  bad('always -> explore many', /^line 1: "explore N": N must be a number from 2 to 64/);
  bad('always -> explore 5 5', /^line 1: "explore 5 5": explore, or explore N/);
});

test('"explore 5" is exactly the old default: trail.rules with it differs from the new default in one flip and nothing else', () => {
  const old = TRAIL.replace(/otherwise explore$/m, 'otherwise explore 5');
  assert.notEqual(old, TRAIL);
  assert.equal(code(compileRules(old).asm), code(compileRules(TRAIL).asm).replace('flipzero 64 else', 'flipzero 5 else'));
  assert.equal(compileRules(old).program.n, compileRules(TRAIL).program.n, 'the same size either way');
});

test('the turn rate in open country is about 1 in N per step', () => {
  const rows = Array.from({ length: 10 }, (_, y) => `${y % 2 ? ' ' : ''}${Array.from({ length: 10 }, (_, x) => (x === 4 && y === 4 ? '+' : '.')).join(' ')}`);
  const map = parseMap(`10\n10\n${rows.join('\n')}\n`); // no rocks, wrapped: nothing blocks the walk
  for (const [n, lo, hi] of [[4, 0.2, 0.3], [16, 0.04, 0.085]] as const) {
    const sim = createSim({ map, programs: [compileRules(`always -> explore ${n}`).program], rules: CLASSIC, seed: 7 });
    let moves = 0, turns = 0, prev = sim.ant(0);
    for (let r = 0; r < 60000; r++) {
      sim.step();
      const a = sim.ant(0);
      if (a.pos !== prev.pos) moves++; else if (a.dir !== prev.dir) turns++;
      prev = a;
    }
    assert.ok(moves > 3000, `${moves} steps`);
    assert.ok(turns / moves >= lo && turns / moves <= hi, `explore ${n}: ${turns} turns in ${moves} steps = ${(turns / moves).toFixed(3)}`);
  }
});

test('the retuned explorer forages faster: more food home after 20,000 rounds than "explore 5" (the measurement is in docs/EXPLORE.md)', () => {
  const idle = compileRules('always -> drop').program;
  const fresh = compileRules(TRAIL).program, old = compileRules(TRAIL.replace(/otherwise explore$/m, 'otherwise explore 5')).program;
  let a = 0, b = 0, wins = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const map = generateWorld(seed), s1 = createSim({ map, programs: [fresh, idle], seed }), s2 = createSim({ map, programs: [old, idle], seed });
    s1.run(20000); s2.run(20000);
    a += s1.score()[0]; b += s2.score()[0];
    if (s1.score()[0] > s2.score()[0]) wins++;
  }
  assert.ok(a > b * 1.1 && wins >= 5, `new ${a} against old ${b} (${wins}/8 worlds)`);
});
