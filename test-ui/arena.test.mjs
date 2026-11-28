// The Arena page: tabs, head to head with a docked viewer, a league of three, and a sweep (one reference brain, or in a league).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEYS, load, openPage, sleep } from './host.mjs';

const keep = async (storage, f) => { const p = await openPage('arena', { storage }); try { await f(p); } finally { p.close(); } };
const projects = async () => {
  const t = await load('src/lang/templates.ts'), gen = await load('src/core/gen.ts'), map = await load('src/core/map.ts'), match = await load('src/core/match.ts');
  const text = (x) => t.personality(t.DEFAULTS[x]);
  return {
    mirror: { seed: '7', a: text('trail'), b: text('forager'), rules: 'colonies', world: { kind: 'mirror', text: map.formatMap(match.worldFor(7, true)) } },
    fair3: { seed: '9', a: text('trail'), b: text('forager'), more: [text('keeper')], rules: 'altorder', world: { kind: 'fair3', text: map.formatMap(gen.generateFairWorld(3, 9)) } },
    keeper3: async () => ({ seed: '9', a: text('keeper'), b: (await import('node:fs')).readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8'), more: [(await import('node:fs')).readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8')], rules: 'classic', world: { kind: 'fair3', text: map.formatMap(gen.generateFairWorld(3, 9)) } }),
  };
};
const sections = (p) => [...p.w.document.querySelectorAll('.evalsec')];
const visible = (p) => sections(p).map((d) => !d.hidden);
const viewer = (p) => p.w.document.querySelector('#viewhost');
const lines = (el) => el.textContent.split('\n');

test('the Arena reads the workshop project and shows its tabs and docked viewer', async () => {
  const P = await projects();
  await keep({ [KEYS.workshop]: P.mirror }, async (p) => {
    assert.deepEqual([...p.$('nav').querySelectorAll('a')].map((a) => a.textContent + (a.className ? '*' : '')), ['Workshop', 'Arena*', 'Maps', 'Reference']);
    assert.match(p.$('project').textContent, /Trail-layer: curiosity focused, boldness indifferent, sociability follower.*World: a mirrored world \(seed 7\)\. Seed 7\. Rules classic\.$/);
    assert.equal(viewer(p).querySelector('.note').textContent, 'A, B: seed 7');
    assert.match(viewer(p).textContent, /Round 0 \| A 0 \(91 ants\) \| B 0 \(91 ants\)/);
    assert.deepEqual([...p.$('evalhost').querySelectorAll('.evaltabs button')].map((b) => b.textContent + (b.className ? '*' : '')), ['Head to head*', 'League', 'Sweep', 'Fairness']);
    assert.deepEqual(visible(p), [true, false, false, false]);
  });
});

