// Plain-text description of one cell, for the click inspector.
import { step } from '../src/core/hex.ts';
import { ANT_STRIDE } from '../src/core/types.ts';
import type { Frame } from '../src/core/types.ts';

const DIRS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];
const letter = (c: number): string => String.fromCharCode(65 + c);

export function describeCell(f: Pick<Frame, 'food' | 'marks' | 'ants'>, W: number, H: number, p: number): string {
  const N = W * H, parts = [`cell ${p % W},${(p / W) | 0}`];
  if (f.food[p]) parts.push(`food ${f.food[p]}`);
  for (let c = 0; c < f.marks.length / N; c++) {
    const m = f.marks[c * N + p], on = [0, 1, 2, 3, 4, 5].filter((k) => (m >> k) & 1);
    if (on.length) parts.push(`scent ${letter(c)}: ${on.join(',')}`);
  }
  for (let i = 0; i < f.ants.length; i += ANT_STRIDE) {
    if (f.ants[i + 1] !== p) continue;
    const [id, , col, dir, has, state] = f.ants.slice(i, i + ANT_STRIDE);
    parts.push(`ant #${id} (${letter(col)}) state ${state}, facing ${DIRS[dir]}, carrying ${has}`);
  }
  return parts.join(' | ');
}

export interface SenseRow { name: string; cell: number; text: string }

/** What an ant can sense (its four sense directions) and what its own scents say there, for the debugger: here, ahead, left ahead, right ahead.
 * `ant` is the row of the ant in `f.ants`; the world's rock and hills are what the replay engine reported when it was ready. */
export function senses(f: Pick<Frame, 'food' | 'marks' | 'ants'>, world: { W: number; H: number; rock: ArrayLike<number>; hill: ArrayLike<number> }, ant: number): SenseRow[] {
  const { W, H } = world, N = W * H, p = f.ants[ant + 1], col = f.ants[ant + 2], dir = f.ants[ant + 3];
  const at = (q: number): string => {
    const parts: string[] = [];
    if (world.rock[q]) return 'rock';
    if (world.hill[q] >= 0) parts.push(`hill ${letter(world.hill[q])}${world.hill[q] === col ? ' (home)' : ''}`);
    if (f.food[q]) parts.push(`food ${f.food[q]}`);
    for (let c = 0; c < f.marks.length / N; c++) {
      const on = [0, 1, 2, 3, 4, 5].filter((k) => (f.marks[c * N + q] >> k) & 1);
      if (on.length) parts.push(`${c === col ? 'own' : `foe ${letter(c)}`} scent ${on.join(',')}`);
    }
    for (let i = 0; i < f.ants.length; i += ANT_STRIDE) if (f.ants[i + 1] === q && i !== ant) parts.push(`ant #${f.ants[i]} (${letter(f.ants[i + 2])})`);
    return parts.length ? parts.join(', ') : 'empty';
  };
  const x = p % W, y = (p / W) | 0;
  const toward = (d: number): number => { const [nx, ny] = step(x, y, d); return (((ny % H) + H) % H) * W + (((nx % W) + W) % W); };
  return ([['here', p], ['ahead', toward(dir)], ['left ahead', toward((dir + 5) % 6)], ['right ahead', toward((dir + 1) % 6)]] as const).map(([name, cell]) => ({ name, cell, text: at(cell) }));
}
