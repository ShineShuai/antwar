import { STARTER } from './default-ant.js';
import { DARK, LIGHT, createViewer, layout } from './viewer.js';

const $ = (id) => document.getElementById(id);
const MATCH = 100000;
const canvas = $('view'), ctx = canvas.getContext('2d');
let worker, viewer, mapText = '', running = false, busy = false, cycle = 0;
$('ba').value = $('bb').value = STARTER;

const say = (text, err = false) => { $('status').textContent = text; $('status').classList.toggle('err', err); };
const setRunning = (on) => { running = on; $('go').textContent = on ? 'Pause' : 'Run'; if (on) pump(); };

function start() {
  worker?.terminate();
  busy = false; cycle = 0; setRunning(false);
  worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onMessage;
  worker.postMessage({ type: 'init', seed: +$('seed').value, mapText, rules: $('rules').value,
    brains: [$('ba').value, $('bb').value] });
}

function onMessage({ data: m }) {
  if (m.type === 'error') { say(m.message, true); setRunning(false); busy = false; return; }
  if (m.type === 'ready') {
    const w = Math.max(4, Math.min(10, Math.floor(900 / (m.W + 1)))), L = layout(m.W, m.H, w);
    canvas.width = L.width; canvas.height = L.height;
    viewer = createViewer(ctx, m, L, matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT);
    worker.postMessage({ type: 'frame' });
    return;
  }
  busy = false; cycle = m.cycle;
  viewer.draw(m);
  const [a, b] = m.score, done = cycle >= MATCH;
  say(`Round ${cycle} | A ${a} (${m.alive[0]} ants) | B ${b} (${m.alive[1]} ants)` +
    (done ? ` | ${a === b ? 'draw' : a > b ? 'A wins' : 'B wins'}` : ''));
  if (done) setRunning(false); else if (running) requestAnimationFrame(pump);
}

function pump() {
  if (!running || busy) return;
  busy = true;
  worker.postMessage({ type: 'run', n: Math.min(+$('speed').value, MATCH - cycle) });
}

$('go').onclick = () => setRunning(!running);
$('step').onclick = () => { setRunning(false); if (!busy) { busy = true; worker.postMessage({ type: 'run', n: 1 }); } };
$('reset').onclick = start;
$('seed').onchange = () => { mapText = ''; start(); };
$('rules').onchange = start;
$('world').onchange = async (e) => { mapText = await e.target.files[0].text(); start(); };
start();