test('head to head: 2 worlds, both colours; every game can be watched to the end', async () => {
  const P = await projects();
  await keep({ [KEYS.workshop]: P.mirror }, async (p) => {
    const host = p.$('evalhost'), inputs = () => [...host.querySelectorAll('input')], selects = () => [...host.querySelectorAll('select')];
    inputs()[1].value = '2'; selects()[3].value = '10000'; // [workers, worlds, ...]; [A, B, worlds mode, rounds]
    const run = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Run'); run.click(); await p.wait(() => !run.disabled, 60000);
    assert.match(lines(host.querySelector('pre.evalout'))[0], /^A: \d+\/8 points, \d+ won, \d+ drawn, \d+ lost, food [+-]\d+, score [\d.]+% \[/);
    const trs = [...host.querySelector('table.games').querySelectorAll('tr')]; assert.equal(trs.length, 4);
    assert.deepEqual([...trs[0].querySelectorAll('td')].slice(0, 2).map((t) => t.textContent.replace(/\d+ : \d+/, 'n : n').replace(/A \d+ : \d+ B/, 'A n : n B')), ['world 1, A first', 'A n : n B']);
    trs[0].querySelector('button').click(); await sleep(60);
    assert.equal(viewer(p).querySelector('.note').textContent, 'A (red) vs B (blue), world 1 (mirrored)');
    [...viewer(p).querySelectorAll('button')].find((b) => b.textContent === 'End').click();
    await p.wait(() => /Round 10000/.test(viewer(p).textContent), 60000);
    assert.match(viewer(p).textContent, /Round 10000 \| A \d+ \(91 ants\) \| B \d+ \(91 ants\) \| (A wins|B wins|draw)/);
    viewer(p).querySelector('canvas').dispatchEvent(new p.w.MouseEvent('click', { clientX: 5, clientY: 5 })); // the cell inspector must not fail
    assert.equal(p.w.__err, undefined);
    assert.match(host.querySelectorAll('pre.evalout')[1].textContent, /^Reproduce[^\n]*\nnode cli\/tourney\.ts /);
  });
});

test('league of three brains on a fair world: a table row per rotation, legend chips in the viewer', async () => {
  const P = await projects();
  await keep({ [KEYS.workshop]: P.fair3 }, async (p) => {
    const host = p.$('evalhost');
    assert.match(p.$('project').textContent, /^A.*B.*C/);
    [...host.querySelectorAll('.evaltabs button')][1].click(); assert.equal(p.w.location.hash, '#league'); assert.deepEqual(visible(p), [false, true, false, false]);
    const inputs = [...host.querySelectorAll('input')], selects = [...host.querySelectorAll('select')];
    inputs[3].value = '1'; selects[5].value = '10000'; // league: worlds, rounds
    const run = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Run')[1]; run.click(); await p.wait(() => !run.disabled, 90000);
    const sec = sections(p)[1];
    assert.match(lines(sec.querySelector('pre.evalout'))[0], /^3 brains, 1 worlds \(seeds 1\.\.1; W\.world\), 3 rotations each, 10000 rounds, rules altorder; 3 games/);
    const trs = [...sec.querySelectorAll('table.games tr')]; assert.equal(trs.length, 3);
    assert.equal(trs[0].querySelector('td').textContent, 'world 1, rotation 0');
    trs[0].querySelector('button').click(); await sleep(60);
    assert.equal(viewer(p).querySelector('.note').textContent, 'A, B, C: world 1, rotation 0');
    assert.equal([...viewer(p).querySelectorAll('span')].filter((s) => s.textContent.includes('\u25a0')).length, 3);
  });
});

test('sweep: the labels follow the mode; a league sweep of the Keeper dose gives one row per level', async () => {
  const P = await projects(), project = await P.keeper3();
  await keep({ [KEYS.workshop]: project }, async (p) => {
    const host = p.$('evalhost'); [...host.querySelectorAll('.evaltabs button')][2].click();
    assert.equal(p.w.location.hash, '#sweep'); assert.deepEqual(visible(p), [false, false, true, false]);
    const sec = sections(p)[2], [, swParam, swMode, swVs, , swLWorld, swLen] = [...sec.querySelectorAll('select')];
    const labels = () => [...sec.querySelectorAll('label')].map((l) => [l.textContent.trim(), l.hidden]).filter(([t]) => /^(against|Against|Worlds)/.test(t)).map(([t, h]) => [t.slice(0, 12), h]);
    [...swMode.options].forEach((o, i) => assert.match(o.text, [/^one reference brain/, /^all the other brains/][i]));
    assert.deepEqual(labels().map(([, h]) => h), [false, false, false, true], 'a reference brain: its picker and the mirrored worlds');
    p.set(swMode, 'league');
    assert.deepEqual(labels().map(([, h]) => h), [false, true, true, false]);
    p.set(swParam, 'settling'); swLen.value = '10000'; const run = [...sec.querySelectorAll('button')].find((b) => b.textContent === 'Run');
    [...sec.querySelectorAll('input')][0].value = '1'; run.click(); assert.equal(run.disabled, true);
    await p.wait(() => !run.disabled, 200000);
    const out = sec.querySelectorAll('pre.evalout'), rows = lines(out[0]);
    assert.match(rows[0], /^A, settling swept in a league with B, C: 1 worlds \(fair worlds for 3 colonies\), 3 rotations each, 10/);
    [/ rarely \(1 in 20\)/, / seldom \(1 in 15\)/, /\*sometimes \(1 in 10\)/, / often \(1 in 7\)/].forEach((re, i) => assert.match(rows[2 + i], re)); // the starred level is the brain's own
    assert.equal(out[1].textContent.split('\n')[1], 'node cli/sweep.ts A.brain B.brain C.brain --league --param settling --seeds 1 --from 1 --rounds 10000 --rules classic');
    const trs = [...sec.querySelectorAll('table.games tr')]; assert.equal(trs.length, 12);
    trs[0].querySelector('button').click(); await sleep(80);
    assert.equal([...viewer(p).querySelectorAll('span')].filter((x) => x.textContent.includes('\u25a0')).length, 3);
    p.set(swLWorld, 'map'); run.click(); await p.wait(() => !run.disabled, 200000);
    assert.equal([...p.w.document.querySelectorAll('button')].find((b) => b.textContent === 'Copy map text').hidden, false);
    assert.match(sec.querySelectorAll('pre.evalout')[1].textContent.split('\n')[1], /--world W\.world$/);
    p.set(swMode, 'ref'); [...sec.querySelectorAll('input')][0].value = '1'; swLen.value = '10000'; swVs.selectedIndex = 1; run.click(); await p.wait(() => !run.disabled, 200000);
    assert.match(lines(sec.querySelectorAll('pre.evalout')[0])[0], /^A, settling swept against B: /);
  });
});
