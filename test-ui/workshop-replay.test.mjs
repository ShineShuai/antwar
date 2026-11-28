// The workshop's replay: play, pause, step, seek, keys, following an ant, the share link, the heat map and the debugger.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { load, openPage, sleep } from './host.mjs';

let p, $, w, viewer;
const round = () => Number(($('status').textContent.match(/Round (\d+)/) ?? [])[1]);
const setTl = (v) => { $('tl').value = String(v); p.fire($('tl'), 'input'); };
const clickCell = (cell, W, H) => { // click the canvas on a cell's centre (clientWidth is 0 in jsdom: the layout is the page's own)
  const L = viewer.layout(W, H, Math.max(4, Math.min(10, Math.floor(900 / (W + 1))))), [x, y] = viewer.center(L, cell % W, (cell / W) | 0);
  $('view').getBoundingClientRect = () => ({ left: 0, top: 0, width: L.width, height: L.height });
  $('view').dispatchEvent(new w.MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
};

before(async () => { viewer = await load('web/viewer.ts'); p = await openPage('workshop'); ({ $, w } = p); await p.wait(() => round() === 0); });
after(() => p.close());

test('starts at round 0 with both colonies at full strength', () => assert.match($('status').textContent, /^Round 0 \| A 0 \(91 ants\) \| B 0 \(91 ants\)/));

test('play, pause, step', async () => {
  $('speed').value = '100'; $('go').click(); assert.equal($('go').textContent, 'Pause');
  await p.wait(() => round() >= 500); $('go').click(); await sleep(60);
  assert.equal($('go').textContent, 'Run');
  const r = round(); await sleep(80); assert.equal(round(), r, 'paused: the round stays');
  $('step').click(); await p.wait(() => round() === r + 1);
});

test('the timeline seeks back and forth and clamps at the end', async () => {
  setTl(300); await p.wait(() => round() === 300);
  setTl(999999); await p.wait(() => round() === 100000, 60000); assert.equal($('go').textContent, 'Run');
  setTl(0); await p.wait(() => round() === 0);
});

test('keys: arrows step (shift: 100), space plays and pauses', async () => {
  p.key('ArrowRight'); await p.wait(() => round() === 1);
  p.key('ArrowRight', { shiftKey: true }); await p.wait(() => round() === 101);
  p.key('ArrowLeft'); await p.wait(() => round() === 100);
  p.key(' '); await p.wait(() => round() > 200); assert.equal($('go').textContent, 'Pause');
  p.key(' '); await sleep(60); assert.equal($('go').textContent, 'Run');
});

test('clicking an ant follows it', async () => {
  const f = w.__lastFrame;
  clickCell(f.ants[1], 100, 100);
  await p.wait(() => /ant #\d+/.test($('ant').textContent));
  assert.match($('ant').textContent, /^ant #\d+ \([AB]\) at \d+,\d+, facing \w+, carrying /);
  await sleep(60);
  assert.ok(p.sent('track').length >= 1);
});

test('the share link carries the result and loads verified in a fresh page', async () => {
  $('share').click(); await sleep(300);
  const hash = w.location.hash; assert.match(hash, /^#v1\./); assert.ok(hash.length > 100);
  const q = await openPage('workshop', { hash });
  try {
    await q.wait(() => /verified|unverified/.test(q.$('verify').textContent));
    assert.match(q.$('verify').textContent, /verified/); assert.doesNotMatch(q.$('verify').textContent, /unverified/);
  } finally { q.close(); }
});

test('heat map and debugger on a rules brain', async () => {
  const q = await openPage('workshop'); const $q = q.$; const rq = () => Number(($q('status').textContent.match(/Round (\d+)/) ?? [])[1]);
  try {
    await q.wait(() => rq() === 0);
    $q('ba').value = readFileSync(`${q.root}ants/trail.rules`, 'utf8'); $q('bb').value = readFileSync(`${q.root}ants/forager.rules`, 'utf8');
    $q('reset').click(); await sleep(100); await q.wait(() => rq() === 0);
    $q('explainOn').checked = true; q.fire($q('explainOn'), 'change');
    $q('speed').value = '100'; $q('go').click(); await q.wait(() => rq() >= 400); $q('go').click(); await sleep(80);
    const buttons = () => [...$q('fires').querySelectorAll('button.hb')], on = () => buttons().filter((b) => b.classList.contains('on')).length;
    assert.ok(buttons().length > 3); assert.equal($q('heatnote').textContent, '');
    buttons()[0].click(); await sleep(100);
    assert.match($q('heatnote').textContent, /^Heat map: all acting ants of colony A/); assert.equal(on(), 1);
    $q('go').click(); await q.wait(() => rq() >= 800); $q('go').click(); await sleep(80);
    assert.match($q('heatnote').textContent, /the hottest cell has \d+ ant-rounds/);
    buttons()[2].click(); await sleep(100); assert.match($q('heatnote').textContent, /^Heat map: rule "/);
    buttons()[2].click(); await sleep(100); assert.equal($q('heatnote').textContent, ''); assert.equal(on(), 0);
    // the debugger: follow an ant of colony A, then run to a break on rule 3
    const f = q.w.__lastFrame; let row = -1;
    for (let i = 0; i < f.ants.length; i += 6) if (f.ants[i + 2] === 0) { row = i; break; }
    assert.ok(row >= 0);
    const L = viewer.layout(100, 100, 9), cell = f.ants[row + 1], [x, y] = viewer.center(L, cell % 100, (cell / 100) | 0);
    $q('view').getBoundingClientRect = () => ({ left: 0, top: 0, width: L.width, height: L.height });
    $q('view').dispatchEvent(new q.w.MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
    await q.wait(() => /ant #\d+/.test($q('ant').textContent)); await sleep(80);
    const senses = [...$q('senses').querySelectorAll('div')].map((d) => d.textContent);
    assert.deepEqual(senses.map((s) => s.split(':')[0]), ['here', 'ahead', 'left ahead', 'right ahead']);
    assert.equal($q('breakrow').hidden, false); assert.ok($q('breakRule').options.length > 5);
    $q('breakRule').value = '3'; $q('breakGo').click();
    await q.wait(() => /Stopped at round \d+/.test($q('status').textContent), 30000);
    assert.match($q('status').textContent, /ant #\d+ is about to run the rule you chose/);
    assert.match($q('ant').textContent, /next: /);
  } finally { q.close(); }
});
