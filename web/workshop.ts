import { EXAMPLES, STARTER } from './default-ant.ts';
import { describeCell } from './inspect.ts';
import { GENERATOR_VERSION, generateFairWorld } from '../src/core/gen.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { RULESETS, RULESET_NAMES } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { decodeShare, encodeShare } from './share.ts';
import { describeBrain, fireRows, lineOfMessage, traceRows, whereIs } from './brain.ts';
import { mountHighlight } from './highlight.ts';
import { mountPersonality } from './personality.ts';
import type { BrainInfo } from './brain.ts';
import type { Reply, Request } from './protocol.ts';
import { MAX_COLONIES, colonyCount, colonyName, exampleWorld, letter, paletteFor, rulesFor, statusLine } from './colonies.ts';
import { cellAt, createViewer, layout } from './viewer.ts';
import type { Layout } from './viewer.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const MATCH = 100000;
const canvas = $<HTMLCanvasElement>('view'), ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const seedBox = $<HTMLInputElement>('seed'), rulesBox = $<HTMLSelectElement>('rules');
for (const id of Object.keys(RULESETS)) rulesBox.add(new Option(RULESET_NAMES[id] ?? id, id));
const rulesId = (): RulesId => (Object.hasOwn(RULESETS, rulesBox.value) ? rulesBox.value : 'classic') as RulesId;
const speedBox = $<HTMLSelectElement>('speed'), goBtn = $<HTMLButtonElement>('go'), statusBox = $('status');
const tl = $<HTMLInputElement>('tl'), verifyBox = $('verify');
let worker: Worker | undefined, viewer: ReturnType<typeof createViewer> | undefined;
let mapText = '', running = false, busy = false, cycle = 0;
let geom: { L: Layout; W: number; H: number } | undefined, last: Extract<Reply, { type: 'frame' }> | undefined;
const marksBox = $<HTMLInputElement>('marks'), inspectBox = $('inspect');
const baBox = $<HTMLTextAreaElement>('ba'), bbBox = $<HTMLTextAreaElement>('bb');
const boxes: HTMLTextAreaElement[] = [baBox, bbBox]; // one editor per colony: A and B are in the page, the rest are added for maps with more hills
const noteEls: HTMLElement[] = [$('na'), $('nb')], moreHost = $('more'), colNote = $('colnote');
let savedMore: string[] = []; // brains of colonies C.. from the last session, offered again when the map brings those colonies back
const explainBox = $<HTMLInputElement>('explainOn'), firesBox = $('fires'), antBox = $('ant'), traceBox = $('trace');
let selected: number | null = null, selectedCol = 0; // id and colony of the ant being followed
let wantTrack: number | null | undefined; // a track request waiting for the Worker to be free (undefined = none)
let wantSeek: number | undefined; // the newest seek request waiting for the Worker (scrubbing sends many; only the last matters)
let scrubbing = false;
let expect: { round: number; hash: number } | null = null; // from a share link: seek there once the match is ready
let check: { round: number; hash: number } | null = null; // being verified: compared with the frame at that round
let startedKey = ''; // the inputs of the running match: a link only carries a result while the editors still match them
const keyNow = (): string => JSON.stringify([...boxes.map((b) => b.value), seedBox.value, rulesBox.value, mapText]);
const DIRS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];

