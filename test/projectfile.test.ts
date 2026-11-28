// The project file (web/projectfile.ts) and merging a file's version histories into the saved ones (web/versions.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FILE, MAX_MAP, MAX_SEED, ProjectFileError, buildProjectFile, formatProjectFile, parseProjectFile } from '../web/projectfile.ts';
import type { ProjectFile, ProjectState } from '../web/projectfile.ts';
import { MAX_TEXT, MAX_VERSIONS, mergeVersions, readAllVersions, snapshot } from '../web/versions.ts';

const mem = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const state = (o: Partial<ProjectState> = {}): ProjectState => ({ brains: ['mood a\n  x\n', 'b brain'], seed: '77', rules: 'altorder', worldKind: 'mirror', mapText: '4\n4\nmap', versions: { A: [{ t: 5, text: 'old a', label: 'run' }] }, generator: 2, ...o });
const fails = (text: string, re: RegExp): void => assert.throws(() => parseProjectFile(text), (e) => e instanceof ProjectFileError && re.test(e.message), `${text.slice(0, 60)} should fail with ${re}`);
const withField = (f: ProjectFile, k: string, v: unknown): string => JSON.stringify({ ...f, [k]: v });

test('build, format, parse: the project comes back as it went', () => {
  const f = buildProjectFile(state()), text = formatProjectFile(f);
  assert.deepEqual(f, { format: 'antwar-project', version: 1, seed: 77, rules: 'altorder', brains: ['mood a\n  x\n', 'b brain'], world: { kind: 'mirror', map: '4\n4\nmap' }, versions: { A: [{ t: 5, text: 'old a', label: 'run' }] } });
  assert.ok(text.endsWith('}\n') && text.includes('\n  "seed": 77'), 'readable JSON');
  assert.deepEqual(parseProjectFile(text), f);
  assert.equal(formatProjectFile(parseProjectFile(text)), text, 'a second round trip changes nothing');
});

test('build: the contest generator has no map but names its generator; the old Rules name is canonical; the seed is checked', () => {
  const f = buildProjectFile(state({ worldKind: '', mapText: '', rules: 'colonies' }));
  assert.equal(f.generator, 2); assert.equal(f.rules, 'classic'); assert.deepEqual(f.world, { kind: '', map: '' });
  assert.equal(buildProjectFile(state()).generator, undefined, 'a stored map needs no generator');
  for (const seed of ['', ' ', '-1', '1.5', 'x', String(MAX_SEED + 1)]) assert.throws(() => buildProjectFile(state({ seed })), /seed must be a whole number/, seed);
  assert.equal(buildProjectFile(state({ seed: String(MAX_SEED) })).seed, MAX_SEED);
  assert.throws(() => buildProjectFile(state({ worldKind: 'mirror', mapText: '' })), /needs its map text/);
});

test('parse: what is not a project file is refused, and says why', () => {
  const ok = buildProjectFile(state());
  fails('not json', /not JSON/); fails('[]', /not a project file/); fails('null', /not a project file/); fails('{}', /not an antwar project file/);
  fails(withField(ok, 'format', 'other'), /not an antwar project file/);
  fails(withField(ok, 'version', 2), /newer version of antwar/); fails(withField(ok, 'version', 0), /unknown project file version/);
  fails(withField(ok, 'seed', 1.5), /seed: a whole number/); fails(withField(ok, 'seed', '5'), /seed/); fails(withField(ok, 'seed', MAX_SEED + 1), /seed/); fails(withField(ok, 'seed', -1), /seed/);
  fails(withField(ok, 'rules', 'nope'), /rules: one of classic/); fails(withField(ok, 'rules', undefined), /rules/);
  fails(withField(ok, 'brains', ['one']), /brains: 2 to 26 texts/); fails(withField(ok, 'brains', Array(27).fill('x')), /brains: 2 to 26/); fails(withField(ok, 'brains', 'ab'), /brains/);
  fails(withField(ok, 'brains', ['a', 3]), /brain 2 is not text/); fails(withField(ok, 'brains', ['a', 'x'.repeat(MAX_TEXT + 1)]), /brain 2 is over/);
  fails(withField(ok, 'world', null), /world: a kind and a map text/); fails(withField(ok, 'world', { kind: 'weird', map: 'x' }), /world: a kind/); fails(withField(ok, 'world', { kind: 'mirror' }), /world: a kind/);
  fails(withField(ok, 'world', { kind: 'mirror', map: '' }), /needs its map text/); fails(withField(ok, 'world', { kind: '', map: 'x' }), /contest generator has no map text/);
  fails(withField(ok, 'world', { kind: 'custom', map: 'x'.repeat(MAX_MAP + 1) }), /map is over/);
  fails(withField(ok, 'generator', 'two'), /generator: a whole number/);
  fails(' '.repeat(MAX_FILE + 1), /over 8 MiB/);
});

test('parse: unknown fields are ignored; every colony count and world kind of the picker is accepted; damaged versions are dropped, not fatal', () => {
  const ok = buildProjectFile(state());
  assert.deepEqual(parseProjectFile(JSON.stringify({ ...ok, extra: 1, app: 'x' })), ok);
  for (const kind of ['custom', 'mirror', 'fair3', 'fair26', '4', '8']) assert.equal(parseProjectFile(withField(ok, 'world', { kind, map: 'm' })).world.kind, kind);
  assert.equal(parseProjectFile(withField(ok, 'brains', Array(26).fill('b'))).brains.length, 26);
  const f = parseProjectFile(withField(ok, 'versions', { A: [{ t: 1, text: 'ok', label: 'x'.repeat(200) }, { t: 'x', text: 'bad', label: '' }, null], a: [{ t: 1, text: 't', label: '' }], B: 'no' }));
  assert.deepEqual(Object.keys(f.versions), ['A'], 'only slots A to Z that hold lists');
  assert.equal(f.versions.A.length, 1); assert.equal(f.versions.A[0].label.length, 60);
  assert.deepEqual(parseProjectFile(JSON.stringify({ ...ok, versions: undefined })).versions, {}, 'a file without history opens');
});

test('mergeVersions: adds what is new, not what is there, in time order, 30 a slot', () => {
  const m = mem(); snapshot(m, 'A', 'mine 1', 'x', 10); snapshot(m, 'A', 'mine 2', 'x', 30);
  const added = mergeVersions(m, { A: [{ t: 20, text: 'theirs', label: 'y' }, { t: 30, text: 'mine 2', label: 'dup' }], B: [{ t: 1, text: 'b only', label: '' }] });
  assert.equal(added, 2, 'the same time and text is not added twice');
  const all = readAllVersions(m);
  assert.deepEqual(all.A.map((v) => v.text), ['mine 1', 'theirs', 'mine 2'], 'time order'); assert.equal(all.A[2].label, 'x', 'the saved one stays');
  assert.deepEqual(all.B.map((v) => v.text), ['b only']);
  assert.equal(mergeVersions(m, { A: [{ t: 20, text: 'theirs', label: 'y' }] }), 0, 'merging again changes nothing');
  const many = Array.from({ length: 40 }, (_, i) => ({ t: 100 + i, text: `v${i}`, label: '' }));
  mergeVersions(m, { A: many });
  assert.equal(readAllVersions(m).A.length, MAX_VERSIONS); assert.equal(readAllVersions(m).A.at(-1)?.text, 'v39', 'the newest are kept');
  mergeVersions(m, { 'a': [{ t: 1, text: 'x', label: '' }], Z: 'junk' } as never); assert.deepEqual(Object.keys(readAllVersions(m)).sort(), ['A', 'B']);
});
