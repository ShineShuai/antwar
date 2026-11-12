import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, parseIcfp } from '../src/core/asm.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { parseMap } from '../src/core/map.ts';
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