/** Select a line of an editor (and scroll it into view): used by trace rows, rule rows and lint messages. */
function jumpTo(side: number, line: number): void {
  const box = boxes[side], lines = box.value.split('\n');
  if (line < 1 || line > lines.length) return;
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  box.focus();
  box.setSelectionRange(start, start + lines[line - 1].length);
  box.scrollTop = Math.max(0, (line - 3) * (parseFloat(getComputedStyle(box).lineHeight) || 15));
}
const changed = (restart: boolean): void => { save(); updateNotesSoon(); if (restart) start(); };
const panels = [mountPersonality($('pa'), baBox, changed), mountPersonality($('pb'), bbBox, changed)];
const bindBox = (b: HTMLTextAreaElement): void => { b.oninput = () => { save(); updateNotesSoon(); syncPanels(); }; }; // a shared link is never written over your saved brains until you edit
function fillExamples(sel: HTMLSelectElement): void {
  sel.add(new Option('load example…', ''));
  EXAMPLES.forEach((e, i) => sel.add(new Option(e.name, String(i))));
  sel.onchange = () => {
    if (sel.value === '') return;
    $<HTMLTextAreaElement>(sel.dataset.for ?? '').value = EXAMPLES[Number(sel.value)].text;
    sel.value = '';
    save();
    start();
  };
}
/** Make exactly n editors (2 to 26): colonies follow the map. Added ones start as the starter ant, or as last session's brain. */
function setColonies(n: number): void {
  n = Math.max(2, Math.min(MAX_COLONIES, n));
  while (boxes.length > n) { boxes.pop(); noteEls.pop(); panels.pop(); moreHost.lastElementChild?.remove(); }
  while (boxes.length < n) {
    const c = boxes.length, wrap = document.createElement('div'), row = document.createElement('div');
    const lab = document.createElement('label'), sel = document.createElement('select'), ta = document.createElement('textarea');
    const nt = document.createElement('div'), pn = document.createElement('div');
    wrap.className = 'brain'; row.className = 'row';
    lab.htmlFor = ta.id = `b${c}`; lab.textContent = `Brain ${letter(c)} (${colonyName(c)})`;
    sel.className = 'ex'; sel.dataset.for = ta.id; sel.setAttribute('aria-label', `Load an example into ${letter(c)}`);
    ta.spellcheck = false; ta.value = savedMore[c - 2] ?? STARTER;
    nt.className = 'note'; nt.id = `n${c}`; pn.id = `p${c}`;
    row.append(lab, sel); wrap.append(row, ta, nt, pn); moreHost.append(wrap);
    fillExamples(sel); bindBox(ta); mountHighlight(ta);
    boxes.push(ta); noteEls.push(nt); panels.push(mountPersonality(pn, ta, changed));
  }
}
const syncPanels = (): void => panels.forEach((x) => x.sync());
let infos: BrainInfo[] = []; // the brains as they were when the match was started (rule ids match the Worker's)
baBox.value = bbBox.value = STARTER;

// Edits survive a reload (per-browser convenience only); a share link, when present, wins over them.
const KEY = 'tinyminds.workshop.v1';
const save = (): void => {
  try { localStorage.setItem(KEY, JSON.stringify({ seed: seedBox.value, a: baBox.value, b: bbBox.value, more: boxes.slice(2).map((b) => b.value), rules: rulesBox.value })); } catch { /* storage may be blocked */ }
};
const restore = (): void => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { seed?: string; a?: string; b?: string; more?: unknown; rules?: string } | null;
    if (Array.isArray(s?.more)) savedMore = s.more.filter((t): t is string => typeof t === 'string').slice(0, MAX_COLONIES - 2);
    if (typeof s?.rules === 'string' && Object.hasOwn(RULESETS, s.rules)) rulesBox.value = s.rules;
    if (typeof s?.a === 'string' && typeof s.b === 'string') { baBox.value = s.a; bbBox.value = s.b; }
    if (typeof s?.seed === 'string' && s.seed !== '') seedBox.value = s.seed;
  } catch { /* corrupt or blocked storage: keep the defaults */ }
};
async function fromHash(): Promise<boolean> {
  if (!location.hash.startsWith('#v1.')) return false;
  const p = await decodeShare(location.hash.slice(4));
  if (!p) { say('That share link is damaged or too large.', true); return false; }
  setColonies(p.brains.length); p.brains.forEach((t, c) => { boxes[c].value = t; });
  seedBox.value = String(p.seed); mapText = p.map ?? ''; rulesBox.value = p.rules ?? 'classic';
  expect = p.result ?? null;
  if (p.gen !== undefined && p.gen !== GENERATOR_VERSION) say('Link made with another world generator: the map may differ.', true);
  return true;
}

const say = (text: string, err = false): void => {
  statusBox.textContent = text;
  statusBox.classList.toggle('err', err);
};
const send = (msg: Request): void => worker?.postMessage(msg);
const setRunning = (on: boolean): void => {
  running = on;
  goBtn.textContent = on ? 'Pause' : 'Run';
  if (on) pump();
};

