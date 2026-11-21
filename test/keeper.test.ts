import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { createSim } from '../src/core/sim.ts';
import { compileRules } from '../src/lang/index.ts';
import { DEFAULTS, KEEP, KEEP_AFTER, LEVELS, SETTLE, SETTLE_DEFAULT, TEMPLATES, personality } from '../src/lang/templates.ts';

const TRAIL = readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8');
const rules = (t: string): string[] => t.split('\n').filter((l) => l && !l.startsWith('#'));
const keeper = compileRules(personality(DEFAULTS.keeper)).program, trail = compileRules(TRAIL).program;
const idle = compileRules('always -> drop').program;

/** The rule lines of each mood of a rules text. */
const moods = (text: string): Map<string, string[]> => {
  const m = new Map<string, string[]>();
  let cur: string[] = [];
  for (const l of rules(text)) if (l.startsWith('mood ')) { cur = []; m.set(l.slice(5), cur); } else cur.push(l);
  return m;
};

test('the keeper is the trail-layer with its deliveries counted: two free ones, then a settle step after each', () => {
  assert.deepEqual([KEEP, KEEP_AFTER], [10, 2]);
  assert.equal(SETTLE[SETTLE_DEFAULT], KEEP);
  assert.deepEqual(TEMPLATES, ['forager', 'trail', 'keeper', 'guard', 'raider']);
  const k = moods(personality(DEFAULTS.keeper)), t = moods(personality(DEFAULTS.trail));
  assert.deepEqual([...moods(TRAIL).keys()], ['start', 'search', 'return'], 'the trail-layer is ants/trail.rules');
  assert.deepEqual([...moods(TRAIL).values()], [...t.values()]);
  assert.deepEqual([...k.keys()], ['start', 'search0', 'return0', 'search1', 'return1', 'search2', 'return2', 'settle', 'sit']);
  assert.deepEqual(k.get('start'), ['  always -> turn random, switch search0']);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(k.get(`search${i}`), (t.get('search') as string[]).map((l) => l.replace('switch return', `switch return${i}`)), `search${i}`);
    const drop = i < 2 ? `  when home here -> drop, turn random, switch search${i + 1}` : '  when home here -> drop, switch settle';
    assert.deepEqual(k.get(`return${i}`), (t.get('return') as string[]).map((l) => (l.includes('-> drop,') ? drop : l)), `return${i}`);
  }
  assert.deepEqual(k.get('settle'), ['  when 1 in 10 -> switch sit', '  always -> turn random, switch search2']);
  assert.deepEqual(k.get('sit'), ['  always -> wait']);
  const c = compileRules(personality(DEFAULTS.keeper));
  assert.deepEqual([c.warnings, c.program.n, c.instructions], [[], 689, 1111]);
});

test('lint: a mood that only waits is a deliberate rest, any other mood that never switches is still reported', () => {
  const lint = (src: string): string[] => compileRules(src).warnings.filter((w) => /mood/.test(w)); // (these toy programs also never pick up or drop)
  assert.deepEqual(lint('mood a\nalways -> switch b\nmood b\nalways -> wait'), []);
  assert.deepEqual(lint('mood a\nalways -> switch b\nmood b\nwhen food here -> wait\nalways -> wait'), []);
  assert.match(lint('mood a\nalways -> switch b\nmood b\nalways -> move').join(), /mood "b" never switches/);
  assert.match(lint('mood a\nalways -> switch b\nmood b\nalways -> wait, move').join(), /mood "b" never switches/);
});

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

test('after a long game a third of the keepers sit on their piles (30 of 91 measured); a trail-layer has none', () => {
  for (const seed of [1, 2]) {
    const n = sitters(keeper, seed);
    assert.ok(n >= 20 && n <= 45, `seed ${seed}: ${n} sitters of 91`);
    assert.equal(sitters(trail, seed), 0);
  }
});

test('the settling slider orders the sitters: 13, 18, 30, 30 of 91 on seed 1 from rarely to often', () => {
  const n = LEVELS.settling.map((_, settling) => sitters(compileRules(personality({ ...DEFAULTS.keeper, settling })).program, 1));
  assert.ok(n[0] >= 8 && n[0] < n[1] && n[1] < n[2] && n[2] <= n[3], `sitters by level: ${n.join(' ')}`);
});

test('the keeper comes out ahead of the plain trail-layer in 12 games (10-2, 23% more food here; the evidence is 118-0-42 over 160 in docs/STEALING.md)', () => {
  let wins = 0, losses = 0, mine = 0, theirs = 0;
  for (let seed = 1; seed <= 6; seed++) {
    for (const swap of [false, true]) {
      const s = createSim({ map: generateWorld(seed), programs: swap ? [trail, keeper] : [keeper, trail], seed });
      s.run(100000);
      const [a, b] = s.score(), k = swap ? b : a, t = swap ? a : b;
      mine += k; theirs += t;
      if (k > t) wins++; else if (k < t) losses++;
    }
  }
  assert.ok(wins >= losses + 4 && mine > theirs * 1.1, `${wins} wins, ${losses} losses, food ${mine} against ${theirs}`);
});
