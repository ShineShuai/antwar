import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { loadAnyBrain, looksLikeRules } from '../src/lang/index.ts';
import { createEngine } from '../web/engine.ts';
import { describeBrain, fireRows } from '../web/brain.ts';
import { EXAMPLES, FORAGER_RULES, STARTER, STARTER_ASM, TRAIL_RULES } from '../web/default-ant.ts';
import type { Reply } from '../web/protocol.ts';

type Frame = Extract<Reply, { type: 'frame' }>;
const file = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('looksLikeRules: by the first real line, comments of either style skipped', () => {
  assert.ok(looksLikeRules('# hi\n\nwhen food ahead -> move'));
  assert.ok(looksLikeRules('; note\nmood a\nalways -> wander'));
  assert.ok(looksLikeRules('KIT trail\nalways -> wander'));
  assert.ok(looksLikeRules('otherwise wander'));
  assert.ok(!looksLikeRules(STARTER));
  assert.ok(!looksLikeRules(STARTER_ASM));
  assert.ok(!looksLikeRules('kit: sense ahead food else kit\ngoto kit'), 'a label called kit is assembly');
  assert.ok(!looksLikeRules(''));
});

test('loadAnyBrain: the three formats', () => {
  assert.equal(loadAnyBrain(STARTER, CLASSIC).program.n, 16);
  assert.equal(loadAnyBrain(STARTER_ASM, CLASSIC).compiled, undefined);
  const r = loadAnyBrain(FORAGER_RULES, CLASSIC);
  assert.equal(r.compiled?.rules.length, 6);
  assert.ok(r.program.n > 0);
});

test('describeBrain: summaries, warnings and errors with line numbers', () => {
  const rules = describeBrain('when food ahead -> move\nalways -> turn left\nwhen rock here -> drop');
  assert.ok(rules.ok && rules.kind === 'rules');
  if (rules.ok) {
    assert.match(rules.summary, /^rules: 3 rules in 1 mood, \d+ instructions of 2000, \d+ states$/);
    assert.ok(rules.warnings.some((w) => /line 3: this rule can never run/.test(w)));
    assert.equal(rules.rules[0].text, 'when food ahead -> move');
  }
  const bad = describeBrain('when fod ahead -> move');
  assert.ok(!bad.ok && bad.kind === 'rules');
  if (!bad.ok) assert.match(bad.error, /^line 1: unknown condition "fod".*did you mean "food"/);
  const asm = describeBrain(STARTER_ASM);
  assert.ok(asm.ok && asm.kind === 'asm');
  if (asm.ok) assert.match(asm.summary, /^flat assembly: 16 states$/);
  const ant = describeBrain(STARTER);
  assert.ok(ant.ok && ant.kind === 'ant');
  if (ant.ok) assert.equal(ant.summary, 'official .ant: 16 states');
  const badAsm = describeBrain('move else 0');
  assert.ok(!badAsm.ok && badAsm.kind === 'asm');
  if (!badAsm.ok) assert.match(badAsm.error, /line 1/);
});

test('examples: the rules examples are the files in ants/, and every example loads without warnings', () => {
  assert.equal(FORAGER_RULES, file('ants/forager.rules'));
  assert.equal(TRAIL_RULES, file('ants/trail.rules'));
  for (const e of EXAMPLES) {
    const d = describeBrain(e.text);
    assert.ok(d.ok, `${e.name}: ${d.ok ? '' : d.error}`);
    if (d.ok) assert.deepEqual(d.warnings, [], e.name);
  }
});

test('fireRows: shares of acting ant-rounds per rule, glue last, nothing before the first count', () => {
  const rules = [{ mood: 'a', text: 'when x -> y' }, { mood: 'a', text: 'otherwise z' }];
  assert.deepEqual(fireRows(rules, { test: [0, 0], act: [0, 0], glue: 0, total: 0 }), []);
  const rows = fireRows(rules, { test: [20, 0], act: [10, 50], glue: 20, total: 100 });
  assert.deepEqual(rows.map((r) => [r.label, r.test, r.act]), [['a: when x -> y', 0.2, 0.1], ['a: otherwise z', 0, 0.5], ['(glue)', 0, 0.2]]);
});

test('engine: explain counts rule firing for rules brains only, adds up, and never changes the match', () => {
  const eng = createEngine();
  eng.handle({ type: 'init', seed: 5, brains: [TRAIL_RULES, STARTER] });
  const f = eng.handle({ type: 'run', n: 600, explain: true }).msg as Frame;
  assert.equal(f.fires.length, 2);
  assert.equal(f.fires[1], null, 'the .ant colony has no rules');
  const a = f.fires[0];
  assert.ok(a && a.total > 0);
  if (a) {
    const sum = a.test.reduce((x, y) => x + y, 0) + a.act.reduce((x, y) => x + y, 0) + a.glue;
    assert.equal(sum, a.total);
    assert.equal(a.test.length, loadAnyBrain(TRAIL_RULES, CLASSIC).compiled?.rules.length);
  }
  // the same match without counting has the same hash
  const plain = createEngine();
  plain.handle({ type: 'init', seed: 5, brains: [TRAIL_RULES, STARTER] });
  assert.equal((plain.handle({ type: 'run', n: 600 }).msg as Frame).hash, f.hash);
  const direct = createSim({ map: generateWorld(5), programs: [loadAnyBrain(TRAIL_RULES).program, loadAnyBrain(STARTER).program], seed: 5 });
  direct.run(600);
  assert.equal(direct.hash(), f.hash);
  // counting off leaves the counts alone; a new init resets them
  const before = a?.total;
  assert.equal((eng.handle({ type: 'run', n: 50 }).msg as Frame).fires[0]?.total, before);
  eng.handle({ type: 'init', seed: 5, brains: [TRAIL_RULES, STARTER] });
  assert.equal((eng.handle({ type: 'frame' }).msg as Frame).fires[0]?.total, 0);
});

test('engine: a rules error comes back as a message with the line number', () => {
  const eng = createEngine();
  const r = eng.handle({ type: 'init', seed: 1, brains: ['always -> wander', 'when food -> move'] }).msg;
  assert.equal(r.type, 'error');
  if (r.type === 'error') assert.match(r.message, /^line 1: "food": say where to look/);
});
