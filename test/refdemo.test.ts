import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/core/asm.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { lcg, randIcfp } from '../testlib/random.ts';
import { desugar } from '../testlib/desugar.ts';
import { CHARGER, GREEDY } from '../testlib/programs.ts';
import { parseIcfp } from '../src/core/asm.ts';

// The executable demo inside reference.html (Simulator tab) is a third implementation of step().
// Its core is everything between `const MAP=` and `function draw`; it needs no DOM.
interface Demo {
  MAP: string; PROG: string; parse(text: string): unknown[]; setup(prog: unknown[], flags?: { cap: number; df: boolean; sc: boolean }): void; tick(): void;
  state(): { food: number[]; ants: [number, number, number, number, number][] };
}
function loadDemo(): Demo {
  const html = readFileSync(new URL('../reference.html', import.meta.url), 'utf8');
  const a = html.indexOf('const MAP=`'), b = html.indexOf('function draw');
  assert.ok(a > 0 && b > a, 'demo simulator not found in reference.html');
  const body = `${html.slice(a, b)}
    return { MAP, PROG, parse, setup: (p, f = { cap: 1, df: false, sc: false }) => { CAP = f.cap; DF = f.df; SC = f.sc; EXT = false; prog = p; place(); }, tick,
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
const CONFIGS = [
  { name: 'cap 2', flags: { cap: 2, df: false, sc: false }, rules: { ...CLASSIC, cap: 2 } },
  { name: 'cap 2 + dropfail', flags: { cap: 2, df: true, sc: false }, rules: { ...CLASSIC, cap: 2, dropOnBlocked: true } },
  { name: 'scare4', flags: { cap: 1, df: false, sc: true }, rules: { ...CLASSIC, scareThreshold: 4 } },
  { name: 'cap 2 + dropfail + scare4', flags: { cap: 2, df: true, sc: true }, rules: { ...CLASSIC, cap: 2, dropOnBlocked: true, scareThreshold: 4 } },
] as const;
for (const cfg of CONFIGS) {
  test(`reference.html demo and the core agree round by round under ${cfg.name} on random programs`, () => {
    const demo = loadDemo(), map = parseMap(`10\n10\n${demo.MAP}\n`);
    let differs = 0;
    const PROGRAMS = 14, ROUNDS = 2500; // two hand-written programs that really use the flags, then random ones
    for (let k = 1; k <= PROGRAMS; k++) {
      const r = lcg(k * 3571 + cfg.name.length), flat = k === 1 ? GREEDY : k === 2 ? CHARGER : desugar(randIcfp(r, 6 + (r() % 20)), false);
      demo.setup(demo.parse(flat), cfg.flags);
      const P = assemble(flat, cfg.rules), P1 = assemble(flat, CLASSIC);
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
