import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, parseIcfp } from '../src/core/asm.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { readFileSync } from 'node:fs';
import { parseMap } from '../src/core/map.ts';
import { STARTER_ASM } from '../web/default-ant.ts';
import { lcg, randIcfp, randMap } from '../testlib/random.ts';
import type { Program } from '../src/core/types.ts';

const same = (a: Program, b: Program): void => {
  for (const f of ['op', 'a', 'b', 't', 'e'] as const) assert.deepEqual([...a[f]], [...b[f]], f);
};

test('goto is a free edge: a flat program with gotos equals its explicit-successor form', () => {
  const asm = `top: sense ahead food else wander
    move else top
    pickup else top
    goto home
  wander: flipzero 3 else step
    turn left
    goto top
  step: move else top
    goto top
  home: drop
    goto top`;
  const ant = ['Sense Ahead 1 3 Food', 'Move 2 0', 'PickUp 6 0', 'Flip 3 4 5', 'Turn Left 0', 'Move 0 0', 'Drop 0'].join('\n');
  same(assemble(asm, CLASSIC), parseIcfp(ant, CLASSIC));
});

test('a program that starts with a goto begins at a copy of its target', () => {
  const P = assemble('goto start\nstart: drop\n goto start', CLASSIC);
  assert.equal(P.n, 2);
  assert.deepEqual([...P.t], [1, 1]);
});

test('a looping instruction followed by goto takes one round per pass, not two', () => {
  const map = parseMap('6\n4\n. . . . . .\n. + . . . .\n. . . . . .\n. . . . . .\n');
  const sim = createSim({ map, programs: [assemble('turn left\ngoto 0', CLASSIC)] });
  const dirs: number[] = [];
  for (let r = 1; r <= 7; r++) { sim.step(); dirs.push(sim.ant(0).dir); }
  assert.deepEqual(dirs, [5, 4, 3, 2, 1, 0, 5]); // one left turn per round
});

test('the starter ant in flat form (with gotos) plays exactly like its official form, which the Python oracle checks', () => {
  const official = readFileSync(new URL('./fixtures/starter.ant', import.meta.url), 'utf8');
  const map = parseMap(readFileSync(new URL('./fixtures/tiny.world', import.meta.url), 'utf8'));
  const hash = (P: Program): number => { const sim = createSim({ map, programs: [P, P] }); sim.run(10000); return sim.hash(); };
  assert.equal(hash(assemble(STARTER_ASM, CLASSIC)), hash(parseIcfp(official, CLASSIC)));
});

/** Official-syntax program -> flat assembly: one label per state, `goto` after every instruction (omitted when the
 * successor is the next line), optionally a leading goto. Behaviour must not change, because goto costs nothing. */
function desugar(ant: string, leadingGoto: boolean): string {
  const lines = ant.split('\n'), out = leadingGoto ? ['goto s0'] : [];
  lines.forEach((raw, i) => {
    const k = raw.toLowerCase().split(/\s+/), lab = (n: string): string => `s${n}`;
    let body: string, next: string | null = null, fail: string | null = null;
    switch (k[0]) {
      case 'sense': {
        const cond = k[4] === 'marker' ? `marker ${k[5]}` : k[4];
        body = `sense ${k[1]} ${cond}`; next = k[2]; fail = k[3]; break;
      }
      case 'mark': case 'unmark': body = `${k[0]} ${k[1]}`; next = k[2]; break;
      case 'pickup': case 'move': body = k[0]; next = k[1]; fail = k[2]; break;
      case 'drop': body = 'drop'; next = k[1]; break;
      case 'turn': body = `turn ${k[1]}`; next = k[2]; break;
      default: body = `flipzero ${k[1]}`; next = k[2]; fail = k[3]; // flip
    }
    out.push(`${lab(String(i))}: ${body}${fail === null ? '' : ` else ${lab(fail)}`}`);
    if (Number(next) !== i + 1 || i === lines.length - 1) out.push(`  goto ${lab(next)}`);
  });
  return out.join('\n');
}

/** Everything a brain can influence except the pc numbering (a leading goto shifts IR indices by one). */
const observe = (sim: ReturnType<typeof createSim>): string => {
  const ants = Array.from({ length: sim.ants }, (_, i) => { const { pc: _pc, ...rest } = sim.ant(i); return JSON.stringify(rest); });
  return [sim.draws, [...sim.food], [...sim.marks], ...ants].join('|');
};

test('fuzz: random official programs and their goto-laden flat forms behave identically', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = lcg(seed * 104729), map = randMap(r), n = 6 + (r() % 20);
    const a = randIcfp(r, n), b = randIcfp(r, n), leadA = seed % 2 === 0, leadB = seed % 3 === 0;
    const want = createSim({ map, programs: [parseIcfp(a, CLASSIC), parseIcfp(b, CLASSIC)], seed });
    const got = createSim({ map, programs: [assemble(desugar(a, leadA), CLASSIC), assemble(desugar(b, leadB), CLASSIC)], seed });
    for (let round = 1; round <= 1200; round++) {
      want.step(); got.step();
      if (round % 50 === 0) assert.equal(observe(got), observe(want), `seed ${seed}, round ${round}`);
    }
    // without a leading goto the IR is numbered like the official program, so even the pc-sensitive hash agrees
    if (!leadA && !leadB) assert.equal(got.hash(), want.hash(), `seed ${seed}: state hash`);
  }
});
