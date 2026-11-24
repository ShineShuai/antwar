// The project the pages share (web/project.ts): the workshop's saved state, read defensively, and the words about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, personality } from '../src/lang/templates.ts';
import { STARTER } from '../web/default-ant.ts';
import { PROJECT_KEY, brainSummary, readProject, worldLabel } from '../web/project.ts';

const store = (value: unknown): Pick<Storage, 'getItem'> => ({ getItem: (k) => (k === PROJECT_KEY && value !== undefined ? (typeof value === 'string' ? value : JSON.stringify(value)) : null) });

test('readProject: defaults when nothing or garbage is saved', () => {
  for (const s of [store(undefined), store('{not json'), store('null'), store('[1,2]'), store('"x"'), undefined]) {
    const p = readProject(s as Pick<Storage, 'getItem'>);
    assert.deepEqual(p.texts, [STARTER, STARTER]); assert.deepEqual(p.names, ['A', 'B']);
    assert.equal(p.seed, 12345); assert.equal(p.rules, 'classic'); assert.deepEqual(p.world, { kind: '', mapText: '' });
  }
});

test('readProject: what the workshop saves comes back; the old `colonies` Rules is Classic', () => {
  const p = readProject(store({ seed: '77', a: 'A-text', b: 'B-text', more: ['C-text', 5, 'D-text'], rules: 'colonies', world: { kind: 'fair3', text: 'MAP' } }));
  assert.deepEqual(p.texts, ['A-text', 'B-text', 'C-text', 'D-text']); assert.deepEqual(p.names, ['A', 'B', 'C', 'D']);
  assert.equal(p.seed, 77); assert.equal(p.rules, 'classic'); assert.deepEqual(p.world, { kind: 'fair3', mapText: 'MAP' });
  assert.equal(readProject(store({ rules: 'altorder' })).rules, 'altorder');
  assert.equal(readProject(store({ rules: 'nope' })).rules, 'classic');
});

test('readProject: bad seeds, kinds and sizes fall back; at most 26 brains', () => {
  assert.equal(readProject(store({ seed: '' })).seed, 12345); assert.equal(readProject(store({ seed: 'abc' })).seed, 12345); assert.equal(readProject(store({ seed: '1.5' })).seed, 12345);
  assert.equal(readProject(store({ seed: '0' })).seed, 0);
  for (const kind of ['bad', 'fair', 'fair3x', 'Mirror', 7, null]) assert.deepEqual(readProject(store({ world: { kind, text: 'MAP' } })).world, { kind: '', mapText: '' }, String(kind));
  assert.deepEqual(readProject(store({ world: { kind: 'custom', text: 'x'.repeat((1 << 17) + 1) } })).world, { kind: '', mapText: '' }, 'a map over 128 KiB');
  assert.deepEqual(readProject(store({ world: { kind: '4', text: 'MAP' } })).world, { kind: '4', mapText: 'MAP' });
  assert.equal(readProject(store({ more: Array.from({ length: 40 }, (_, i) => `t${i}`) })).texts.length, 26);
});

test('brainSummary and worldLabel', () => {
  assert.equal(brainSummary(personality(DEFAULTS.keeper)), 'Keeper: curiosity focused, boldness indifferent, sociability follower, settling sometimes');
  assert.equal(brainSummary(personality({ ...DEFAULTS.keeper, settling: 3 })), 'Keeper: curiosity focused, boldness indifferent, sociability follower, settling often');
  assert.equal(brainSummary(personality(DEFAULTS.guard)), 'Guard: curiosity focused, boldness indifferent', 'no sociability for a guard');
  assert.match(brainSummary(personality(DEFAULTS.forager)), /^[^:]+: curiosity \w+, boldness \w+$/);
  assert.equal(brainSummary('\n\n  Sense Ahead 1 3 Food ; x\nMove'), 'hand-written: Sense Ahead 1 3 Food ; x');
  assert.equal(brainSummary(''), 'hand-written: (empty)');
  const p = readProject(store({ seed: '5' }));
  assert.equal(worldLabel(p), 'the contest world of seed 5');
  assert.equal(worldLabel({ ...p, world: { kind: 'mirror', mapText: 'm' } }), 'a mirrored world (seed 5)');
  assert.equal(worldLabel({ ...p, world: { kind: 'fair6', mapText: 'm' } }), 'a fair world for 6 colonies (seed 5)');
  assert.equal(worldLabel({ ...p, world: { kind: 'custom', mapText: 'm' } }), 'a custom map (a file or a link)');
  assert.equal(worldLabel({ ...p, world: { kind: '4', mapText: 'm' } }), 'a ring example with 4 colonies');
});
