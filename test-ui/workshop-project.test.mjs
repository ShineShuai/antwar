// The workshop's project file: Export project and Import project.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEYS, load, openPage, sleep } from './host.mjs';

const VERSIONS = 'tinyminds.versions.v1';
const fixture = async () => {
  const t = await load('src/lang/templates.ts'), gen = await load('src/core/gen.ts'), map = await load('src/core/map.ts');
  const mapText = map.formatMap(gen.generateFairWorld(3, 9)), text = (x) => t.personality(t.DEFAULTS[x]);
  return {
    mapText, texts: [text('trail'), text('forager'), text('keeper')],
    project: { seed: '9', a: text('trail'), b: text('forager'), more: [text('keeper')], rules: 'altorder', world: { kind: 'fair3', text: mapText } },
    versions: { A: [{ t: 1000, text: 'an older A', label: 'first draft' }], C: [{ t: 2000, text: 'an older C', label: '' }] },
  };
};
const keep = async (opts, f) => { const p = await openPage('workshop', opts); try { await p.wait(() => /^Round 0/.test(p.$('status').textContent)); await f(p); } finally { p.close(); } };
/** Clicks Export and returns the file's text (jsdom makes no download: the Blob is caught). */
const exported = async (p) => {
  let blob; p.w.URL.createObjectURL = (b) => { blob = b; return 'blob:test'; }; p.w.URL.revokeObjectURL = () => {};
  p.$('export').click(); assert.ok(blob, 'a file was offered'); return blob.text();
};
const open = async (p, name, text) => {
  Object.defineProperty(p.$('projfile'), 'files', { value: [{ name, text: async () => text }], configurable: true });
  p.fire(p.$('projfile'), 'change'); await sleep(80);
};

test('Export project: the whole project in one file, the old histories included', async () => {
  const F = await fixture(), { parseProjectFile } = await load('web/projectfile.ts');
  await keep({ storage: { [KEYS.workshop]: F.project, [VERSIONS]: F.versions } }, async (p) => {
    const text = await exported(p), f = parseProjectFile(text);
    assert.deepEqual(f.brains, F.texts); assert.equal(f.seed, 9); assert.equal(f.rules, 'altorder');
    assert.deepEqual(f.world, { kind: 'fair3', map: F.mapText }); assert.equal(f.generator, undefined, 'a stored map names no generator');
    assert.deepEqual(f.versions.A[0], F.versions.A[0], 'the saved history comes along (the page adds its own run versions after it)'); assert.deepEqual(f.versions.C[0], F.versions.C[0]);
    const n = Object.values(f.versions).reduce((a, l) => a + l.length, 0);
    assert.equal(p.$('status').textContent, `Project exported: 3 brains and ${n} saved versions.`); assert.ok(!p.$('status').classList.contains('err'));
    assert.equal(p.$('export').closest('.row') !== null, true);
  });
});

test('Export project: the editors as they are now; the contest world names its generator', async () => {
  const { parseProjectFile } = await load('web/projectfile.ts'), gen = await load('src/core/gen.ts');
  await keep({}, async (p) => {
    p.set(p.$('ba'), 'typed just now', 'input'); p.set(p.$('seed'), '4242'); p.fire(p.$('seed'), 'change'); await sleep(40);
    const f = parseProjectFile(await exported(p));
    assert.equal(f.brains[0], 'typed just now'); assert.equal(f.seed, 4242); assert.deepEqual(f.world, { kind: '', map: '' }); assert.equal(f.generator, gen.GENERATOR_VERSION);
  });
});

test('Export project: says why it cannot (a seed that is not a number)', () => keep({}, async (p) => {
  p.$('seed').value = 'abc'; let offered = false; p.w.URL.createObjectURL = () => { offered = true; return ''; };
  p.$('export').click(); assert.equal(offered, false);
  assert.match(p.$('status').textContent, /^Cannot export: the seed must be a whole number/); assert.ok(p.$('status').classList.contains('err'));
}));

