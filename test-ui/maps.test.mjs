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

// ---- fairness for two colonies: the point mirror tools and the measured test
const fresh = async (f) => {
  const q = await openPage('maps', { storage: { [KEYS.workshop]: { seed: '5' } } });
  try { await f(q); } finally { q.close(); }
};
const strokeAt = (q, x, y) => { // a rock stroke on the 100 x 100 map
  const c = viewer.center(viewer.layout(100, 100, Math.max(3, Math.min(14, Math.floor(760 / 101)))), x, y), b = q.$('board');
  [...q.$('toolrow').querySelectorAll('button')].find((t) => t.textContent === 'Rock').click(); q.set(q.$('radius'), '0');
  for (const t of ['pointerdown', 'pointerup']) b.dispatchEvent(new q.w.MouseEvent(t, { clientX: c[0], clientY: c[1], button: 0, buttons: 1, bubbles: true }));
};
const checksOf = (q) => [...q.$('checks').querySelectorAll('div')].map((d) => `${d.className}: ${d.textContent}`);

test('a contest world is not point-symmetric: the check counts the cells, the mirror buttons fix it, undo brings it back', () => fresh(async (q) => {
  q.set(q.$('genkind'), 'contest'); q.$('seed').value = '3'; q.$('gen').click();
  const off = checksOf(q).find((c) => /point-mirror/.test(c)); assert.match(off, /^info: not point-mirror symmetric: \d+ of 10000 cells differ from their twin/);
  q.$('showasym').checked = true; q.fire(q.$('showasym'), 'change'); assert.match(q.$('msg').textContent, /^\d+ cells differ from their twin under the point mirror \(outlined\)\.$/);
  const ops = q.w.__ops; q.$('showasym').checked = false; q.fire(q.$('showasym'), 'change'); assert.ok(q.w.__ops > ops, 'the board is drawn again without the outlines');
  q.$('mirfirst').click(); assert.match(q.$('msg').textContent, /^Mirrored the top half: \d+ cells changed\.$/);
  assert.ok(checksOf(q).some((c) => /^ok: point-mirror symmetric/.test(c))); assert.ok(checksOf(q).some((c) => /^ok: every hill has \d+ cells/.test(c)));
  q.$('mirfirst').click(); assert.equal(q.$('msg').textContent, 'The map is point-symmetric already.');
  q.$('undo').click(); assert.ok(checksOf(q).some((c) => /not point-mirror symmetric/.test(c)));
  q.$('mirfirst').click(); assert.match(q.$('msg').textContent, /^Mirrored the top half/); assert.ok(checksOf(q).some((c) => /^ok: point-mirror symmetric/.test(c)));
  q.$('showasym').checked = true; q.fire(q.$('showasym'), 'change'); assert.equal(q.$('msg').textContent, 'The map is point-symmetric: nothing to mark.');
}));

test('a hand-drawn half: the half without a hill is refused, the half with it is mirrored into hill B', () => fresh(async (q) => {
  q.set(q.$('symmode'), 'none'); q.$('nW').value = '24'; q.$('nH').value = '20'; q.$('newdoc').click();
  const at = (x, y) => viewer.center(viewer.layout(24, 20, Math.max(3, Math.min(14, Math.floor(760 / 25)))), x, y);
  const stroke = (x, y) => { const c = at(x, y), ev = (t) => $q.dispatchEvent(new q.w.MouseEvent(t, { clientX: c[0], clientY: c[1], button: 0, buttons: 1, bubbles: true })); ev('pointerdown'); ev('pointerup'); };
  const $q = q.$('board'), tool = (name) => [...q.$('toolrow').querySelectorAll('button')].find((b) => b.textContent === name).click();
  tool('Hill'); q.set(q.$('radius'), '1'); stroke(5, 4); tool('Rock'); q.set(q.$('radius'), '0'); stroke(10, 6);
  assert.ok(checksOf(q).some((c) => /^bad: one hill/.test(c)));
  q.$('mirlast').click(); assert.equal(q.$('msg').className, 'note err'); assert.match(q.$('msg').textContent, /^the bottom half has no hill/);
  q.$('mirfirst').click(); assert.match(q.$('msg').textContent, /^Mirrored the top half: \d+ cells changed\.$/);
  assert.ok(checksOf(q).some((c) => /^ok: 2 colonies \(hills A, B\)/.test(c))); assert.ok(checksOf(q).some((c) => /^ok: every hill has 7 cells/.test(c))); assert.ok(checksOf(q).some((c) => /^ok: point-mirror symmetric/.test(c)));
}));

