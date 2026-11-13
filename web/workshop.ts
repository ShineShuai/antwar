import { EXAMPLES, STARTER } from './default-ant.ts';
import { describeCell } from './inspect.ts';
import { GENERATOR_VERSION } from '../src/core/gen.ts';
import { decodeShare, encodeShare } from './share.ts';
import type { Reply, Request } from './protocol.ts';
import { DARK, LIGHT, cellAt, createViewer, layout } from './viewer.ts';
import type { Layout } from './viewer.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const MATCH = 100000;
const canvas = $<HTMLCanvasElement>('view'), ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const seedBox = $<HTMLInputElement>('seed');
const speedBox = $<HTMLSelectElement>('speed'), goBtn = $<HTMLButtonElement>('go'), statusBox = $('status');
let worker: Worker | undefined, viewer: ReturnType<typeof createViewer> | undefined;
let mapText = '', running = false, busy = false, cycle = 0;
let geom: { L: Layout; W: number; H: number } | undefined, last: Extract<Reply, { type: 'frame' }> | undefined;
const marksBox = $<HTMLInputElement>('marks'), inspectBox = $('inspect');
const baBox = $<HTMLTextAreaElement>('ba'), bbBox = $<HTMLTextAreaElement>('bb');
baBox.value = bbBox.value = STARTER;

// Edits survive a reload (per-browser convenience only); a share link, when present, wins over them.
const KEY = 'tinyminds.workshop.v1';
const save = (): void => {
  try { localStorage.setItem(KEY, JSON.stringify({ seed: seedBox.value, a: baBox.value, b: bbBox.value })); } catch { /* storage may be blocked */ }
};
const restore = (): void => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { seed?: string; a?: string; b?: string } | null;
    if (typeof s?.a === 'string' && typeof s.b === 'string') { baBox.value = s.a; bbBox.value = s.b; }
    if (typeof s?.seed === 'string' && s.seed !== '') seedBox.value = s.seed;
  } catch { /* corrupt or blocked storage: keep the defaults */ }
};
async function fromHash(): Promise<boolean> {
  if (!location.hash.startsWith('#v1.')) return false;
  const p = await decodeShare(location.hash.slice(4));
  if (!p) { say('That share link is damaged or too large.', true); return false; }
  seedBox.value = String(p.seed); baBox.value = p.brains[0]; bbBox.value = p.brains[1]; mapText = p.map ?? '';
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

function start(): void {
  worker?.terminate();
  busy = false; cycle = 0; setRunning(false);
  worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Reply>) => onMessage(e.data);
  send({ type: 'init', seed: Number(seedBox.value), mapText, rules: 'classic',
    brains: [$<HTMLTextAreaElement>('ba').value, $<HTMLTextAreaElement>('bb').value] });
}

function onMessage(m: Reply): void {
  if (m.type === 'error') { say(m.message, true); setRunning(false); busy = false; return; }
  if (m.type === 'ready') {
    const w = Math.max(4, Math.min(10, Math.floor(900 / (m.W + 1)))), L = layout(m.W, m.H, w);
    canvas.width = L.width; canvas.height = L.height; geom = { L, W: m.W, H: m.H };
    viewer = createViewer(ctx, m, L, matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT);
    send({ type: 'frame' });
    return;
  }
  busy = false; cycle = m.cycle;
  last = m;
  viewer?.draw(m, { marks: marksBox.checked });
  const [a, b] = m.score, done = cycle >= MATCH;
  say(`Round ${cycle} | A ${a} (${m.alive[0]} ants) | B ${b} (${m.alive[1]} ants)` +
    (done ? ` | ${a === b ? 'draw' : a > b ? 'A wins' : 'B wins'}` : ''));
  if (done) setRunning(false); else if (running) requestAnimationFrame(pump);
}

function pump(): void {
  if (!running || busy) return;
  busy = true;
  send({ type: 'run', n: Math.min(Number(speedBox.value), MATCH - cycle) });
}

marksBox.onchange = () => { if (last) viewer?.draw(last, { marks: marksBox.checked }); };
canvas.onclick = (e) => {
  if (!geom || !last) return;
  const r = canvas.getBoundingClientRect();
  const p = cellAt(geom.L, geom.W, geom.H, ((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height);
  inspectBox.textContent = p < 0 ? '' : describeCell(last, geom.W, geom.H, p);
};
goBtn.onclick = () => setRunning(!running);
$('step').onclick = () => { setRunning(false); if (!busy) { busy = true; send({ type: 'run', n: 1 }); } };
$('reset').onclick = start;
$('rand').onclick = () => {
  seedBox.value = String(crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffffff);
  mapText = '';
  save();
  start();
};
seedBox.onchange = () => { mapText = ''; save(); start(); };
baBox.oninput = bbBox.oninput = save; // a shared link is never written over your saved brains until you edit
$<HTMLInputElement>('world').onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) { mapText = await file.text(); start(); }
};
document.querySelectorAll<HTMLSelectElement>('select.ex').forEach((sel) => {
  sel.add(new Option('load example…', ''));
  EXAMPLES.forEach((e, i) => sel.add(new Option(e.name, String(i))));
  sel.onchange = () => {
    if (sel.value === '') return;
    $<HTMLTextAreaElement>(sel.dataset.for ?? '').value = EXAMPLES[Number(sel.value)].text;
    sel.value = '';
    save();
    start();
  };
});
$('share').onclick = async () => {
  const link = `${location.href.split('#')[0]}#v1.${await encodeShare({
    seed: Number(seedBox.value), brains: [baBox.value, bbBox.value], map: mapText || undefined, gen: GENERATOR_VERSION })}`;
  history.replaceState(null, '', link);
  try { await navigator.clipboard.writeText(link); say(`Link copied (${link.length} characters).`); } catch { say('Link is in the address bar.'); }
};
addEventListener('hashchange', () => { void fromHash().then((ok) => { if (ok) start(); }); });
if (!(await fromHash())) restore();
start();
