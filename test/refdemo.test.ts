import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/core/asm.ts';
import { parseMap } from '../src/core/map.ts';
import { ALTORDER, COLONIES, TINYMINDS } from '../src/core/rules.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { lcg, randIcfp } from '../testlib/random.ts';
import { desugar } from '../testlib/desugar.ts';
import { CHARGER, GREEDY } from '../testlib/programs.ts';
import { parseIcfp } from '../src/core/asm.ts';

// The executable demo inside reference.html (Simulator tab) is a third implementation of step().
// Its core is everything between `let MAP=` and `function draw`; it needs no DOM.
interface Flags { cap: number; df: boolean; sc: boolean; ao?: boolean; ext?: boolean }
interface Demo {
  MAP: string; PROG: string; parse(text: string): unknown[]; setup(prog: unknown[], flags?: Flags, map?: string): void; tick(): void;
  state(): { food: number[]; ants: [number, number, number, number, number][] };
}
function loadDemo(): Demo {
  const html = readFileSync(new URL('../reference.html', import.meta.url), 'utf8');
  const a = html.indexOf('let MAP=`'), b = html.indexOf('function draw');
  assert.ok(a > 0 && b > a, 'demo simulator not found in reference.html');
  const body = `${html.slice(a, b)}
    return { MAP, PROG, parse, setup: (p, f = { cap: 1, df: false, sc: false }, map) => { if (map) MAP = map; CAP = f.cap; DF = f.df; SC = f.sc; AO = !!f.ao; EXT = !!f.ext; prog = p; place(); }, tick,
      state: () => ({ food: [...food], ants: ants.map((o) => [o.alive ? 1 : 0, o.pos, o.dir, o.food, o.rest]) }) };`;
  return new Function('W', 'H', body)(10, 10) as Demo;
}

test('reference.html demo simulator and the core agree round by round (Classic, seed 99999, flat asm with gotos)', () => {
  const demo = loadDemo();
  demo.setup(demo.parse(demo.PROG));
  const P = assemble(demo.PROG, CLASSIC);
  const sim = createSim({ map: parseMap(`10\n10\n${demo.MAP}\n`), programs: [P, P], seed: 99999 });
  for (let round = 1; round <= 5000; round++) {
    demo.tick(); sim.step();
    const d = demo.state();
    assert.deepEqual(d.food, [...sim.food], `food, round ${round}`);
    d.ants.forEach(([alive, pos, dir, food, rest], i) => {
      const a = sim.ant(i);
      assert.equal(a.alive, alive === 1, `ant ${i} alive, round ${round}`);
      if (a.alive) assert.deepEqual([a.pos, a.dir, a.has, a.rest], [pos, dir, food, rest], `ant ${i}, round ${round}`);
    });
  }
});

test('reference.html demo assembler rejects goto cycles and reserved labels like the core', () => {
  const demo = loadDemo();
  assert.throws(() => demo.parse('a: goto b\nb: goto a'), /goto cycle/);
  assert.throws(() => demo.parse('move: drop\ngoto move'), /reserved word/);
  assert.doesNotThrow(() => demo.parse('home: drop\ngoto home'));
});

// The demo implements carry-two (CAP), dropfail (DF) and scare4 (SC) itself: a second implementation for the flags the Python
// oracle also checks. Random programs run in both, every round compared; each flag must change a good share of the matches.
// A program that uses direction and payload (the ext-sense flag), so that the config with it is not vacuous.
const EXTPROG = ['start: direction 0 else turnl', 'payload 0 else drop1', 'sense ahead food else mv', 'move else mv', 'pickup else mv', 'goto start',
  'turnl: turn left', 'goto start', 'drop1: sense ahead home else mv', 'move else mv', 'drop', 'goto start',
  'mv: flipzero 3 else mv2', 'turn right', 'goto start', 'mv2: move else mv', 'goto start'].join('\n');
