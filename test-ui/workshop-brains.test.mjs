// The workshop's brain tools: version history and diff, and the personality panel (the Keeper's dose follows the number of colonies).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPage, sleep } from './host.mjs';

const keep = async (f) => { const p = await openPage('workshop'); try { await p.wait(() => /^Round 0/.test(p.$('status').textContent)); await f(p); } finally { p.close(); } };

test('versions: save, duplicate, diff, run, restore, compare, example, delete, one panel per colony', () => keep(async (p) => {
  const { $, w } = p, va = $('va'), vb = $('vb'), A = $('ba'), B = $('bb');
  const list = (host) => [...host.querySelectorAll('.vlist .row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  const btn = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  assert.equal(list(va).length, 0, 'the untouched starter ant is not worth a version'); assert.equal(va.querySelector('summary').textContent, 'Versions (0)');
  p.set(A, 'line one\nline two\nline three\n', 'input');
  va.querySelector('input').value = 'first draft'; btn(va, 'Save version').click();
  assert.equal(list(va).length, 1); assert.match(list(va)[0], /first draft\(the text now\)/); assert.equal(va.querySelector('.note:last-child').textContent, 'Version saved.');
  btn(va, 'Save version').click();
  assert.ok([...va.querySelectorAll('.note')].some((n) => n.textContent === 'This text is already the newest version (or empty).'));
  p.set(A, 'line one\nline 2 changed\nline three\nline four\n', 'input');
  btn(va, 'Diff').click(); const diff = va.querySelector('pre.diff');
  assert.equal(diff.hidden, false);
  assert.deepEqual([...diff.querySelectorAll('div')].map((d) => `${d.className}: ${d.textContent}`).slice(1, 6), ['d-same:   line one', 'd-del: - line two', 'd-add: + line 2 changed', 'd-same:   line three', 'd-add: + line four']);
  assert.match(diff.querySelector('div').textContent, /1 line only in the version \(-\), 2 only in the editor \(\+\)/);
  $('reset').click(); await sleep(60); assert.equal(list(va).length, 2, 'a run saves the changed text');
  const restores = [...va.querySelectorAll('.vlist button')].filter((b) => b.textContent === 'Restore'); restores.at(-1).click(); await sleep(80);
  assert.equal(A.value, 'line one\nline two\nline three\n'); assert.equal(list(va).length, 3, 'the text replaced is saved first');
  p.set(B, 'line one\nline two\nline FIVE\n', 'input'); vb.querySelector('details').open = true;
  const cmp = va.querySelector('select'); assert.deepEqual([...cmp.options].map((o) => o.text), ['compare with…', 'brain B']);
  p.set(cmp, 'B'); assert.deepEqual([...va.querySelector('pre.diff').querySelectorAll('div')].map((d) => d.textContent).slice(0, 4),
    ['brain A → brain B: 1 line only in brain A (-), 1 only in brain B (+)', '  line one', '  line two', '- line three']);
  const ex = w.document.querySelector('select.ex[data-for="bb"]'), before = list(vb).length; p.set(ex, '1'); await sleep(80);
  assert.equal(list(vb).length, before + 2, 'the replaced text and the started one'); assert.match(list(vb).at(-1), /before loading Starter/);
  const n0 = list(va).length; [...va.querySelectorAll('.vlist button')].find((b) => b.getAttribute('aria-label') === 'Delete this version').click(); assert.equal(list(va).length, n0 - 1);
  await p.pick($('exworld'), 'fair3'); assert.equal(w.document.querySelectorAll('details.versions').length, 3);
  await p.pick($('exworld'), 'mirror'); assert.equal(w.document.querySelectorAll('details.versions').length, 2);
  assert.deepEqual(Object.keys(p.stored('tinyminds.versions.v1')), ['A', 'B']);
}));

test('the personality panel: a Keeper is made for the number of colonies', () => keep(async (p) => {
  const { $, w } = p, A = $('ba'), B = $('bb');
  const header = (ta) => ta.value.split('\n')[0].replace('# personality: ', ''), dose = (ta) => ta.value.match(/when 1 in (\d+) -> switch sit/)[1];
  const panel = (host) => ({ tpl: host.querySelector('select.tpl'), tip: host.querySelector('.tip'), tipBtn: host.querySelector('.tip button'), val: (k) => host.querySelectorAll('.slide')[k].querySelector('.val'), range: (k) => host.querySelectorAll('.slide input')[k] });
  const a = panel($('pa')), b = panel($('pb'));
  await p.pick(a.tpl, 'keeper'); // two colonies: the two-colony dose, no tip
  assert.equal(header(A), 'template=keeper curiosity=0 boldness=1 sociability=1'); assert.equal(dose(A), '10'); assert.equal(a.tip.hidden, true);
  await p.pick($('exworld'), 'fair3'); await sleep(100); // three colonies: the existing keeper is offered the dose
  assert.equal(p.editors(), 3); assert.equal(a.tip.hidden, false); assert.match(a.tip.textContent, /^3 colonies on this map: a Keeper settling 1 in 10 \(the two-colony dose\) comes last/);
  a.tipBtn.click(); await sleep(100);
  assert.equal(header(A), 'template=keeper curiosity=0 boldness=1 sociability=1 colonies=3'); assert.equal(dose(A), '40'); assert.equal(a.tip.hidden, true); assert.equal(a.val(3).textContent, '3+ colonies: 1 in 40');
  await p.pick(b.tpl, 'keeper'); // a keeper picked now is made for three
  assert.equal(header(B), 'template=keeper curiosity=0 boldness=1 sociability=1 colonies=3'); assert.equal(dose(B), '40'); assert.equal(b.tip.hidden, true);
  const r = a.range(3); r.value = '1'; p.fire(r, 'input'); await sleep(60); // the slider chooses a level and drops the colonies dose
  assert.equal(header(A), 'template=keeper curiosity=0 boldness=1 sociability=1 settling=1'); assert.equal(dose(A), '15'); assert.equal(a.val(3).textContent, 'seldom (1 in 15)');
  await p.pick($('exworld'), 'mirror'); await sleep(100); // back on two colonies: a keeper made for three is offered the two-colony dose
  assert.equal(p.editors(), 2); assert.equal(b.tip.hidden, false); assert.match(b.tip.textContent, /^This Keeper is set for 3\+ colonies \(1 in 40\); with two colonies 1 in 10 wins/);
  b.tipBtn.click(); await sleep(100); assert.equal(header(B), 'template=keeper curiosity=0 boldness=1 sociability=1'); assert.equal(dose(B), '10');
  await p.pick($('exworld'), 'fair3'); await p.pick(a.tpl, 'trail');
  assert.equal(header(A), 'template=trail curiosity=0 boldness=1 sociability=1'); assert.equal(a.tip.hidden, true, 'other templates have no colonies dose');
}));
