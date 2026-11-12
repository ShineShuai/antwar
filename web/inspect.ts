// Plain-text description of one cell, for the click inspector.
import { ANT_STRIDE } from '../src/core/types.ts';
import type { Frame } from '../src/core/types.ts';

const DIRS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];
const NAMES = 'AB';

export function describeCell(f: Pick<Frame, 'food' | 'marks' | 'ants'>, W: number, H: number, p: number): string {
  const N = W * H, parts = [`cell ${p % W},${(p / W) | 0}`];
  if (f.food[p]) parts.push(`food ${f.food[p]}`);
  for (let c = 0; c < f.marks.length / N; c++) {
    const m = f.marks[c * N + p], on = [0, 1, 2, 3, 4, 5].filter((k) => (m >> k) & 1);
    if (on.length) parts.push(`scent ${NAMES[c]}: ${on.join(',')}`);
  }
  for (let i = 0; i < f.ants.length; i += ANT_STRIDE) {
    if (f.ants[i + 1] !== p) continue;
    const [id, , col, dir, has, state] = f.ants.slice(i, i + ANT_STRIDE);
    parts.push(`ant #${id} (${NAMES[col]}) state ${state}, facing ${DIRS[dir]}, carrying ${has}`);
  }
  return parts.join(' | ');
}