const CONFIGS = [
  { name: 'cap 2', flags: { cap: 2, df: false, sc: false }, rules: { ...CLASSIC, cap: 2 } },
  { name: 'cap 2 + dropfail', flags: { cap: 2, df: true, sc: false }, rules: { ...CLASSIC, cap: 2, dropOnBlocked: true } },
  { name: 'scare4', flags: { cap: 1, df: false, sc: true }, rules: { ...CLASSIC, scareThreshold: 4 } },
  { name: 'cap 2 + dropfail + scare4', flags: { cap: 2, df: true, sc: true }, rules: { ...CLASSIC, cap: 2, dropOnBlocked: true, scareThreshold: 4 } },
  { name: 'altorder', flags: { cap: 1, df: false, sc: false, ao: true }, rules: ALTORDER },
  { name: 'Tinyminds (all flags, with direction and payload)', flags: { cap: 2, df: true, sc: true, ao: true, ext: true }, rules: TINYMINDS },
] as const satisfies readonly { name: string; flags: Flags; rules: typeof CLASSIC }[];
for (const cfg of CONFIGS) {
  test(`reference.html demo and the core agree round by round under ${cfg.name} on random programs`, () => {
    const demo = loadDemo(), map = parseMap(`10\n10\n${demo.MAP}\n`);
    let differs = 0;
    const PROGRAMS = 14, ROUNDS = 2500; // two hand-written programs that really use the flags, then random ones
    for (let k = 1; k <= PROGRAMS; k++) {
      const r = lcg(k * 3571 + cfg.name.length), ext = 'ext' in cfg.flags && cfg.flags.ext;
      const flat = k === 1 ? GREEDY : k === 2 ? CHARGER : k === 3 && ext ? EXTPROG : desugar(randIcfp(r, 6 + (r() % 20)), false);
      demo.setup(demo.parse(flat), cfg.flags);
      const P = assemble(flat, cfg.rules), P1 = flat === EXTPROG ? P : assemble(flat, CLASSIC); // (classic cannot run the ext program)
      const sim = createSim({ map, programs: [P, P], seed: 99999, rules: cfg.rules }), plain = createSim({ map, programs: [P1, P1], seed: 99999 });
      for (let round = 1; round <= ROUNDS; round++) {
        demo.tick(); sim.step();
        const d = demo.state();
        assert.deepEqual(d.food, [...sim.food], `${cfg.name}, program ${k}, food, round ${round}`);
        d.ants.forEach(([alive, pos, dir, food, rest], i) => {
          const a = sim.ant(i);
          assert.equal(a.alive, alive === 1, `program ${k}, ant ${i} alive, round ${round}`);
          if (a.alive) assert.deepEqual([a.pos, a.dir, a.has, a.rest], [pos, dir, food, rest], `program ${k}, ant ${i}, round ${round}`);
        });
      }
      plain.run(ROUNDS);
      if (plain.hash() !== sim.hash()) differs++;
    }
    assert.ok(differs >= 2, `${cfg.name} changed only ${differs} of ${PROGRAMS} programs: the check would be vacuous`); // GREEDY and CHARGER do
  });
}

// More than two colonies: the demo keeps one marker byte per colony and foemarker is any other colony's marker, like the core.
const THREE = ['# # # # # # # # # #', '# 9 9 . . . . 3 3 #', '# . # . c c c . . #', '# . # c c c c c . #', '# . . 5 c . . . . #', '# a a a . . 5 b b #',
  '# a a a . . . b b #', '# a a . . . . # b #', '# 3 3 . . 9 9 . . #', '# # # # # # # # # #'].join('\n');
// Marks its cell, turns away from cells another colony has marked, forages: both marker kinds and foemarker get used.
const MARKPROG = ['start: mark 0', 'sense here foemarker else lk', 'turn left', 'lk: sense ahead food else w', 'move else w', 'pickup else w', 'goto start',
  'w: flipzero 2 else w2', 'turn right', 'goto start', 'w2: move else start', 'goto start'].join('\n');
test('reference.html demo and the core agree round by round with three colonies (marks, foemarker, order of ids)', () => {
  const demo = loadDemo(), map = parseMap(`10\n10\n${THREE}\n`);
  const flags: Flags = { cap: 1, df: false, sc: false };
  let marked = 0;
  for (let k = 1; k <= 10; k++) {
    const r = lcg(k * 7919), flat = k === 1 ? GREEDY : k === 2 ? CHARGER : k >= 3 && k <= 5 ? MARKPROG.replace('mark 0', `mark ${k - 3}`) : desugar(randIcfp(r, 6 + (r() % 20)), false);
    demo.setup(demo.parse(flat), flags, THREE);
    const P = assemble(flat, COLONIES), sim = createSim({ map, programs: [P, P, P], seed: 99999, rules: COLONIES });
    assert.equal(demo.state().ants.length, sim.ants, 'ants of three colonies');
    for (let round = 1; round <= 1500; round++) {
      demo.tick(); sim.step();
      const d = demo.state();
      assert.deepEqual(d.food, [...sim.food], `three colonies, program ${k}, food, round ${round}`);
      d.ants.forEach(([alive, pos, dir, food, rest], i) => {
        const a = sim.ant(i);
        assert.equal(a.alive, alive === 1, `program ${k}, ant ${i} alive, round ${round}`);
        if (a.alive) assert.deepEqual([a.pos, a.dir, a.has, a.rest], [pos, dir, food, rest], `program ${k}, ant ${i}, round ${round}`);
      });
    }
    if (sim.marks.some((m) => m)) marked++;
  }
  assert.equal(marked, 3, 'the three marking programs leave marks');
  // foemarker is really used: the same program with that test replaced by one that is never true plays a different game
  const run = (src: string): number => { const P = assemble(src, COLONIES), q = createSim({ map, programs: [P, P, P], seed: 99999, rules: COLONIES }); q.run(1500); return q.hash(); };
  assert.notEqual(run(MARKPROG), run(MARKPROG.replace('sense here foemarker', 'sense here rock')), 'foemarker never fired: the check would be vacuous');
});

test('the Simulator tab\'s ruleset switch turns every flag on or off together (carry two, dropfail, scare4, direction/payload, altorder)', () => {
  const html = readFileSync(new URL('../reference.html', import.meta.url), 'utf8');
  assert.match(html, /const cl=\$\('sim-rules'\)\.value==='classic';CAP=cl\?1:2;DF=SC=EXT=AO=!cl;/);
  assert.match(html, /<option value="classic"[^>]*>Classic \(ICFP 2004\)<\/option><option value="tiny"[^>]*>Tinyminds rules<\/option>/);
});
