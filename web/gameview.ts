// A game viewer for any page: canvas, play/pause, speed, timeline, status, and a click inspector, driven by a WatchSpec (src/watch.ts).
// The replay loop is web/replay-controller.ts, the same one the workshop uses; this file is the canvas and the controls on top of it.
import type { WatchSpec } from '../src/watch.ts';
import { describeCell } from './inspect.ts';
import { paletteFor, statusLine } from './colonies.ts';
import { createReplayController } from './replay-controller.ts';
import type { Frame, ReplayWorker } from './replay-controller.ts';
import { cellAt, createViewer, layout } from './viewer.ts';

export type GameViewWorker = ReplayWorker;
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
  let spec: WatchSpec | undefined, viewer: ReturnType<typeof createViewer> | undefined;
  let geom: { L: ReturnType<typeof layout>; W: number; H: number } | undefined, scrubbing = false;
  const isDark = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const say = (t: string, err = false): void => { status.textContent = t; status.className = err ? 'err' : ''; };
  const rc = createReplayController({ makeWorker: o.makeWorker ?? defaultWorker, speed: () => Number(speed.value) }, {
    ready(m) {
      if (!spec) return;
      const w = Math.max(3, Math.min(10, Math.floor((o.maxWidth ?? 600) / (m.W + 1)))), L = layout(m.W, m.H, w);
      canvas.width = L.width; canvas.height = L.height; geom = { L, W: m.W, H: m.H };
      viewer = createViewer(ctx, m, L, paletteFor(spec.hills.length, isDark()));
    },
    frame(f: Frame) {
      if (!spec) return;
      if (!scrubbing) tl.value = String(f.cycle);
      viewer?.draw(f, { marks: marksBox.checked });
      say(statusLine(f.cycle, f.score, f.alive, spec.rounds));
    },
    error(message) { say(message, true); },
    running(on) { play.textContent = on ? '\u275a\u275a Pause' : '\u25b6 Play'; },
  });

  play.onclick = () => { if (!spec) return; if (rc.cycle >= spec.rounds) rc.seek(0); rc.toggle(); };
  end.onclick = () => { if (spec) rc.seek(spec.rounds); };
  tl.oninput = () => rc.seek(Number(tl.value));
  tl.onpointerdown = () => { scrubbing = true; };
  addEventListener('pointerup', () => { scrubbing = false; });
  marksBox.onchange = () => { if (rc.last) viewer?.draw(rc.last, { marks: marksBox.checked }); };
  canvas.onclick = (e) => {
    const last = rc.last;
    if (!geom || !last) return;
    const r = canvas.getBoundingClientRect();
    const p = cellAt(geom.L, geom.W, geom.H, ((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height);
    cell.textContent = p < 0 ? '' : describeCell(last, geom.W, geom.H, p);
  };

  return {
    load(s) {
      spec = s; viewer = undefined; geom = undefined;
      tl.max = String(s.rounds); tl.value = '0'; cell.textContent = ''; title.textContent = s.title;
      const colors = paletteFor(s.hills.length, isDark()).ant;
      legend.replaceChildren(...s.hills.map((h, c) => { const chip = el('span', `\u25a0 ${String.fromCharCode(65 + c)}: ${h}   `); chip.style.color = colors[c]; return chip; }));
      say('Loading\u2026');
      rc.load({ type: 'init', seed: s.seed, mapText: s.mapText, rules: s.rules, brains: s.brains }, { rounds: s.rounds });
    },
    clear() {
      rc.destroy(); spec = undefined; viewer = undefined; geom = undefined;
      title.textContent = 'Pick a game to watch it here.'; status.textContent = ''; legend.replaceChildren(); cell.textContent = ''; tl.max = '0'; tl.value = '0';
      ctx.clearRect?.(0, 0, canvas.width, canvas.height);
    },
  };
}
