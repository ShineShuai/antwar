// A game viewer for any page: canvas, play/pause, speed, timeline, status, and a click inspector, driven by a WatchSpec (src/watch.ts).
// It uses the same replay engine and renderer as the workshop (web/engine.ts via web/sim-worker.ts, web/viewer.ts); the workshop's own
// viewer is richer (follow an ant, rule counts) and stays in web/workshop.ts.
import type { WatchSpec } from '../src/watch.ts';
import { describeCell } from './inspect.ts';
import { paletteFor, statusLine } from './colonies.ts';
import type { Reply, Request } from './protocol.ts';
import { cellAt, createViewer, layout } from './viewer.ts';

export interface GameViewWorker {
  onmessage: ((e: { data: Reply }) => void) | null;
  postMessage(m: Request): void;
  terminate(): void;
}
export interface GameView {
  /** Show a game from round 0, paused. */
  load(spec: WatchSpec): void;
  /** Stop and empty the view. */
  clear(): void;
}

const defaultWorker = (): GameViewWorker => new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' }) as unknown as GameViewWorker;

export function mountGameView(host: HTMLElement, o: { makeWorker?: () => GameViewWorker; maxWidth?: number } = {}): GameView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e;
  };
  const title = el('div', 'Pick a game to watch it here.', 'note'), canvas = el('canvas'), legend = el('div', '', 'note'), status = el('div'), cell = el('div', '', 'note');
  const play = el('button', '\u25b6 Play'), end = el('button', 'End'), speed = el('select'), marksBox = el('input'), tl = el('input');
  for (const v of ['1', '10', '100', '1000', '10000']) speed.add(new Option(v, v));
  speed.value = '100'; marksBox.type = 'checkbox'; marksBox.checked = true;
  tl.type = 'range'; tl.min = '0'; tl.max = '0'; tl.step = '1'; tl.value = '0'; tl.style.width = '100%'; tl.setAttribute('aria-label', 'Round (drag to seek)');
  const marksLabel = el('label', ' scents'); marksLabel.prepend(marksBox);
  const speedLabel = el('label', ' rounds/frame'); speedLabel.prepend(speed);
  const controls = el('div', '', 'row'); controls.append(play, end, speedLabel, marksLabel);
  canvas.style.maxWidth = '100%'; canvas.style.height = 'auto';
  host.append(title, canvas, controls, tl, status, legend, cell);

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let worker: GameViewWorker | undefined, spec: WatchSpec | undefined, viewer: ReturnType<typeof createViewer> | undefined;
  let geom: { L: ReturnType<typeof layout>; W: number; H: number } | undefined, last: Extract<Reply, { type: 'frame' }> | undefined;
  let running = false, busy = false, cycle = 0, wantSeek: number | undefined, scrubbing = false;

  const setRunning = (on: boolean): void => { running = on; play.textContent = on ? '\u275a\u275a Pause' : '\u25b6 Play'; };
  const say = (t: string, err = false): void => { status.textContent = t; status.className = err ? 'err' : ''; };
  const send = (m: Request): void => { busy = true; worker?.postMessage(m); };
  const pump = (): void => {
    if (!running || busy || !spec) return;
    send({ type: 'run', n: Math.min(Number(speed.value), spec.rounds - cycle) });
  };
  const seekTo = (round: number): void => {
    if (!spec) return;
    const r = Math.max(0, Math.min(spec.rounds, Math.trunc(round)));
    setRunning(false);
    if (busy) wantSeek = r; else send({ type: 'seek', round: r });
  };
  const onMessage = (m: Reply): void => {
    if (m.type === 'error') { say(m.message, true); setRunning(false); busy = false; return; }
    if (!spec) return;
    if (m.type === 'ready') {
      const w = Math.max(3, Math.min(10, Math.floor((o.maxWidth ?? 600) / (m.W + 1)))), L = layout(m.W, m.H, w);
      canvas.width = L.width; canvas.height = L.height; geom = { L, W: m.W, H: m.H };
      viewer = createViewer(ctx, m, L, paletteFor(spec.hills.length, typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches));
      send({ type: 'frame' });
      return;
    }
    busy = false; cycle = m.cycle; last = m;
    if (!scrubbing) tl.value = String(cycle);
    viewer?.draw(m, { marks: marksBox.checked });
    say(statusLine(cycle, m.score, m.alive, spec.rounds));
    if (wantSeek !== undefined) { const r = wantSeek; wantSeek = undefined; send({ type: 'seek', round: r }); return; }
    if (cycle >= spec.rounds) setRunning(false); else if (running) requestAnimationFrame(pump);
  };

  play.onclick = () => { if (!spec) return; if (cycle >= spec.rounds) seekTo(0); setRunning(!running); if (running) pump(); };
  end.onclick = () => { if (spec) seekTo(spec.rounds); };
  tl.oninput = () => seekTo(Number(tl.value));
  tl.onpointerdown = () => { scrubbing = true; };
  addEventListener('pointerup', () => { scrubbing = false; });
  marksBox.onchange = () => { if (last) viewer?.draw(last, { marks: marksBox.checked }); };
  canvas.onclick = (e) => {
    if (!geom || !last) return;
    const r = canvas.getBoundingClientRect();
    const p = cellAt(geom.L, geom.W, geom.H, ((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height);
    cell.textContent = p < 0 ? '' : describeCell(last, geom.W, geom.H, p);
  };

  return {
    load(s) {
      worker?.terminate();
      spec = s; viewer = undefined; geom = undefined; last = undefined; cycle = 0; wantSeek = undefined; busy = false; setRunning(false);
      tl.max = String(s.rounds); tl.value = '0'; cell.textContent = ''; title.textContent = s.title;
      const colors = paletteFor(s.hills.length, typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches).ant;
      legend.replaceChildren(...s.hills.map((h, c) => { const chip = el('span', `\u25a0 ${String.fromCharCode(65 + c)}: ${h}   `); chip.style.color = colors[c]; return chip; }));
      say('Loading\u2026');
      worker = (o.makeWorker ?? defaultWorker)();
      worker.onmessage = (e) => onMessage(e.data);
      send({ type: 'init', seed: s.seed, mapText: s.mapText, rules: s.rules, brains: s.brains });
    },
    clear() {
      worker?.terminate(); worker = undefined; spec = undefined; viewer = undefined; last = undefined; setRunning(false); busy = false;
      title.textContent = 'Pick a game to watch it here.'; status.textContent = ''; legend.replaceChildren(); cell.textContent = ''; tl.max = '0'; tl.value = '0';
      ctx.clearRect?.(0, 0, canvas.width, canvas.height);
    },
  };
}
