// The workshop's world, brains and rules: the picker follows the map, brains survive colony changes, the Rules choice, the saved project, the chart.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEYS, load, openPage, sleep } from './host.mjs';

const keep = async (opts, f) => { const p = await openPage('workshop', opts); try { await f(p); } finally { p.close(); } };
const lastInit = (p) => p.sent('init').at(-1);

test('the old Rules choice "colonies" opens as classic; the menu lists the rulesets', () => keep({ storage: { [KEYS.workshop]: { rules: 'colonies' } } }, async (p) => {
  assert.equal(p.$('rules').value, 'classic');
  assert.deepEqual([...p.$('rules').options].map((o) => o.value), ['classic', 'tinyminds', 'cap2', 'dropfail', 'scare4', 'altorder']);
  assert.equal(p.editors(), 2);
}));

test('brains typed into C and D survive a trip through a 2-colony world', () => keep({ storage: { [KEYS.workshop]: { rules: 'colonies' } } }, async (p) => {
  await p.pick(p.$('exworld'), '4'); assert.equal(p.editors(), 4);
  p.set(p.$('b2'), 'C-BRAIN-TEXT', 'input'); p.set(p.$('b3'), 'D-BRAIN-TEXT', 'input');
  await p.pick(p.$('exworld'), 'mirror'); assert.equal(p.editors(), 2);
  assert.deepEqual(p.stored(KEYS.workshop).more, ['C-BRAIN-TEXT', 'D-BRAIN-TEXT'], 'saved while two colonies show');
  await p.pick(p.$('exworld'), '4');
  assert.equal(p.$('b2').value, 'C-BRAIN-TEXT'); assert.equal(p.$('b3').value, 'D-BRAIN-TEXT');
}));

test('the chosen Rules stay across colony counts and are saved', () => keep({}, async (p) => {
  await p.pick(p.$('rules'), 'altorder');
  await p.pick(p.$('exworld'), '3');
  assert.equal(p.$('rules').value, 'altorder'); assert.match(p.$('colnote').textContent, /^3 colonies, one brain each\. Ranking: more food ranks higher/);
  assert.equal(p.stored(KEYS.workshop).rules, 'altorder');
  await p.pick(p.$('exworld'), 'mirror'); assert.equal(p.$('rules').value, 'altorder'); assert.equal(p.$('colnote').textContent, '');
}));

test('the example-world picker follows the map', () => keep({ storage: { [KEYS.workshop]: { rules: 'colonies' } } }, async (p) => {
  const opts = [...p.$('exworld').options].map((o) => [o.value, o.hidden]);
  assert.deepEqual(opts.map((o) => o[0]), ['', '3', '4', '6', '8', 'mirror', 'fair2', 'fair3', 'fair4', 'fair6', 'fair8', 'custom']);
  assert.equal(opts.at(-1)[1], true, '"custom map" is only shown while a file or link is loaded');
  assert.equal(p.$('exworld').value, '');
  await p.pick(p.$('exworld'), 'fair3'); const map1 = lastInit(p).mapText;
  p.set(p.$('seed'), '777'); await sleep();
  assert.equal(p.$('exworld').value, 'fair3', 'a seed-driven generator stays picked'); assert.notEqual(lastInit(p).mapText, map1); assert.ok(lastInit(p).mapText.length > 0);
  p.$('rand').click(); await sleep(); assert.equal(p.$('exworld').value, 'fair3'); assert.equal(p.editors(), 3);
  await p.pick(p.$('exworld'), '4'); assert.equal(p.editors(), 4);
  p.set(p.$('seed'), '5'); await sleep();
  assert.equal(p.$('exworld').value, '', 'a ring example does not follow a seed: back to the contest world'); assert.equal(lastInit(p).mapText, ''); assert.equal(p.editors(), 2);
  await p.pick(p.$('exworld'), 'mirror'); assert.equal(p.$('exworld').value, 'mirror');
  await p.pick(p.$('exworld'), ''); assert.equal(lastInit(p).mapText, '');
  await p.pick(p.$('exworld'), 'fair2'); const text = lastInit(p).mapText;
  Object.defineProperty(p.$('world'), 'files', { value: [{ text: async () => text }], configurable: true }); p.fire(p.$('world'), 'change'); await sleep();
  assert.equal(p.$('exworld').value, 'custom');
  p.set(p.$('seed'), '9'); await sleep(); assert.equal(p.$('exworld').value, '', 'a file gives way to the contest world of a new seed'); assert.equal(lastInit(p).mapText, '');
}));

test('a saved project is restored; "Chart this match" draws a line per colony and shows its command', () => {
  return load('src/lang/templates.ts').then(async (t) => {
    const gen = await load('src/core/gen.ts'), map = await load('src/core/map.ts');
    const text = map.formatMap(gen.generateFairWorld(3, 9));
    await keep({ storage: { [KEYS.workshop]: { seed: '9', a: t.personality(t.DEFAULTS.trail), b: t.personality(t.DEFAULTS.forager), more: [t.personality(t.DEFAULTS.keeper)], rules: 'altorder', world: { kind: 'fair3', text } } } }, async (p) => {
      assert.deepEqual([...p.$('nav').querySelectorAll('a')].map((a) => a.textContent + (a.className ? '*' : '')), ['Workshop*', 'Arena', 'Maps', 'Reference']);
      assert.deepEqual([p.editors(), p.$('exworld').value, p.$('rules').value, p.$('seed').value], [3, 'fair3', 'altorder', '9']);
      const host = p.$('charthost'), btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Chart'), copy = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Copy map text');
      host.querySelector('select').value = '10000'; btn.click(); await p.wait(() => !btn.disabled);
      assert.equal(host.querySelectorAll('svg path').length, 3);
      assert.equal(host.querySelector('pre').textContent.split('\n')[1], 'node cli/series.ts A.brain B.brain C.brain --world W.world --seed 9 --rounds 10000 --every 50 --rules altorder');
      assert.equal(copy().hidden, false, 'a fixed map is needed as a file');
      await p.pick(p.$('exworld'), 'mirror'); assert.equal(p.stored(KEYS.workshop).world.kind, 'mirror'); assert.ok(p.stored(KEYS.workshop).world.text.length > 20);
      await p.pick(p.$('exworld'), ''); assert.deepEqual(p.stored(KEYS.workshop).world, { kind: '', text: '' });
      btn.click(); await p.wait(() => !btn.disabled);
      assert.equal(host.querySelectorAll('svg path').length, 2);
      assert.equal(host.querySelector('pre').textContent.split('\n')[1], 'node cli/series.ts A.brain B.brain --seed 9 --rounds 10000 --every 50 --rules altorder');
      assert.equal(copy().hidden, true, 'the contest world needs no file');
    });
  });
});
