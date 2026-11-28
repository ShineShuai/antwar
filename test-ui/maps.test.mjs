// The Maps page: strokes with symmetry, the live checks, generators, the library, import, the hand-off to the workshop.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { KEYS, load, openPage, sleep } from './host.mjs';

let p, $, w, viewer, mapedit, gen, map;
const checks = () => [...$('checks').querySelectorAll('div')].map((d) => `${d.className}: ${d.textContent}`);
const check = (re) => checks().find((c) => re.test(c));
const cellPx = (W, H, x, y) => viewer.center(viewer.layout(W, H, Math.max(3, Math.min(14, Math.floor(760 / (W + 1))))), x, y); // (clientWidth is 0 in jsdom: 760)
const pointer = (type, [x, y]) => $('board').dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true }));
const tool = (name) => [...$('toolrow').querySelectorAll('button')].find((b) => b.textContent === name).click();
const importFile = async (name, text) => {
  Object.defineProperty($('import'), 'files', { value: [{ name, text: async () => text }], configurable: true });
  p.fire($('import'), 'change'); await sleep(20);
};

before(async () => {
  viewer = await load('web/viewer.ts'); mapedit = await load('web/mapedit.ts'); gen = await load('src/core/gen.ts'); map = await load('src/core/map.ts');
  p = await openPage('maps', { storage: { [KEYS.workshop]: { seed: '5' } } }); ({ $, w } = p);
});
after(() => p.close());

test('starts from a mirrored world of the workshop seed, all checks fine', () => {
  const c = checks();
  assert.match(c[0], /^info: 100 x 100 cells/);
  assert.ok(c.some((x) => /^ok: 2 colonies \(hills A, B\)/.test(x)));
  assert.ok(c.some((x) => /^ok: point-mirror symmetric/.test(x)));
  assert.ok(c.every((x) => !/^bad/.test(x)));
});

test('strokes with the point mirror are drawn twice; the draft stays symmetric', () => {
  $('nW').value = '24'; $('nH').value = '20'; $('newdoc').click();
  assert.match(check(/hills|colonies/) ?? '', /^bad: no hills/);
  p.set($('symmode'), 'mirror');
  tool('Hill'); p.set($('radius'), '1'); let c = cellPx(24, 20, 5, 4); pointer('pointerdown', c); pointer('pointerup', c);
  tool('Rock'); p.set($('radius'), '0'); c = cellPx(24, 20, 10, 8); pointer('pointerdown', c); pointer('pointermove', cellPx(24, 20, 12, 8)); pointer('pointerup', cellPx(24, 20, 12, 8));
  tool('Food'); $('foodamt').value = '4'; c = cellPx(24, 20, 8, 10); pointer('pointerdown', c); pointer('pointerup', c);
  assert.ok(check(/^ok: 2 colonies \(hills A, B\)/) && check(/^ok: every hill has 7 cells/));
  assert.ok(check(/^ok: food 8; nearest to each hill: A 4, B 4/), 'a 4-food stroke is drawn twice');
  assert.ok(check(/^ok: point-mirror symmetric/));
  pointer('pointermove', cellPx(24, 20, 10, 8));
  assert.equal($('cursor').textContent, 'x 10, y 8: rock');
  const draft = map.parseMap(w.localStorage.getItem(KEYS.draft));
  assert.ok(gen.isSymmetric(draft));
  assert.deepEqual([...new Set(draft.hill)].sort(), [-1, 0, 1]);
});

test('undo and redo', () => {
  assert.equal($('undo').disabled, false);
  $('undo').click(); assert.ok(check(/^bad: no food/));
  $('redo').click(); assert.ok(check(/^ok: food 8/));
});

test('tiles for 3 colonies resize the map; a fair world for 4 sets the symmetry', async () => {
  p.set($('symmode'), 'shift'); p.set($('symn'), '3');
  assert.match($('symnote').textContent, /all 3 tiles of 50 x 50/);
  assert.equal($('msg').textContent, 'A new empty map of 3 tiles (50 x 150).');
  p.set($('genkind'), 'fair'); p.set($('genn'), '4'); $('seed').value = '3'; $('gen').click(); await sleep(20);
  assert.equal($('symmode').value, 'shift'); assert.equal($('symn').value, '4');
  assert.equal($('msg').textContent, 'Generated a fair world from seed 3.');
  assert.ok(check(/^ok: 4 colonies \(hills A, B, C, D\)/)); assert.ok(check(/^ok: same terrain for every colony/));
  assert.ok(check(/^info: the point mirror is for two colonies/));
});

test('generator errors are shown; the contest generator turns the symmetry off', () => {
  p.set($('genkind'), 'mirror'); $('gH').value = '99'; $('gen').click();
  assert.match($('msg').textContent, /even height/); assert.equal($('msg').className, 'note err');
  $('gH').value = '100';
  p.set($('genkind'), 'contest'); $('gen').click();
  assert.equal($('symmode').value, 'none'); assert.equal($('msg').textContent, 'Generated a contest world from seed 3.');
});

test('library: save, name check, load', () => {
  $('libname').value = 'my map'; $('libsave').click();
  assert.deepEqual([...$('lib').querySelectorAll('button')].map((b) => b.textContent), ['my map', '\u00d7']);
  $('libname').value = ''; $('libsave').click(); assert.equal($('msg').textContent, 'a name of 1 to 40 characters');
  $('newdoc').click(); assert.match(check(/hills|colonies/), /^bad: no hills/);
  [...$('lib').querySelectorAll('button')][0].click(); assert.match(check(/colonies/), /^ok: 2 colonies/);
});

test('rock border: added once, then reported', () => {
  $('newdoc').click(); $('border').click(); assert.equal($('msg').textContent, 'A rock border was added.');
  $('border').click(); assert.equal($('msg').textContent, 'The map has a rock border already.');
});

test('import: a .world file loads; nonsense is an error', async () => {
  await importFile('f.world', map.formatMap(gen.generateFairWorld(3, 2)));
  assert.equal($('msg').textContent, 'Imported f.world.'); assert.ok(check(/^ok: 3 colonies/));
  await importFile('bad.world', 'nonsense');
  assert.equal($('msg').className, 'note err');
});

test('"Play in the workshop" needs two hills and saves the map as the project world', async () => {
  $('newdoc').click(); $('play').click();
  assert.match($('msg').textContent, /at least two/);
  await importFile('f.world', map.formatMap(gen.generateFairWorld(3, 2)));
  const text = map.formatMap(gen.generateFairWorld(3, 2));
  $('play').click();
  const proj = p.stored(KEYS.workshop);
  assert.equal(proj.world.kind, 'custom'); assert.equal(proj.world.text, text); assert.equal(proj.seed, '5', 'the other saved fields stay');
});

test('canvas was drawn', () => assert.ok(w.__ops > 100));