/** The note under an editor: size and lint warnings, or the error with its line number. */
function note(box: HTMLElement, info: BrainInfo, side: number): void {
  box.replaceChildren();
  const add = (cls: string, text: string): void => {
    const d = document.createElement('div'), line = lineOfMessage(text);
    d.className = line ? `${cls} link` : cls; d.textContent = text;
    if (line) { d.title = `go to line ${line}`; d.onclick = () => jumpTo(side, line); }
    box.append(d);
  };
  if (!info.ok) { add('err', info.error); return; }
  add('', info.summary);
  info.warnings.forEach((w) => add('warn', `warning: ${w}`));
}
let noteTimer: ReturnType<typeof setTimeout> | undefined;
const updateNotes = (): void => boxes.forEach((b, c) => note(noteEls[c], describeBrain(b.value, RULESETS[rulesId()]), c));
const updateNotesSoon = (): void => { clearTimeout(noteTimer); noteTimer = setTimeout(updateNotes, 250); };

function renderFires(fires: (Extract<Reply, { type: 'frame' }>['fires'])): void {
  firesBox.replaceChildren();
  fires.forEach((f, c) => {
    const info = infos[c];
    if (!f || !info?.ok || info.kind !== 'rules') return;
    const head = document.createElement('div');
    head.className = 'fh';
    head.textContent = `Colony ${letter(c)}: ${f.total} acting ant-rounds counted`;
    firesBox.append(head);
    const hot = selected !== null && selectedColony() === c ? hereNow()?.rule : undefined;
    for (const row of fireRows(info.rules, f)) {
      const d = document.createElement('div'), bar = document.createElement('div'), t = document.createElement('i'), a = document.createElement('i');
      const pct = document.createElement('span'), code = document.createElement('code');
      d.className = `fire${row.rule === hot && row.rule >= 0 ? ' hot' : ''}${row.line ? ' link' : ''}`; bar.className = 'bar'; t.className = 't'; a.className = 'a';
      if (row.line) { const line = row.line; d.title = `go to line ${line}`; d.onclick = () => jumpTo(c, line); }
      t.style.width = `${row.test * 100}%`; a.style.width = `${row.act * 100}%`;
      pct.textContent = `${((row.test + row.act) * 100).toFixed(1)}%`; code.textContent = row.label;
      bar.append(t, a); d.append(bar, pct, code); firesBox.append(d);
    }
  });
}

function start(): void {
  worker?.terminate();
  let want = 2; // colonies = the hills of the map (a generated world has two)
  if (mapText) {
    try { want = colonyCount(parseMap(mapText).hill); } catch (e) { say((e as Error).message, true); setRunning(false); return; }
  }
  const rid = rulesFor(rulesId(), want);
  colNote.textContent = '';
  if (rid !== rulesId()) { rulesBox.value = rid; colNote.textContent = `This map has ${want} colonies: Rules switched to "${RULESET_NAMES[rid]}".`; }
  else if (want > 2) colNote.textContent = `${want} colonies, one brain each. Ranking: more food ranks higher, and a colony scores 2 points for each colony it out-scores and 1 for each tie (docs/MATCH.md).`;
  setColonies(want);
  infos = boxes.map((b) => describeBrain(b.value, RULESETS[rulesId()]));
  selected = null; wantTrack = undefined; wantSeek = undefined; check = null;
  verifyBox.textContent = ''; verifyBox.className = ''; tl.value = '0'; startedKey = keyNow();
  antBox.textContent = 'Click an ant to follow it.'; traceBox.replaceChildren();
  syncPanels();
  firesBox.replaceChildren();
  updateNotes();
  busy = false; cycle = 0; setRunning(false);
  worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Reply>) => onMessage(e.data);
  send({ type: 'init', seed: Number(seedBox.value), mapText, rules: rulesId(),
    brains: boxes.map((b) => b.value) });
}

