import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OP, assemble, parseIcfp, toIcfp } from '../src/core/asm.ts';
import { generateWorld } from '../src/core/gen.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { RULESETS } from '../src/core/rules.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { ScriptError, compileRules, compileScript, loadAnyBrain, looksLikeScript, scriptLineAt } from '../src/lang/index.ts';
import { describeBrain, lineOfMessage, traceRows, whereIs } from '../web/brain.ts';
import { STARTER, STARTER_ASM, STARTER_SCRIPT, TRAIL_RULES } from '../web/default-ant.ts';

const file = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const MAP = parseMap('6\n4\n. . . . . .\n . + . . . .\n. . . . . .\n . . . . . .\n'); // one red ant at (1, 1) = cell 7
const run = (src: string, rounds: number): ReturnType<typeof createSim> => {
  const sim = createSim({ map: MAP, programs: [compileScript(src).program] });
  sim.run(rounds);
  return sim;
};
const marker = (sim: ReturnType<typeof createSim>, k: number): number => (sim.marks[7] >> k) & 1;
const dirs = (src: string, rounds: number): number[] => {
  const sim = createSim({ map: MAP, programs: [compileScript(src).program] });
  return Array.from({ length: rounds }, () => { sim.step(); return sim.ant(0).dir; });
};
const err = (src: string, rules = CLASSIC): string => {
  try { compileScript(src, rules); } catch (e) { assert.ok(e instanceof ScriptError, String(e)); return e.message; }
  return assert.fail('expected a compile error');
};

test('looksLikeScript: the first word after comments is "define"', () => {
  assert.ok(looksLikeScript('define main { move ; }'));
  assert.ok(looksLikeScript('// a comment\n# another\n/* block\ncomment */\n  DEFINE main { move ; }'));
  assert.ok(!looksLikeScript('when food ahead -> move'));
  assert.ok(!looksLikeScript(STARTER_ASM));
  assert.ok(!looksLikeScript(STARTER));
  assert.ok(!looksLikeScript('definitely: move else definitely\n goto definitely'), 'a label that starts with "define" is assembly');
  assert.ok(!looksLikeScript(''));
});

test('costs: a sense is one round, the branch taken is next, a goto is free', () => {
  const yes = 'define main { loop { sense here friend then mark 1 ; else mark 2 ; } }'; // the ant always sees itself
  const no = 'define main { loop { sense here foe then mark 1 ; else mark 2 ; } }';   // here foe is always false
  assert.deepEqual([marker(run(yes, 1), 1), marker(run(yes, 2), 1), marker(run(yes, 2), 2)], [0, 1, 0]);
  assert.deepEqual([marker(run(no, 1), 2), marker(run(no, 2), 2), marker(run(no, 2), 1)], [0, 1, 0]);
  assert.deepEqual(dirs('define main { top: turn left ; goto top ; }', 7), [5, 4, 3, 2, 1, 0, 5]);
  assert.deepEqual(dirs('define main { goto skip ; turn left ; skip: mark 0 ; }', 3), [0, 0, 0], 'a forward goto skips the turn');
  assert.equal(marker(run('define main { goto skip ; turn left ; skip: mark 0 ; }', 1), 0), 1, 'and costs no round');
});

test('repeat unrolls (4 turns, then the mark in round 5); loop and exit: exit costs nothing; the program restarts at its end', () => {
  const rep = 'define main { repeat 4 turn left ; mark 0 ; }';
  assert.deepEqual([run(rep, 4).ant(0).dir, marker(run(rep, 4), 0), marker(run(rep, 5), 0), run(rep, 6).ant(0).dir], [2, 0, 1, 1]);
  const ex = 'define main { loop { turn left ; exit ; } mark 3 ; }';
  assert.deepEqual([marker(run(ex, 1), 3), run(ex, 1).ant(0).dir, marker(run(ex, 2), 3), run(ex, 3).ant(0).dir], [0, 5, 1, 4]);
  assert.equal(dirs('define main { repeat 0 turn left ; mark 0 ; }', 2).join(), '0,0', 'repeat 0 is nothing');
});

