import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { loadAnyBrain, looksLikeRules } from '../src/lang/index.ts';
import { createEngine } from '../web/engine.ts';
import { describeBrain, fireRows, lineOfMessage, traceRows, whereIs } from '../web/brain.ts';
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
  const rules = [{ id: 0, mood: 'a', text: 'when x -> y', line: 3 }, { id: 1, mood: 'a', text: 'otherwise z', line: 4 }];
  assert.deepEqual(fireRows(rules, { test: [0, 0], act: [0, 0], glue: 0, total: 0 }), []);
  const rows = fireRows(rules, { test: [20, 0], act: [10, 50], glue: 20, total: 100 });
  assert.deepEqual(rows.map((r) => [r.label, r.test, r.act, r.rule, r.line]), [['a: when x -> y', 0.2, 0.1, 0, 3], ['a: otherwise z', 0, 0.5, 1, 4], ['(glue)', 0, 0.2, -1, null]]);
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

test('lineOfMessage: lint warnings and errors point at a line', () => {
  assert.equal(lineOfMessage('line 12: this rule can never run'), 12);
  assert.equal(lineOfMessage('warning: line 3: mood "x" is never entered'), 3);
  assert.equal(lineOfMessage('this program never picks up food'), null);
});

test('whereIs: a pc points back at a rule (test or action), or at the source line of an assembly / .ant brain', () => {
  const rules = describeBrain('# c\nwhen food ahead -> move\nalways -> turn left');
  assert.ok(rules.ok && rules.compiled);
  if (!rules.ok || !rules.compiled) return;
  const at = (pc: number) => whereIs(rules, pc);
  assert.deepEqual({ ...at(0), label: undefined }, { label: undefined, line: 2, rule: 0, part: 'test' }); // the sense of the first rule
  assert.equal(at(0).label, 'main: when food ahead -> move');
  const parts = Array.from({ length: rules.program.n }, (_, pc) => at(pc));
  assert.ok(parts.some((w) => w.rule === 0 && w.part === 'action'));
  assert.ok(parts.some((w) => w.rule === 1 && w.line === 3));
  assert.ok(parts.every((w) => w.rule >= -1 && w.rule <= 1));
  const asm = describeBrain('start: sense ahead food else start ; look\n  move else start\n  goto start');
  assert.ok(asm.ok);
  assert.deepEqual({ ...whereIs(asm, 1), rule: undefined }, { label: 'line 2: move else start', line: 2, rule: undefined, part: '' });
  const ant = describeBrain('Sense Ahead 1 0 Food ; find\nMove 0 0');
  assert.ok(ant.ok);
  assert.equal(whereIs(ant, 0).label, 'line 1: Sense Ahead 1 0 Food');
  assert.equal(whereIs({ ok: false, kind: 'rules', error: 'x' }, 0).line, null);
});

test('traceRows: consecutive rounds in the same rule part are one row; newest first; capped', () => {
  const info = describeBrain('when food ahead -> move\nalways -> turn left');
  assert.ok(info.ok);
  if (!info.ok) return;
  const n = info.program.n, pcs = Array.from({ length: n }, (_, pc) => pc);
  const test0 = pcs.find((pc) => whereIs(info, pc).rule === 0 && whereIs(info, pc).part === 'test') ?? 0;
  const act1 = pcs.find((pc) => whereIs(info, pc).rule === 1 && whereIs(info, pc).part === 'action') ?? 0;
  const trace = [10, test0, 11, test0, 12, test0, 13, act1, 40, test0];
  const rows = traceRows(info, trace);
  assert.deepEqual(rows.map((r) => [r.fromRound, r.toRound, r.count, r.rule, r.part]), [[40, 40, 1, 0, 'test'], [13, 13, 1, 1, 'action'], [10, 12, 3, 0, 'test']]);
  assert.equal(traceRows(info, trace, 2).length, 2);
  assert.deepEqual(traceRows(info, []), []);
});

test('engine: track follows one ant\'s acting rounds without changing the match', () => {
  const eng = createEngine(), plain = createEngine();
  const init = { type: 'init' as const, seed: 7, brains: [TRAIL_RULES, STARTER] as [string, string] };
  eng.handle(init); plain.handle(init);
  const f0 = eng.handle({ type: 'frame' }).msg as Frame;
  assert.deepEqual(f0.trace, []);
  const id = f0.ants[0]; // the first ant of colony A
  const t = eng.handle({ type: 'track', ant: id }).msg as Frame;
  assert.deepEqual(t.trace, []);
  const f = eng.handle({ type: 'run', n: 400 }).msg as Frame;
  assert.ok(f.trace.length >= 10 && f.trace.length % 2 === 0, `${f.trace.length}`);
  const rounds = f.trace.filter((_, i) => i % 2 === 0), pcs = f.trace.filter((_, i) => i % 2 === 1);
  assert.ok(rounds.every((r, i) => i === 0 || r > rounds[i - 1]), 'rounds strictly increase');
  assert.ok(rounds[0] >= 1 && rounds.at(-1)! <= 400);
  const info = describeBrain(TRAIL_RULES);
  assert.ok(info.ok && pcs.every((pc) => pc >= 0 && pc < info.program.n));
  // the tracked ant acts only when it is not resting: far fewer rounds than 400
  assert.ok(rounds.length < 400);
  assert.equal(f.hash, (plain.handle({ type: 'run', n: 400 }).msg as Frame).hash, 'tracking does not change the match');
  assert.deepEqual((eng.handle({ type: 'track', ant: null }).msg as Frame).trace, []);
  assert.equal(eng.handle({ type: 'track', ant: 100000 }).msg.type, 'error');
  eng.handle(init);
  assert.deepEqual((eng.handle({ type: 'frame' }).msg as Frame).trace, [], 'a new match forgets the trace');
});