/** The followed ant in the latest frame: its row (index into ants) or -1 when it is dead or gone. */
function selectedRow(): number {
  if (selected === null || !last) return -1;
  for (let i = 0; i < last.ants.length; i += 6) if (last.ants[i] === selected) return i;
  return -1;
}
const selectedColony = (): number => (selectedRow() < 0 ? -1 : selectedCol);
function hereNow(): ReturnType<typeof whereIs> | undefined {
  const i = selectedRow();
  const info = i < 0 ? undefined : infos[last?.ants[i + 2] ?? 0];
  return info && last ? whereIs(info, last.ants[i + 5]) : undefined;
}
function renderAnt(f: Extract<Reply, { type: 'frame' }>): void {
  antBox.replaceChildren(); traceBox.replaceChildren();
  if (selected === null) { antBox.textContent = 'Click an ant to follow it.'; return; }
  const i = selectedRow();
  const col = selectedCol;
  if (i < 0) { antBox.textContent = `ant #${selected} is dead (its last rules are below).`; }
  else {
    const info = infos[col], where = hereNow();
    const cell = f.ants[i + 1];
    antBox.textContent = `ant #${selected} (${letter(col)}) at ${cell % (geom?.W ?? 1)},${Math.floor(cell / (geom?.W ?? 1))}, facing ${DIRS[f.ants[i + 3]]}, carrying ${f.ants[i + 4]}; next: `;
    if (where && info?.ok) {
      const b = document.createElement('b'), d = document.createElement('div');
      b.textContent = `${where.label}${where.part ? ` (${where.part})` : ''}`;
      d.className = where.line ? 'hot link' : 'hot'; d.append(b);
      if (where.line) { const line = where.line; d.title = `go to line ${line}`; d.onclick = () => jumpTo(col, line); }
      antBox.append(d);
    }
  }
  const info = infos[col];
  if (!info) return;
  for (const row of traceRows(info, f.trace)) {
    const d = document.createElement('div'), rd = document.createElement('span'), code = document.createElement('code');
    d.className = `tr${row.line ? ' link' : ''}`;
    rd.className = 'rd'; rd.textContent = row.fromRound === row.toRound ? `r${row.fromRound}` : `r${row.fromRound}-${row.toRound}`;
    code.textContent = `${row.count > 1 ? `×${row.count} ` : ''}${row.label}${row.part ? ` (${row.part})` : ''}`;
    if (row.line) { const line = row.line; d.title = `go to line ${line}`; d.onclick = () => jumpTo(col, line); }
    d.append(rd, code); traceBox.append(d);
  }
}
function onMessage(m: Reply): void {
  if (m.type === 'error') { say(m.message, true); setRunning(false); busy = false; return; }
  if (m.type === 'ready') {
    const w = Math.max(4, Math.min(10, Math.floor(900 / (m.W + 1)))), L = layout(m.W, m.H, w);
    canvas.width = L.width; canvas.height = L.height; geom = { L, W: m.W, H: m.H };
    viewer = createViewer(ctx, m, L, paletteFor(boxes.length, matchMedia('(prefers-color-scheme: dark)').matches));
    if (expect && expect.round > 0) { check = expect; busy = true; say(`Re-running to round ${expect.round} to check the link…`); send({ type: 'seek', round: expect.round }); } else send({ type: 'frame' });
    expect = null;
    return;
  }
  busy = false; cycle = m.cycle;
  last = m;
  if (!scrubbing) tl.value = String(cycle);
  if (check && cycle === check.round) {
    const ok = m.hash === check.hash;
    verifyBox.className = ok ? 'ok' : 'err';
    verifyBox.textContent = ok ? `✓ verified locally: the state hash at round ${cycle} matches the link`
      : `✗ unverified: the link says hash ${check.hash} at round ${cycle}, this run gives ${m.hash} (other version or edited link)`;
    check = null;
  }
  viewer?.draw(m, { marks: marksBox.checked, selected });
  renderAnt(m);
  renderFires(m.fires);
  const done = cycle >= MATCH;
  say(statusLine(cycle, m.score, m.alive, MATCH));
  if (wantTrack !== undefined) { const t = wantTrack; wantTrack = undefined; busy = true; send({ type: 'track', ant: t }); return; }
  if (wantSeek !== undefined) { const r = wantSeek; wantSeek = undefined; busy = true; send({ type: 'seek', round: r }); return; }
  if (done) setRunning(false); else if (running) requestAnimationFrame(pump);
}

function pump(): void {
  if (!running || busy) return;
  busy = true;
  send({ type: 'run', n: Math.min(Number(speedBox.value), MATCH - cycle), explain: explainBox.checked });
}

