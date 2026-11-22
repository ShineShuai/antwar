import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcfp } from '../src/core/asm.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, RULESETS, RULESET_NAMES, TINYMINDS, canonicalRules, unsupported } from '../src/core/rules.ts';
import { createSim } from '../src/core/sim.ts';

const map = parseMap('6\n4\n. . . . . .\n. + . . . .\n. . . . . .\n. . . . . .\n');

test('the rules registry: Classic is the task, extras are named flags', () => {
  assert.deepEqual(CLASSIC, { cap: 1, ext: false, scareThreshold: 0, dropOnBlocked: false, altOrder: false });
  assert.deepEqual(RULESETS.tinyminds, TINYMINDS);
  assert.deepEqual(unsupported(CLASSIC), []);
  assert.deepEqual(unsupported(TINYMINDS), [], 'every flag is implemented');
  assert.deepEqual(TINYMINDS, { cap: 2, ext: true, scareThreshold: 4, dropOnBlocked: true, altOrder: true });
  for (const [id, r] of Object.entries(RULESETS)) assert.deepEqual(unsupported(r), [], id);
});

test('flag values the simulator cannot honour are rejected, never silently ignored', () => {
  const P = parseIcfp('Drop 0', CLASSIC);
  for (const [flag, rules] of [
    ['cap', { ...CLASSIC, cap: 3 }], ['cap', { ...CLASSIC, cap: 0 }],
    ['scareThreshold', { ...CLASSIC, scareThreshold: 5 }], ['scareThreshold', { ...CLASSIC, scareThreshold: -1 }],
  ] as const) {
    assert.deepEqual(unsupported(rules), [flag]);
    assert.throws(() => createSim({ map, programs: [P], rules }), new RegExp(`not implemented yet: ${flag}`));
  }
});

test('a scare threshold below 4 fires on exactly that many foes, and on no other number', () => {
  // the layout of the scare4 micro-test: the victim picks up at round 16, the last foe arrives at round 18 (3 or 4 foes in all)
  const chain = Array.from({ length: 17 }, (_, k) => `Drop ${k + 1}`).join('\n') + '\nMove 18 17\nDrop 18';
  const V = 'Move 1 0\nPickUp 2 1\nTurn Left 2';
  const w = (rows: string[]): ReturnType<typeof parseMap> => parseMap(`8\n6\n${rows.join('\n')}\n`);
  const four = w(['. . . . . . . .', '. . - . . # . .', '. . . + 2 - # .', '. . . - - # . .', '. . . . . . . .', '. . . . . . . .']);
  const three = w(['. . . . . . . .', '. . - . . # . .', '. . . + 2 - # .', '. . . . - # . .', '. . . . . . . .', '. . . . . . . .']);
  const carry = (map: ReturnType<typeof parseMap>, scareThreshold: number): number => {
    const rules = { ...CLASSIC, scareThreshold };
    const sim = createSim({ map, programs: [parseIcfp(V, rules), parseIcfp(chain, rules)], rules, wrap: false });
    sim.run(18);
    return sim.ant(1).alive ? sim.ant(1).has : -1; // food still carried (-1: dead)
  };
  assert.equal(carry(three, 3), 0, '3 foes, threshold 3: scared');
  assert.equal(carry(four, 3), 1, '4 foes, threshold 3: not scared');
  assert.equal(carry(three, 4), 1, '3 foes, threshold 4: not scared');
  assert.equal(carry(four, 4), 0, '4 foes, threshold 4: scared');
  assert.equal(carry(four, 0), 1, 'threshold 0 is off');
  assert.equal(carry(three, 0), 1);
});

test('the number of colonies is not a flag: the old `colonies` name is Classic, and is not offered in menus', () => {
  assert.deepEqual(RULESETS.colonies, CLASSIC);
  assert.equal(canonicalRules('colonies'), 'classic');
  for (const id of Object.keys(RULESETS)) if (id !== 'colonies') assert.equal(canonicalRules(id as keyof typeof RULESETS), id);
  assert.deepEqual(Object.keys(RULESET_NAMES).sort(), Object.keys(RULESETS).filter((id) => id !== 'colonies').sort());
  assert.ok(!('maxColonies' in CLASSIC) && !('maxColonies' in TINYMINDS));
});
