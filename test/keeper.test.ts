import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { createSim } from '../src/core/sim.ts';
import { compileRules } from '../src/lang/index.ts';
import { DEFAULTS, KEEP, TEMPLATES, personality } from '../src/lang/templates.ts';

const TRAIL = readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8');
const rules = (t: string): string[] => t.split('\n').filter((l) => l && !l.startsWith('#'));
const keeper = compileRules(personality(DEFAULTS.keeper)).program, trail = compileRules(TRAIL).program;
const idle = compileRules('always -> drop').program;

test('the keeper is the trail-layer plus a settle step after each delivery, and nothing else', () => {
  assert.equal(KEEP, 30);
  assert.deepEqual(TEMPLATES, ['forager', 'trail', 'keeper', 'guard', 'raider']);
  const k = rules(personality(DEFAULTS.keeper)), t = rules(personality(DEFAULTS.trail));
  assert.deepEqual(k.slice(-5), ['mood settle', '  when 1 in 30 -> switch sit', '  always -> turn random, switch search', 'mood sit', '  always -> wait']);
  const back = k.slice(0, -5).map((l) => (l === '  when home here -> drop, switch settle' ? '  when home here -> drop, turn random, switch search' : l));
  assert.deepEqual(back, t, 'only the drop rule and the two moods differ');
  assert.deepEqual(back, rules(TRAIL), 'and the trail-layer is ants/trail.rules');
  const c = compileRules(personality(DEFAULTS.keeper));
  assert.deepEqual([c.warnings, c.program.n], [[], 241]);
});

test('lint: a mood that only waits is a deliberate rest, any other mood that never switches is still reported', () => {
  const moods = (src: string): string[] => compileRules(src).warnings.filter((w) => /mood/.test(w)); // (these toy programs also never pick up or drop)
  assert.deepEqual(moods('mood a\nalways -> switch b\nmood b\nalways -> wait'), []);
  assert.deepEqual(moods('mood a\nalways -> switch b\nmood b\nwhen food here -> wait\nalways -> wait'), []);
  assert.match(moods('mood a\nalways -> switch b\nmood b\nalways -> move').join(), /mood "b" never switches/);
  assert.match(moods('mood a\nalways -> switch b\nmood b\nalways -> wait, move').join(), /mood "b" never switches/);
});

test('after a long game a fifth of the keepers sit on their piles; a trail-layer has none', () => {
  const sitters = (prog: typeof keeper, seed: number): number => {
    const s = createSim({ map: generateWorld(seed), programs: [prog, idle], seed });
    s.run(100000);
    const before = Array.from({ length: s.ants }, (_, i) => s.ant(i));
    s.run(1000);
    let n = 0;
    for (let i = 0; i < s.ants; i++) {
      const a = s.ant(i), b = before[i];
      if (a.col === 0 && a.alive && a.pos === b.pos && a.pc === b.pc && a.has === 0) n++; // the same cell, the same state, 1,000 rounds on
    }
    return n;
  };
  for (const seed of [1, 2]) {
    const n = sitters(keeper, seed);
    assert.ok(n >= 4 && n <= 40, `seed ${seed}: ${n} sitters of 91`);
    assert.equal(sitters(trail, seed), 0);
  }
});

test('the keeper beats the plain trail-layer: 12 games (6 worlds, both hills, 100,000 rounds), measured 10-2 here and 109-0-51 over 160 games in docs/STEALING.md', () => {
  let wins = 0, losses = 0;
  for (let seed = 1; seed <= 6; seed++) {
    for (const swap of [false, true]) {
      const s = createSim({ map: generateWorld(seed), programs: swap ? [trail, keeper] : [keeper, trail], seed });
      s.run(100000);
      const [a, b] = s.score(), mine = swap ? b : a, theirs = swap ? a : b;
      if (mine > theirs) wins++; else if (mine < theirs) losses++;
    }
  }
  assert.ok(wins >= 8 && losses <= 4, `${wins} wins, ${losses} losses`);
});
