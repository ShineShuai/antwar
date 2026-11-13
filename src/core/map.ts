import type { WorldMap } from './types.ts';

/** Spec limits (World tab): 3..200 cells per side, even height (row parity must survive the wrap). */
export const MAX_SIDE = 200;

// World files: ICFP format (W, H, then H rows of space-separated cells) and a-z hills.
// '#' rock, '.' clear, '+' / '-' hills 0 / 1, 'a'..'z' hill 0..25, '1'..'9' food.
export function parseMap(text: string): WorldMap {
  const rows = text.split(/\r?\n/).filter((l: string) => l.trim());
  const W = Number(rows[0]), H = Number(rows[1]);
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 3 || H < 3 || W > MAX_SIDE || H > MAX_SIDE || H % 2) {
    throw new Error(`bad world size ${rows[0]}x${rows[1]}: 3..${MAX_SIDE} cells per side, height even`);
  }
  if (rows.length - 2 !== H) throw new Error(`expected ${H} rows, got ${rows.length - 2}`);
  const N = W * H;
  const map: WorldMap = { W, H, rock: new Uint8Array(N), food: new Uint16Array(N), hill: new Int8Array(N).fill(-1) };
  rows.slice(2).forEach((row: string, y: number) => {
    const cells = row.replace(/\s+/g, '');
    if (cells.length !== W) throw new Error(`row ${y}: expected ${W} cells`);
    [...cells].forEach((c, x) => {
      const p = y * W + x;
      if (c === '#') map.rock[p] = 1;
      else if (c === '+') map.hill[p] = 0;
      else if (c === '-') map.hill[p] = 1;
      else if (/[a-z]/.test(c)) map.hill[p] = c.charCodeAt(0) - 97;
      else if (/[1-9]/.test(c)) map.food[p] = +c;
      else if (c !== '.') throw new Error(`row ${y}: bad cell "${c}"`);
    });
  });
  return map;
}

/** Inverse of parseMap in the official layout (even rows get a leading space). */
export function formatMap({ W, H, rock, food, hill }: WorldMap): string {
  const rows = [String(W), String(H)];
  for (let y = 0; y < H; y++) {
    const cells = [];
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      cells.push(rock[p] ? '#' : hill[p] >= 0 ? '+-'[hill[p]] ?? String.fromCharCode(97 + hill[p])
        : food[p] ? String(food[p]) : '.');
    }
    rows.push((y % 2 === 0 ? ' ' : '') + cells.join(' '));
  }
  return rows.join('\n') + '\n';
}