test('Import project: the editors, seed, Rules and map become the file\'s; the brains replaced are kept; histories are merged', async () => {
  const F = await fixture();
  let file;
  await keep({ storage: { [KEYS.workshop]: F.project, [VERSIONS]: F.versions } }, async (p) => { file = await exported(p); });
  await keep({}, async (p) => {
    p.set(p.$('ba'), 'my own brain A', 'input'); assert.equal(p.editors(), 2);
    await open(p, 'antwar-project.json', file);
    assert.equal(p.editors(), 3); assert.deepEqual([p.$('ba').value, p.$('bb').value, p.$('b2').value], F.texts);
    assert.deepEqual([p.$('seed').value, p.$('rules').value, p.$('exworld').value], ['9', 'altorder', 'fair3']);
    assert.match(p.$('status').textContent, /^Project opened: 3 brains, \d+ saved versions added\.$/); assert.ok(!p.$('status').classList.contains('err'));
    const init = p.sent('init').at(-1); assert.equal(init.mapText, F.mapText); assert.deepEqual([...init.brains], F.texts); // (an array of the page's realm: spread it) assert.equal(init.seed, 9); assert.equal(init.rules, 'altorder');
    const saved = p.stored(KEYS.workshop); assert.deepEqual([saved.a, saved.b, saved.more, saved.rules, saved.world.kind], [F.texts[0], F.texts[1], [F.texts[2]], 'altorder', 'fair3']);
    const v = p.stored(VERSIONS);
    assert.ok(v.A.some((x) => x.text === 'an older A' && x.label === 'first draft'), 'the file\'s history'); assert.ok(v.A.some((x) => x.text === 'my own brain A'), 'the brain replaced');
    assert.deepEqual(v.A.map((x) => x.t), [...v.A.map((x) => x.t)].sort((x, y) => x - y), 'in time order');
    assert.match(v.A.find((x) => x.text === 'my own brain A').label, /^before importing a project$/); assert.equal(v.C[0].text, 'an older C');
    assert.equal([...p.w.document.querySelectorAll('details.versions summary')][0].textContent, `Versions (${v.A.length})`, 'the panel shows them');
  });
});

test('Export then Import gives the same project again (the page the file came from and the page it opens in agree)', async () => {
  const F = await fixture(); let first, second;
  await keep({ storage: { [KEYS.workshop]: F.project } }, async (p) => { first = await exported(p); });
  await keep({}, async (p) => { await open(p, 'p.json', first); second = await exported(p); });
  const a = JSON.parse(first), b = JSON.parse(second);
  assert.deepEqual({ ...b, versions: 0 }, { ...a, versions: 0 });
});

test('Import project: a bad file is refused with the reason, and nothing changes', () => keep({}, async (p) => {
  p.set(p.$('ba'), 'untouched', 'input'); const before = p.$('seed').value;
  for (const [text, re] of [['not json', /not JSON/], ['{"format":"antwar-project","version":9}', /made by a newer version of antwar/], [JSON.stringify({ format: 'antwar-project', version: 1, seed: 1, rules: 'nope', brains: ['a', 'b'], world: { kind: '', map: '' } }), /rules: one of/]]) {
    await open(p, 'bad.json', text);
    assert.match(p.$('status').textContent, new RegExp(`^Cannot open bad\\.json: ${re.source}`)); assert.ok(p.$('status').classList.contains('err'));
    assert.equal(p.$('ba').value, 'untouched'); assert.equal(p.editors(), 2); assert.equal(p.$('seed').value, before);
  }
}));

test('Import project: a contest world made by another generator is flagged', async () => {
  const gen = await load('src/core/gen.ts'), t = await load('src/lang/templates.ts');
  await keep({}, async (p) => {
    const file = JSON.stringify({ format: 'antwar-project', version: 1, seed: 5, rules: 'classic', generator: gen.GENERATOR_VERSION + 1, brains: [t.personality(t.DEFAULTS.trail), t.personality(t.DEFAULTS.forager)], world: { kind: '', map: '' }, versions: {} });
    await open(p, 'old.json', file);
    assert.match(p.$('status').textContent, /Made with another world generator/); assert.ok(p.$('status').classList.contains('err'));
    assert.equal(p.$('seed').value, '5'); assert.equal(p.$('exworld').value, '');
  });
});
