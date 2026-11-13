import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/core/asm.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';

// The executable demo inside reference.html (Simulator tab) is a third implementation of step().
// Its core is everything between `const MAP=` and `function draw`; it needs no DOM.
interface Demo {
  MAP: string; PROG: string; parse(text: string): unknown[]; setup(prog: unknown[]): void; tick(): void;
  state(): { food: number[]; ants: [number, number, number, number, number][] };
}
function loadDemo(): Demo {
  const html = readFileSync(new URL('../reference.html', import.meta.url), 'utf8');
  const a = html.indexOf('const MAP=`'), b = html.indexOf('function draw');
  assert.ok(a > 0 && b > a, 'demo simulator not found in reference.html');
  const body = `${html.slice(a, b)}
    return { MAP, PROG, parse, setup: (p) => { CAP = 1; DF = SC = EXT = false; prog = p; place(); }, tick,
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
