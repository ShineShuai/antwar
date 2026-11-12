import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcfp } from '../src/core/asm.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, RULESETS, TINYMINDS, unsupported } from '../src/core/rules.ts';
import { createSim } from '../src/core/sim.ts';

const map = parseMap('6\n4\n. . . . . .\n. + . . . .\n. . . . . .\n. . . . . .\n');

test('the rules registry: Classic is the task, extras are named flags', () => {
  assert.deepEqual(CLASSIC, { cap: 1, ext: false, scareThreshold: 0, dropOnBlocked: false, maxColonies: 2, altOrder: false });
  assert.deepEqual(RULESETS.tinyminds, TINYMINDS);
  assert.deepEqual(unsupported(CLASSIC), []);
  assert.deepEqual(unsupported(TINYMINDS), [], 'carry two and extended sensing are implemented');
});

test('flags the simulator does not implement yet are rejected, never silently ignored', () => {
  const P = parseIcfp('Drop 0', CLASSIC);
  for (const [flag, rules] of [
    ['scareThreshold', { ...CLASSIC, scareThreshold: 4 }], ['dropOnBlocked', { ...CLASSIC, dropOnBlocked: true }],
    ['maxColonies', { ...CLASSIC, maxColonies: 3 }], ['altOrder', { ...CLASSIC, altOrder: true }],
  ] as const) {
    assert.deepEqual(unsupported(rules), [flag]);
    assert.throws(() => createSim({ map, programs: [P], rules }), new RegExp(`not implemented yet: ${flag}`));
  }
});
