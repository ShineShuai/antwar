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

// ---- writing the world, and the library of maps
import { LIB_KEY, MAX_MAPS, deleteMap, readLibrary, saveMap } from '../web/maplib.ts';
import { writeProjectWorld } from '../web/project.ts';

const mem = (init: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};

test('writeProjectWorld: the world is saved, the rest of the project stays, bad worlds are refused', () => {
  const s = mem({ [PROJECT_KEY]: JSON.stringify({ seed: '5', a: 'A-text', more: ['C'], rules: 'altorder' }) });
  writeProjectWorld(s, { kind: 'custom', mapText: 'MAP' });
  const back = readProject(s);
  assert.deepEqual(back.world, { kind: 'custom', mapText: 'MAP' }); assert.equal(back.seed, 5); assert.equal(back.rules, 'altorder'); assert.deepEqual(back.texts, ['A-text', STARTER, 'C']);
  writeProjectWorld(s, { kind: '', mapText: '' }); assert.deepEqual(readProject(s).world, { kind: '', mapText: '' });
  assert.throws(() => writeProjectWorld(s, { kind: 'custom', mapText: '' }), RangeError, 'a custom map has a text');
  assert.throws(() => writeProjectWorld(s, { kind: '', mapText: 'x' }), RangeError, 'the contest generator has none');
  assert.throws(() => writeProjectWorld(s, { kind: 'weird', mapText: 'x' }), RangeError);
  assert.throws(() => writeProjectWorld(s, { kind: 'custom', mapText: 'x'.repeat((1 << 17) + 1) }), RangeError);
  const fresh = mem(); writeProjectWorld(fresh, { kind: 'custom', mapText: 'M' }); assert.deepEqual(readProject(fresh).world, { kind: 'custom', mapText: 'M' });
  const broken = mem({ [PROJECT_KEY]: '{oops' }); writeProjectWorld(broken, { kind: 'mirror', mapText: 'M' }); assert.equal(readProject(broken).world.kind, 'mirror');
});

test('the library: save, replace, delete, limits, damaged data', () => {
  const s = mem();
  assert.deepEqual(readLibrary(s), []);
  saveMap(s, ' first ', 'T1', 10); saveMap(s, 'second', 'T2', 20);
  assert.deepEqual(readLibrary(s).map((m) => [m.name, m.text, m.savedAt]), [['first', 'T1', 10], ['second', 'T2', 20]]);
  saveMap(s, 'first', 'T1b', 30);
  assert.deepEqual(readLibrary(s).map((m) => [m.name, m.text]), [['second', 'T2'], ['first', 'T1b']], 'the same name is replaced and moves to the end');
  assert.deepEqual(deleteMap(s, 'second').map((m) => m.name), ['first']); assert.deepEqual(deleteMap(s, 'nope').map((m) => m.name), ['first']);
  assert.throws(() => saveMap(s, '  ', 'T'), RangeError); assert.throws(() => saveMap(s, 'x'.repeat(41), 'T'), RangeError);
  assert.throws(() => saveMap(s, 'big', 'x'.repeat((1 << 17) + 1)), RangeError);
  const full = mem(); for (let k = 0; k < MAX_MAPS; k++) saveMap(full, `m${k}`, 't');
  assert.throws(() => saveMap(full, 'one more', 't'), /holds 50/); assert.doesNotThrow(() => saveMap(full, 'm3', 'replaced'), 'replacing is allowed when full');
  const heavy = mem(); for (let k = 0; k < 24; k++) saveMap(heavy, `h${k}`, 'x'.repeat(1 << 17));
  assert.throws(() => saveMap(heavy, 'h99', 'x'.repeat(1 << 17)), /full/);
  for (const bad of ['{oops', 'null', '{"a":1}', '[1,"x",{"name":"n"},{"name":"","text":"t","savedAt":1},{"name":"ok","text":"t","savedAt":2},{"name":"ok","text":"dup","savedAt":3}]'])
    assert.ok(readLibrary(mem({ [LIB_KEY]: bad })).every((m) => m.name === 'ok'), bad);
  assert.deepEqual(readLibrary(mem({ [LIB_KEY]: '[{"name":"ok","text":"t","savedAt":2},{"name":"ok","text":"dup","savedAt":3}]' })).map((m) => m.text), ['t'], 'the first of a duplicated name');
});
