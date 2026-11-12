// Canvas hex renderer. Pure drawing: takes a 2D context, a world and frames; no DOM access.
import { ANT_STRIDE } from '../src/core/types.ts';
import type { WorldMap } from '../src/core/types.ts';

const SQRT3 = Math.sqrt(3);

export interface Layout { w: number; h: number; width: number; height: number }
export interface Palette {
  bg: string; rock: string; hill: string[]; food: string; ant: string[]; mark: string[]; carry: string;
}
/** The subset of CanvasRenderingContext2D the viewer uses (so tests can fake it). */
export interface Ctx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  closePath(): void; fill(): void; fillRect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
}
export interface DrawData { food: Uint16Array; marks: Uint8Array; ants: Int32Array }

/** Pixel layout for pointy-top hexes, odd rows shifted right (as in the task spec). */
export function layout(W: number, H: number, w: number): Layout {
  const h = (2 * w) / SQRT3;
  return { w, h, width: Math.ceil((W + 0.5) * w), height: Math.ceil((H * 0.75 + 0.25) * h) };
}
export const center = (L: Layout, x: number, y: number): [number, number] => [(x + 0.5 + (y & 1 ? 0.5 : 0)) * L.w, (y * 0.75 + 0.5) * L.h];

/** Cell under a pixel (nearest hex centre), or -1 outside the board. */
export function cellAt(L: Layout, W: number, H: number, px: number, py: number): number {
  const row = Math.round((py / L.h - 0.5) / 0.75);
  let best = -1, bestD = L.h * L.h;
  for (let y = row - 1; y <= row + 1; y++) {
    if (y < 0 || y >= H) continue;
    const x0 = Math.floor(px / L.w - 0.5 - (y & 1 ? 0.5 : 0));
    for (let x = x0 - 1; x <= x0 + 2; x++) {
      if (x < 0 || x >= W) continue;
      const [cx, cy] = center(L, x, y), d = (cx - px) ** 2 + (cy - py) ** 2;
      if (d < bestD) { bestD = d; best = y * W + x; }
    }
  }
  return best;
}

export const LIGHT: Palette = { bg: '#fafaf9', rock: '#78716c', hill: ['#fecaca', '#bfdbfe'], food: '#16a34a',
  ant: ['#dc2626', '#2563eb'], mark: ['#7f1d1d', '#1e3a8a'], carry: '#ffffff' };
export const DARK: Palette = { bg: '#1c1917', rock: '#57534e', hill: ['#7f1d1d', '#1e3a8a'], food: '#4ade80',
  ant: ['#f87171', '#60a5fa'], mark: ['#fca5a5', '#93c5fd'], carry: '#ffffff' };

export function createViewer(ctx: Ctx, { W, H, rock, hill }: Pick<WorldMap, 'W' | 'H' | 'rock' | 'hill'>,
  L: Layout, colors: Palette) {
  const fixed: [number, number, string][] = []; // [cx, cy, colour] for rocks and hills
  for (let p = 0; p < W * H; p++) {
    const [cx, cy] = center(L, p % W, (p / W) | 0);
    if (rock[p]) fixed.push([cx, cy, colors.rock]);
    else if (hill[p] >= 0) fixed.push([cx, cy, colors.hill[hill[p]] ?? colors.hill[0]]);
  }
  const hex = (cx: number, cy: number): void => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 30), x = cx + (L.h / 2) * Math.cos(a), y = cy + (L.h / 2) * Math.sin(a);
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  const disc = (cx: number, cy: number, r: number): void => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill(); };
  return {
    draw({ food, marks, ants }: DrawData, opts: { marks?: boolean } = {}): void {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, L.width, L.height);
      for (const [cx, cy, c] of fixed) { ctx.fillStyle = c; hex(cx, cy); }
      ctx.fillStyle = colors.food;
      for (let p = 0; p < food.length; p++) {
        if (!food[p] || rock[p]) continue;
        const [cx, cy] = center(L, p % W, (p / W) | 0), s = L.w * (0.3 + 0.5 * Math.min(food[p], 20) / 20);
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      }
      if (opts.marks) {
        const N = W * H, s = L.w * 0.16;
        for (let c = 0; c < marks.length / N; c++) {
          ctx.fillStyle = colors.mark[c] ?? colors.mark[0];
          for (let p = 0; p < N; p++) {
            const m = marks[c * N + p];
            if (!m || rock[p]) continue;
            const [cx, cy] = center(L, p % W, (p / W) | 0);
            for (let k = 0; k < 6; k++) {
              if ((m >> k) & 1) ctx.fillRect(cx + (k - 2.5) * L.w * 0.17 - s / 2, cy + (c ? 1 : -1) * L.h * 0.22 - s / 2, s, s);
            }
          }
        }
      }
      for (let i = 0; i < ants.length; i += ANT_STRIDE) {
        const [cx, cy] = center(L, ants[i + 1] % W, (ants[i + 1] / W) | 0);
        ctx.fillStyle = colors.ant[ants[i + 2]] ?? colors.ant[0];
        disc(cx, cy, L.w * 0.36);
        if (ants[i + 4]) { ctx.fillStyle = colors.carry; disc(cx, cy, L.w * 0.14); }
      }
    },
  };
}