marksBox.onchange = () => { if (last) viewer?.draw(last, { marks: marksBox.checked }); };
canvas.onclick = (e) => {
  if (!geom || !last) return;
  const r = canvas.getBoundingClientRect();
  const p = cellAt(geom.L, geom.W, geom.H, ((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height);
  inspectBox.textContent = p < 0 ? '' : describeCell(last, geom.W, geom.H, p);
  if (p < 0) return;
  for (let i = 0; i < last.ants.length; i += 6) { // an ant on that cell: follow it
    if (last.ants[i + 1] !== p) continue;
    selected = last.ants[i]; selectedCol = last.ants[i + 2];
    if (busy) wantTrack = selected; else { busy = true; send({ type: 'track', ant: selected }); }
    viewer?.draw(last, { marks: marksBox.checked, selected });
    renderAnt(last);
    break;
  }
};
/** Jump to a round (clamped to the match): pauses, and queues behind a request in flight. */
function seekTo(round: number): void {
  const r = Math.max(0, Math.min(MATCH, Math.trunc(round)));
  setRunning(false);
  if (busy) wantSeek = r; else { busy = true; send({ type: 'seek', round: r }); }
}
tl.oninput = () => seekTo(Number(tl.value));
tl.onpointerdown = () => { scrubbing = true; };
addEventListener('pointerup', () => { scrubbing = false; });
addEventListener('keydown', (e) => { // reference, client UI: Space play/pause; left/right step 1 round (Shift = 100)
  const t = e.target;
  if (e.ctrlKey || e.metaKey || e.altKey || (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) && t !== tl)) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (t === tl) return; // the slider steps itself and its input event seeks
    e.preventDefault();
    seekTo(cycle + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 100 : 1));
  } else if (e.key === ' ' && !(t instanceof HTMLElement && t.tagName === 'BUTTON')) { e.preventDefault(); setRunning(!running); }
});
goBtn.onclick = () => setRunning(!running);
$('step').onclick = () => { setRunning(false); if (!busy) { busy = true; send({ type: 'run', n: 1, explain: explainBox.checked }); } };
$('reset').onclick = start;
$('rand').onclick = () => {
  seedBox.value = String(crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffffff);
  mapText = '';
  save();
  start();
};
seedBox.onchange = () => { mapText = ''; save(); start(); };
rulesBox.onchange = () => { save(); start(); };
boxes.forEach(bindBox);
boxes.forEach(mountHighlight);
$<HTMLInputElement>('world').onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) { mapText = await file.text(); start(); }
};
document.querySelectorAll<HTMLSelectElement>('select.ex').forEach(fillExamples);
const exWorld = $<HTMLSelectElement>('exworld');
exWorld.add(new Option('example world…', ''));
for (const n of [3, 4, 6, 8]) exWorld.add(new Option(`${n} colonies`, String(n)));
// fair worlds: the same place for every colony (docs/MATCH.md); the seed box picks the world, wrapped, no rock border
for (const n of [3, 4, 6, 8]) exWorld.add(new Option(`${n} colonies, fair (seed)`, `fair${n}`));
exWorld.onchange = () => {
  const v = exWorld.value;
  if (!v) return;
  mapText = v.startsWith('fair') ? formatMap(generateFairWorld(Number(v.slice(4)), Number.isInteger(Number(seedBox.value)) ? Number(seedBox.value) : 1)) : exampleWorld(Number(v));
  exWorld.value = '';
  start();
};
$('share').onclick = async () => {
  const link = `${location.href.split('#')[0]}#v1.${await encodeShare({
    seed: Number(seedBox.value), brains: boxes.map((b) => b.value), map: mapText || undefined, gen: GENERATOR_VERSION, rules: rulesId() === 'classic' ? undefined : rulesId(),
    result: last && cycle > 0 && startedKey === keyNow() ? { round: cycle, hash: last.hash } : undefined })}`;
  history.replaceState(null, '', link);
  try { await navigator.clipboard.writeText(link); say(`Link copied (${link.length} characters).`); } catch { say('Link is in the address bar.'); }
};
addEventListener('hashchange', () => { void fromHash().then((ok) => { if (ok) start(); }); });
if (!(await fromHash())) restore();
start();