test('choose: a flip chain k, k-1, ..., 2 (uniform), and about a third of 91 ants pick each of 3 cases', () => {
  for (let k = 1; k <= 6; k++) {
    const cases = Array.from({ length: k }, (_, i) => `case: mark ${i % 6} ;`).join(' ');
    const flips = [...compileScript(`define main { choose { ${cases} } }`).asm.matchAll(/flipzero (\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(flips, Array.from({ length: k - 1 }, (_, i) => k - i), `k = ${k}`);
  }
  const prog = compileScript('define main { choose { case: mark 0 ; case: mark 1 ; case: mark 2 ; } loop { drop ; } }').program;
  const sim = createSim({ map: generateWorld(1), programs: [prog, prog], seed: 1 });
  sim.run(12);
  const N = sim.marks.length / 2, count = [0, 0, 0];
  for (let i = 0; i < sim.ants; i++) {
    const a = sim.ant(i);
    if (a.col !== 0) continue;
    const bits = sim.marks[a.pos], picked = [0, 1, 2].filter((k) => (bits >> k) & 1);
    assert.equal(picked.length, 1, 'every ant picks exactly one case');
    count[picked[0]]++;
  }
  const n = count[0] + count[1] + count[2];
  assert.ok(n > 80 && N > 0);
  for (const c of count) assert.ok(Math.abs(c - n / 3) <= 11, `${count} of ${n}`);
});

test('macros: block parameters, nesting, shadowing, and exit inside a block leaves the loop the block was written in', () => {
  assert.deepEqual(dirs('define twice b = { b b } define main { twice { turn left ; } }', 3), [5, 4, 3]);
  assert.deepEqual(dirs('define twice b = { b b } define a b = { twice { b } } define main { a { turn left ; } }', 3), [5, 4, 3]);
  assert.equal(dirs('define b { turn right ; } define f b = { b } define main { f { turn left ; } }', 1)[0], 5, 'a parameter hides a macro of the same name');
  assert.deepEqual(dirs('define main { turn left ; turn left ; }', 2), [5, 4], 'the last define is the program without a "main"');
  assert.deepEqual(dirs('define main { turn right ; } define other { turn left ; }', 1), [1], 'and "main" wins when there is one');
  const ex = 'define each b = { b } define main { loop { each { turn left ; exit ; } } mark 3 ; }';
  assert.deepEqual([run(ex, 1).ant(0).dir, marker(run(ex, 1), 3), marker(run(ex, 2), 3)], [5, 0, 1]);
  assert.deepEqual(dirs('define pair x y = { x y } define main { pair { turn left ; } { turn right ; } }', 2), [5, 0]);
});

test('the starter ant as a script behaves exactly like the flat starter: same positions, directions, food, rests, 16 states', () => {
  const script = compileScript(STARTER_SCRIPT);
  assert.equal(STARTER_SCRIPT, file('ants/starter.script'));
  assert.deepEqual(script.warnings, []);
  const flat = assemble(STARTER_ASM, CLASSIC);
  assert.equal(script.program.n, flat.n);
  for (const seed of [1, 2, 3, 4]) {
    const map = generateWorld(seed);
    const a = createSim({ map, programs: [flat, flat], seed }), b = createSim({ map, programs: [script.program, script.program], seed });
    for (let r = 1; r <= 500; r++) {
      a.step(); b.step();
      for (let i = 0; i < a.ants; i++) {
        const { pc: _x, ...p } = a.ant(i), { pc: _y, ...q } = b.ant(i);
        assert.deepEqual(q, p, `seed ${seed}, round ${r}, ant ${i}`);
      }
    }
    assert.deepEqual([...b.food], [...a.food]);
    assert.equal(b.draws, a.draws, 'the same random draws in the same order');
  }
});

test('errors: plain English, with the line number, for everything the grammar and the lowering rules forbid', () => {
  const cases: [string, RegExp][] = [
    ['define main { moev ; }', /^line 1: unknown macro or instruction "moev".*did you mean "move"/],
    ['define a { b } define b { a } define main { a }', /calls itself \(a -> b -> a\)/],
    [`${Array.from({ length: 8 }, (_, i) => `define m${8 - i} { ${i ? `m${9 - i}` : 'turn left ;'} }`).join(' ')} define main { m1 }`, /nested more than 8 deep/],
    ['define f x = { x } define main { f }', /macro "f" takes 1 block, but 0 given/],
    ['define g { move ; } define main { g { move ; } }', /macro "g" takes 0 blocks, but 1 given; to run a block after it, put a ";"/],
    ['define main { home: move ; }', /"home" is a reserved word and cannot be a label/],
    ['define move { move ; }', /"move" is a reserved word and cannot be a macro name/],
    ['define main { mark 1 }', /^line 1: expected ";" after "mark 1", found "\}"/],
    ['define main { loop {', /never closed/],
    ['define main { exit ; }', /"exit" leaves the loop around it, but there is no loop here/],
    ['define leave { exit ; } define main { loop { leave } }', /no loop here/],
    ['define wrap b = { loop { b } } define main { wrap { exit ; } }', /no loop here/],
    ['define main { goto nowhere ; }', /no label "nowhere" here/],
    ['define main { a: move ; a: move ; }', /label "a" is defined twice in this scope/],
    ['define a { move ; } define a { move ; }', /macro "a" is defined twice/],
    ['define main { mark 6 ; }', /a marker must be a number from 0 to 5/],
    ['define main { flip 0 ; }', /flip must be a number from 1 to 16384/],
    [`define main { choose { ${'case: move ; '.repeat(65)} } }`, /at most 64/],
    ['define main { choose { } }', /"choose" needs at least one "case:"/],
    ['define main { choose { case: move ; ; } }', /unexpected ";" in a choose/],
    ['define main { repeat 1001 move ; }', /repeat must be a number from 0 to 1000/],
    ['define main { repeat 2 { a: move ; } }', /label "a" is inside "repeat"/],
    ['define main { loop ; }', /^line 1: this can go round forever without acting/],
    ['define main { repeat 1000 { repeat 3 mark 0 ; } }', /the program is too big: more than 2000 flat instructions/],
    ['define unused { moev ; } define main { move ; }', /unknown macro or instruction "moev"/],
    ['define main x = { x }', /takes blocks; give it none/],
    ['define main { direction 1 then turn left ; }', /^line 1: direction is not in this ruleset/],
    ['define main { @ }', /^line 1: unexpected character "@"/],
    ['// nothing here\n', /at least one "define"/],
    ['move ;', /expected "define" at the top level/],
    ['define main {\n  move ;\n  mark 9 ;\n}', /^line 3: /],
    ['define twice b = { b b } define main { twice { a: move ; } }', /label "a" would exist twice/],
    ['define f x = { x { move ; } } define main { f { move ; } }', /"x" is a block given to this macro; it takes no blocks itself/],
    ['define main { sense ahead banana then move ; }', /expected a condition/],
    ['define main { turn up ; }', /expected left or right after "turn"/],
    ['define main { 7 }', /expected an instruction, found the number 7/],
    ['define main { move else }', /expected an instruction/],
    ['define main { /* open', /never closed/],
    ['define main { mark 1x ; }', /"1x" is not a number/],
  ];
  for (const [src, re] of cases) assert.match(err(src), re, src);
});

test('warnings: unused macro, empty sense, code after a loop with no exit, rough flips, food and marker bookkeeping', () => {
  const w = (src: string): string[] => compileScript(src).warnings;
  assert.ok(w('define spare { move ; } define main { pickup ; drop ; }').includes('line 1: macro "spare" is never used'));
  assert.ok(w('define main { sense ahead food ; pickup ; drop ; }').some((x) => /^line 1: this has no "then" and no "else"/.test(x)));
  assert.ok(w('define main { loop { move ; } drop ; }').some((x) => /^line 1: this can never run: the loop above has no "exit"/.test(x)));
  assert.ok(!w('define main { loop { move ; exit ; } drop ; }').some((x) => /never run/.test(x)));
  assert.ok(!w('define main { loop { move ; } a: drop ; goto a ; }').some((x) => /never run/.test(x)), 'a label after the loop may be reached by a goto');
  assert.ok(w('define main { flip 100 then move ; }').some((x) => /flip 100: the chance is only about 1 in 100/.test(x)));
  assert.ok(!w('define main { flip 64 then move ; }').some((x) => /flip 64/.test(x)));
  assert.deepEqual(w('define main { move ; }'), ['this program never picks up food', 'this program never drops food, so nothing is ever delivered']);
  const m = w('define main { pickup ; drop ; sense here marker 2 then mark 3 ; }');
  assert.ok(m.includes('marker 3 is written but nothing ever reads it') && m.includes('marker 2 is read but nothing ever writes it'));
  assert.ok(w('define main { pickup ; drop ; }').length === 0);
  for (const x of w('define spare { move ; } define main { sense ahead food ; }')) assert.ok(lineOfMessage(x) !== null || !/^line/.test(x));
});

test('sense conditions and directions: every spelling of the grammar, multi-word forms included', () => {
  const asm = (c: string): string => compileScript(`define main { sense ${c} then move ; }`).asm.split('\n').find((l) => l.includes('sense'))?.trim() ?? '';
  assert.match(asm('here friend'), /^sense here friend else/);
  assert.match(asm('left ahead foe'), /^sense leftahead foe else/);
  assert.match(asm('leftahead foe'), /^sense leftahead foe else/);
  assert.match(asm('right ahead friend with food'), /^sense rightahead friendwithfood else/);
  assert.match(asm('ahead foe with food'), /^sense ahead foewithfood else/);
  assert.match(asm('ahead foe marker'), /^sense ahead foemarker else/);
  assert.match(asm('here foe home'), /^sense here foehome else/);
  assert.match(asm('ahead home'), /^sense ahead home else/);
  assert.match(asm('ahead rock'), /^sense ahead rock else/);
  assert.match(asm('here marker 5'), /^sense here marker 5 else/);
  assert.match(asm('AHEAD Food'), /^sense ahead food else/, 'case does not matter');
});

test('extended senses lower under Tinyminds only; a define may omit its braces when the body is one keyword instruction', () => {
  const run2 = (src: string, rounds: number): ReturnType<typeof createSim> => {
    const sim = createSim({ map: MAP, programs: [compileScript(src, RULESETS.tinyminds).program], rules: RULESETS.tinyminds });
    sim.run(rounds);
    return sim;
  };
  const d = 'define main { direction 0 then mark 1 ; else mark 2 ; }'; // the ant starts facing 0
  assert.deepEqual([marker(run2(d, 2), 1), marker(run2(d, 2), 2)], [1, 0]);
  const d1 = 'define main { direction 1 then mark 1 ; else mark 2 ; }';
  assert.deepEqual([marker(run2(d1, 2), 1), marker(run2(d1, 2), 2)], [0, 1]);
  const p = 'define main { payload 0 then mark 3 ; else mark 4 ; }'; // carrying nothing
  assert.deepEqual([marker(run2(p, 2), 3), marker(run2(p, 2), 4)], [1, 0]);
  assert.match(err('define main { payload 2 then mark 3 ; }'), /^line 1: payload is not in this ruleset/);
  assert.match(err('define main { direction 6 then mark 3 ; }', RULESETS.tinyminds), /direction must be a number from 0 to 5/);
  assert.deepEqual(dirs('define spin loop turn left ;', 3), [5, 4, 3], 'define NAME INSTR (no params, no braces)');
  assert.deepEqual(dirs('define spin = turn left ; define main { spin spin }', 2), [5, 4], '"define NAME = INSTR" also parses');
});

test('then/else shapes: dangling else binds to the nearest then; a bare ";" falls through on both paths', () => {
  // else binds to the inner sense: when the outer test fails nothing happens
  const nested = 'define main { sense here friend then sense here foe then mark 1 ; else mark 2 ; }';
  assert.deepEqual([marker(run(nested, 3), 2), marker(run(nested, 3), 1)], [1, 0], 'inner else taken (foe is false): outer sense, inner sense, mark');
  const both = 'define main { sense here foe ; mark 4 ; }'; // empty continuation: one round for the sense, whatever it finds
  assert.deepEqual([marker(run(both, 1), 4), marker(run(both, 2), 4)], [0, 1]);
  const onlyElse = 'define main { sense here friend else mark 5 ; mark 0 ; }'; // friend is true: skips the else
  assert.deepEqual([marker(run(onlyElse, 2), 5), marker(run(onlyElse, 2), 0)], [0, 1]);
  const failMove = 'define main { move else turn left ; mark 0 ; }'; // the move succeeds on a free cell: no turn
  assert.deepEqual([run(failMove, 1).ant(0).pos, run(failMove, 2).ant(0).dir], [8, 0]);
});

const hasPython = spawnSync('python3', ['--version']).status === 0;
const oracle = fileURLToPath(new URL('../oracle/ref.py', import.meta.url));

test('Python oracle agrees on lowered scripts and rules, run from their official .ant text (so toIcfp is checked too)', { skip: !hasPython && 'python3 not found' }, () => {
  const RICH = `
define turnabout { repeat 3 turn left ; }
define wander { choose { case: turn left ; case: turn right ; case: ; case: move else { turnabout } } }
define fight { sense ahead foe then { move ; } else sense leftahead foe then turn left ; else sense rightahead foe then turn right ; }
define main {
  loop {
    sense here home
      then { sense here friend with food then { drop ; unmark 2 ; } else mark 2 ; }
      else {
        sense ahead food
          then { move ; pickup ; sense ahead home then { move ; drop ; } else turnabout ; }
          else {
            flip 5 then fight else sense ahead foe marker then { mark 1 ; wander ; } else wander ;
            sense here marker 1 then unmark 1 ;
          }
      }
  }
}`;
  const dir = mkdtempSync(join(tmpdir(), 'script-'));
  try {
    for (const [seed, rounds] of [[3, 1500], [11, 1500], [29, 3000]]) {
      const world = generateWorld(seed);
      const brains = [compileScript(RICH).program, seed % 2 ? compileRules(TRAIL_RULES).program : compileScript(STARTER_SCRIPT).program];
      const mapFile = join(dir, 'm.world');
      writeFileSync(mapFile, formatMap(world));
      const files = brains.map((p, k) => { const f = join(dir, `p${k}.ant`); writeFileSync(f, toIcfp(p)); return f; });
      const py = spawnSync('python3', [oracle, '--map', mapFile, ...files.flatMap((f) => ['--ant', f]), '--rounds', String(rounds), '--seed', String(seed), '--every', '500'], { encoding: 'utf8' });
      assert.equal(py.status, 0, py.stderr);
      const sim = createSim({ map: world, programs: brains.map((_, k) => parseIcfp(readFileSync(files[k], 'utf8'), CLASSIC)), seed });
      const direct = createSim({ map: world, programs: brains, seed });
      for (const line of py.stdout.trim().split('\n')) {
        const e = JSON.parse(line) as { round: number; hash: number };
        sim.run(e.round - sim.cycle); direct.run(e.round - direct.cycle);
        assert.equal(sim.hash(), e.hash, `seed ${seed} round ${e.round}: oracle against the .ant text`);
        assert.equal(direct.hash() === sim.hash(), true, `seed ${seed} round ${e.round}: the .ant round trip does not change the program`);
      }
      assert.notEqual(direct.hash(), createSim({ map: world, programs: brains, seed }).hash(), 'the match did something');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('toIcfp is the inverse of parseIcfp: the task text, hand-written .ant, compiled rules and scripts', () => {
  const strip = (t: string): string => t.split('\n').map((l) => l.replace(/;.*$/, '').trim()).filter(Boolean).join('\n');
  assert.equal(toIcfp(parseIcfp(STARTER, CLASSIC)).trim(), strip(STARTER), 'byte for byte (comments aside) on the official example');
  for (const P of [compileRules(TRAIL_RULES).program, compileScript(STARTER_SCRIPT).program, assemble(STARTER_ASM, CLASSIC)]) {
    const Q = parseIcfp(toIcfp(P), CLASSIC);
    assert.equal(Q.n, P.n);
    for (const k of ['op', 'a', 'b', 't', 'e'] as const) assert.deepEqual([...Q[k]], [...P[k]], k);
  }
  assert.throws(() => toIcfp(assemble('senseany ahead food rock else x\n move\nx: drop\n goto x', CLASSIC)), /no \.ant form|not in this ruleset/);
});

test('the workshop: describeBrain, whereIs and the trace name script lines', () => {
  const info = describeBrain(STARTER_SCRIPT);
  assert.ok(info.ok && info.kind === 'script' && info.script);
  assert.match(info.summary, /^script: 2 macros, starts at "main", \d+ instructions of 2000, 16 states$/);
  const lines = STARTER_SCRIPT.split('\n'), at = (s: string): number => lines.findIndex((l) => l.includes(s)) + 1;
  const w0 = whereIs(info, 0);
  assert.equal(w0.line, at('top: sense ahead food'));
  assert.match(w0.label, /^line \d+: top: sense ahead food$/, 'comments are cut from the label');
  const flip = Array.from(info.program.op).indexOf(OP.FLIP);
  assert.equal(whereIs(info, flip).line, at('w: choose'));
  assert.equal(scriptLineAt(info.script, flip), at('w: choose'));
  assert.deepEqual(traceRows(info, [10, 0, 11, 0, 12, flip], 5).map((r) => [r.count, r.line]), [[1, at('w: choose')], [2, at('top: sense ahead food')]]);
  const bad = describeBrain('define main {\n  mark 9 ;\n}');
  assert.ok(!bad.ok && bad.kind === 'script' && lineOfMessage(bad.error) === 2);
  assert.ok(loadAnyBrain(STARTER_SCRIPT).script);
  assert.equal(loadAnyBrain(STARTER_SCRIPT).compiled, undefined);
});

test('cli/rc.ts compiles a script: size line, warnings, --asm, --ant, and errors with exit 1', () => {
  const rc = (...args: string[]) => spawnSync(process.execPath, ['cli/rc.ts', ...args], { encoding: 'utf8' });
  const a = rc('ants/starter.script');
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /ants\/starter\.script: 2 macro\(s\), starts at "main" -> \d+ instructions of 2000, 16 states/);
  assert.equal(rc('ants/starter.script', '--ant').stdout, toIcfp(compileScript(STARTER_SCRIPT).program));
  assert.equal(rc('ants/starter.script', '--asm').stdout, compileScript(STARTER_SCRIPT).asm);
  assert.equal(rc('ants/trail.rules', '--ant').stdout, toIcfp(compileRules(TRAIL_RULES).program));
  const dir = mkdtempSync(join(tmpdir(), 'script-'));
  try {
    const f = join(dir, 'bad.script');
    writeFileSync(f, 'define main {\n  mark 9 ;\n}\n');
    const b = rc(f);
    assert.equal(b.status, 1);
    assert.match(b.stderr, /^line 2: a marker must be a number from 0 to 5/);
    assert.equal(rc('ants/starter.script', '--fire-counts').status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