test('the mirror buttons refuse a map of three colonies', () => fresh(async (q) => {
  q.set(q.$('genkind'), 'fair'); q.set(q.$('genn'), '3'); q.$('gen').click();
  q.$('mirfirst').click(); assert.equal(q.$('msg').className, 'note err'); assert.match(q.$('msg').textContent, /two colonies/);
}));

test('Measure: the same brain in both colonies of the map; the result names the command; a change of the map drops it', () => fresh(async (q) => {
  const host = q.$('fair'), run = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Measure'), result = host.querySelectorAll('pre')[0];
  assert.deepEqual([...host.querySelector('select').options].map((o) => o.text), ['brain A', 'brain B']);
  const [games] = host.querySelectorAll('input'); games.value = '4'; [...host.querySelectorAll('select')][1].value = '10000';
  run.click(); assert.equal(run.disabled, true); await q.wait(() => !run.disabled, 60000);
  const lines = result.textContent.split('\n');
  assert.match(lines[0], /^brain A in every colony \| map W\.world \| 4 games of 10000 rounds \| rules classic$/);
  assert.ok(lines.some((l) => /^A\s+\d+(\.\d)?%/.test(l)) && lines.some((l) => /^B\s+\d+(\.\d)?%/.test(l)), 'a row per colony');
  assert.ok(lines.some((l) => /^nest food A - B per game: [+-]\d+\.\d \+-\d+\.\d \(95%\), z = -?\d+\.\d\d$/.test(l)));
  assert.ok(lines.some((l) => /^warning: under 10 expected wins per colony \(4 games, 2 colonies\)/.test(l)), 'too few games is said');
  assert.match(host.querySelectorAll('pre')[1].textContent, /\nnode cli\/fairness\.ts A\.brain --world W\.world --games 4 --from 1 --rounds 10000 --rules classic$/);
  assert.match(host.textContent, /4 games in [\d.]+ s/);
  strokeAt(q, 40, 40); assert.equal(result.textContent, '', 'the map changed: the old verdict goes');
  games.value = '1'; run.click(); assert.match(result.textContent, /^Games: a whole number from 2 to 1000\.$/);
}));

test('Measure: needs a playable map of two colonies; a stroke during a run cancels it', () => fresh(async (q) => {
  const host = q.$('fair'), run = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Measure'), result = host.querySelectorAll('pre')[0];
  q.$('newdoc').click(); run.click(); assert.match(result.textContent, /no hills: a match needs at least two/);
  q.set(q.$('genkind'), 'fair'); q.set(q.$('genn'), '3'); q.$('gen').click(); run.click();
  assert.equal(result.textContent, 'Fairness is measured for two colonies for now; this map has 3. The checks above say whether every colony has the same terrain.');
  q.set(q.$('genkind'), 'mirror'); q.$('gen').click(); const [games] = host.querySelectorAll('input'); games.value = '30'; [...host.querySelectorAll('select')][1].value = '100000';
  run.click(); assert.equal(run.disabled, true);
  strokeAt(q, 40, 40); assert.equal(run.disabled, false, 'the run was cancelled by the change'); assert.equal(result.textContent, '');
  await sleep(100); assert.equal(result.textContent, '', 'and no result arrives late');
}));
