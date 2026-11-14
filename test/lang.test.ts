import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { RulesError, compileRules, ruleAt } from '../src/lang/index.ts';

const grid = (...rows: string[]): string => `${rows[0].replace(/ /g, '').length}\n${rows.length}\n${rows.join('\n')}\n`;
const room = parseMap(grid('# # # # # #', '# + . . . #', '. . . . . .', '. . . . . .'));
const foodAhead = parseMap(grid('# # # # # #', '# + 3 . . #', '. . . . . .', '. . . . . .'));
const sim = (src: string, map = room, seed = 1) => createSim({ map, programs: [compileRules(src).program], seed, wrap: false });
const bad = (src: string, re: RegExp): void => assert.throws(() => compileRules(src), (e: unknown) => e instanceof RulesError && re.test(e.message), src);

test('parser: arrows, comments, implicit mood, case', () => {
  const a = compileRules('# c\nWHEN food ahead -> move  # go\nalways do wander\notherwise then drop');
  assert.deepEqual(a.moods, ['main']);
  assert.equal(a.rules.length, 3);
  assert.equal(a.rules[0].line, 2);
  assert.ok(compileRules('when food left-ahead and not rock right ahead → turn left, move').program.n > 0);
});

test('parser: plain-English errors carry the line number and a suggestion', () => {
  bad('always -> wander\nwhen fod ahead -> move', /^line 2: unknown condition "fod".*did you mean "food"/);
  bad('when food -> move', /line 1: "food": say where to look/);
  bad('when food ahead -> mov', /line 1: unknown action "mov".*did you mean "move"/);
  bad('when food ahead -> turn up', /turn left, turn right, turn around or turn random/);
  bad('when food ahead -> switch nowhere', /no mood called "nowhere"/);
  bad('mood a\nwhen rock here -> move\notherwise move\nwhen food here -> drop', /line 4: the rules after "otherwise"/);
  bad('when food ahead -> step, drop', /"step" must be the last action/);
  bad('when food ahead -> move,', /empty action/);
  bad('mood a\nmood a\nalways -> move', /defined twice/);
  bad('mood a', /has no rules|no rules found/);
  bad('', /no rules found/);
  bad('hello world', /must start with when, always, otherwise, mood or kit/);
  bad('kit trail\nwhen marker 1 here -> move', /marker 1 is used by the trail kit/);
  bad('kit trail\nalways -> mark 2', /marker 2 is used by the trail kit/);
  bad('always -> return home', /needs "kit trail"/);
  bad('kit trail\nalways -> follow trail', /needs "kit foodtrail"/);
  bad('kit foodtrail\nalways -> wander', /kit foodtrail needs kit trail/);
  bad('kit sparkle\nalways -> wander', /unknown kit "sparkle"/);
  bad('mood a\nalways -> switch b\nmood b\nalways -> switch a', /switch to each other without ever acting/);
});

test('semantics: the first matching rule fires and the loop restarts at the top every round', () => {
  const s = sim('when food ahead -> turn left\nwhen food ahead -> turn right', foodAhead);
  s.run(2);
  assert.equal(s.ant(0).dir, 5); // sense (1 round), turn left (1 round); the second rule never runs
  s.run(40);
  assert.equal(s.ant(0).dir, 5); // the food is no longer ahead, and both rules fail
});

test('semantics: a failed action continues with the next rule, and earlier actions of that rule persist', () => {
  // rock to the north-east: turn left works, the move fails, the next rule turns right from the NEW heading
  const s = sim('always -> turn left, move\nalways -> turn right');
  s.run(3);
  assert.equal(s.ant(0).dir, 0);
});

test('semantics: not, otherwise, carrying', () => {
  const noFood = sim('when not food ahead -> mark 0\notherwise -> mark 1');
  noFood.run(2);
  assert.equal(noFood.marks[1 * 6 + 1], 1);
  const food = sim('when not food ahead -> mark 0\notherwise -> mark 1', foodAhead);
  food.run(2);
  assert.equal(food.marks[1 * 6 + 1], 2);
  const carry = sim('when food ahead and not home ahead -> move\nwhen food here and not home here -> pickup\nwhen carrying -> mark 0', foodAhead);
  carry.run(120);
  assert.equal(carry.ant(0).has, 1);
  assert.equal(carry.food[1 * 6 + 2], 2);
  assert.equal(carry.marks[1 * 6 + 2], 1);
});

