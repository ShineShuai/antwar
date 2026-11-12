import { STARTER } from './default-ant.ts';
import { describeCell } from './inspect.ts';
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
$<HTMLTextAreaElement>('ba').value = $<HTMLTextAreaElement>('bb').value = STARTER;

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
  start();
};
seedBox.onchange = () => { mapText = ''; start(); };
$<HTMLInputElement>('world').onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) { mapText = await file.text(); start(); }
};
start();