test('semantics: switch costs no round; turn around is three turns; turn random reaches every direction', () => {
  const s = sim('mood a\nalways -> turn left, switch b\nmood b\nalways -> turn left, switch a');
  s.run(4);
  assert.equal(s.ant(0).dir, (6 - 4) % 6); // four turns left in four rounds
  const t = sim('always -> turn around, switch z\nmood z\nalways -> mark 0');
  t.run(3);
  assert.equal(t.ant(0).dir, 3);
  const seen = new Set<number>();
  const counts = Array(6).fill(0) as number[];
  for (let seed = 1; seed <= 120; seed++) {
    const r = sim('always -> turn random, switch z\nmood z\nalways -> mark 0', room, seed);
    r.run(12);
    counts[r.ant(0).dir]++; seen.add(r.ant(0).dir);
  }
  assert.equal(seen.size, 6);
  assert.ok(counts.every((c) => c >= 8), `uneven: ${counts}`);
});

test('kit trail: step keeps the 0,1,2 codes along a corridor', () => {
  const corridor = parseMap(grid('# # # # # # # # # # # # # #', '# + . . . . . . . . . . . #', '# # # # # # # # # # # # # #', '# # # # # # # # # # # # # #'));
  const s = sim('kit trail\nalways -> step', corridor);
  s.run(150);
  const codes: number[] = [];
  for (let x = 1; x < 13; x++) { const m = s.marks[1 * 14 + x]; if (!m) break; codes.push(m); }
  assert.ok(codes.length >= 4, `only ${codes.length} cells coded`);
  codes.forEach((m, i) => assert.equal(m, 1 << (i % 3), `cell ${i + 1}`)); // one-hot code = steps mod 3
});

test('kit trail: an ant that walked out, picked up and turned around follows the codes back to the nest', () => {
  const corridor = parseMap(grid('# # # # # # # # # # # # # #', '# + . . . . . . . 1 . . . #', '# # # # # # # # # # # # # #', '# # # # # # # # # # # # # #'));
  const s = sim([
    'kit trail',
    'mood out',
    '  when food here and not home here -> pickup, turn around, switch back',
    '  always -> step',
    'mood back',
    '  when home here -> drop, switch out',
    '  always -> return home',
    '  otherwise roam',
  ].join('\n'), corridor);
  s.run(1500);
  assert.ok(s.score()[0] >= 1, 'the packet was not delivered');
});

test('lint: shadowed rules, unreachable and stuck moods, never picks up / drops, scent that is never read', () => {
  const w = compileRules('always -> turn left\nwhen food ahead -> move\nmood spare\nalways -> mark 0').warnings.join('\n');
  assert.match(w, /line 2: this rule can never run/);
  assert.match(w, /mood "spare" is never entered/);
  assert.match(w, /never picks up food/);
  assert.match(w, /never drops food/);
  assert.match(w, /marker 0 is written but no rule ever reads it/);
  assert.match(compileRules('mood a\nalways -> switch b\nmood b\nalways -> turn left').warnings.join('\n'), /mood "b" never switches/);
  assert.deepEqual(compileRules(readFileSync(new URL('../ants/forager.rules', import.meta.url), 'utf8')).warnings, []);
  assert.match(compileRules('kit trail\nmood r\nalways -> return home\nmood x\nalways -> switch r').warnings.join('\n'), /never checks for the nest/);
});

test('size limit: a program that expands past 2,000 instructions is refused with advice', () => {
  const big = `kit trail\nkit foodtrail\n${Array.from({ length: 40 }, () => 'always -> follow trail').join('\n')}\notherwise explore`;
  bad(big, /too big/);
});

test('compile is deterministic and maps every pc to a rule', () => {
  const src = readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8');
  const a = compileRules(src), b = compileRules(src);
  assert.equal(a.asm, b.asm);
  assert.deepEqual(a.warnings, []);
  const seen = new Set<number>();
  for (let pc = 0; pc < a.program.n; pc++) seen.add(ruleAt(a, pc).rule);
  assert.ok(a.rules.every((r) => seen.has(r.id)), 'a rule has no instruction');
  assert.equal(ruleAt(a, 0).rule, 0);
});

test('trail.rules forages from a cold start and no carrier freezes (compare ants/trail.asm)', () => {
  const brain = compileRules(readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8')).program;
  const idle = compileRules('always -> drop').program;
  for (const seed of [1, 2, 3]) {
    const s = createSim({ map: generateWorld(seed), programs: [brain, idle], seed });
    const streak = new Map<number, number>();
    let longest = 0;
    for (let r = 50; r <= 30000; r += 50) {
      s.run(50);
      for (let i = 0; i < s.ants; i++) {
        const a = s.ant(i);
        if (a.col !== 0) continue;
        const k = a.has > 0 ? (streak.get(i) ?? 0) + 1 : 0;
        streak.set(i, k);
        longest = Math.max(longest, k);
      }
    }
    // jams clear on their own (seed 1: a carrier waited ~12,000 rounds), a frozen carrier would hold for the whole run
    assert.ok(longest * 50 <= 20000, `seed ${seed}: a carrier held food for ${longest * 50} rounds`);
    assert.ok(s.score()[0] >= 150, `seed ${seed}: only ${s.score()[0]} food after 30,000 rounds`);
  }
});
