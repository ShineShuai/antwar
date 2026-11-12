// Contest-world generator, task spec section 3.1: 100x100, rocky perimeter, two hexagonal
// anthills (side 6 = 91 cells), ten rocks, eight 3x4 food blobs (5 per cell), >= 1 empty cell
// between non-food elements, nothing overlaps. Rock shape is not in the spec: random growth.
import { disk, step } from './hex.ts';
import type { WorldMap } from './types.ts';

export interface WorldConfig {
  W: number; H: number; hillRadius: number; rocks: number; rockSize: readonly [number, number];
  blobs: number; blobW: number; blobH: number; perCell: number;
}

export const CLASSIC_WORLD: Readonly<WorldConfig> = Object.freeze({
  W: 100, H: 100, hillRadius: 5, rocks: 10, rockSize: [8, 30] as [number, number], blobs: 8, blobW: 3, blobH: 4, perCell: 5,
});

/** Generator version: bump when output for a given seed changes. */
export const GENERATOR_VERSION = 2;

/** mulberry32: a deterministic integer-only stream of u32 values. */
const mulberry32 = (a: number) => (): number => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
};

/** Deterministic: same (seed, cfg) -> same world. A failed attempt retries with seed + 1. */
export function generateWorld(seed: number, cfg: WorldConfig = CLASSIC_WORLD): WorldMap {
  for (let attempt = 0; attempt < 100; attempt++) {
    const map = attemptWorld(mulberry32(seed + attempt), cfg);
    if (map) return map;
  }
  throw new Error(`no valid world for seed ${seed}`);
}

function attemptWorld(next: () => number, cfg: WorldConfig): WorldMap | null {
  const { W, H, hillRadius, rocks, rockSize, blobs, blobW, blobH, perCell } = cfg;
  const N = W * H, owner = new Uint8Array(N); // 0 empty, 1 hill0, 2 hill1, 3 rock, 4 food
  const ri = (lo: number, hi: number): number => lo + (next() % (hi - lo + 1));
  const at = (x: number, y: number): number => y * W + x;
  // A non-food cell needs: off the perimeter ring, empty, and all six neighbours empty.
  const roomy = (x: number, y: number): boolean => x >= 2 && x < W - 2 && y >= 2 && y < H - 2 && owner[at(x, y)] === 0
    && [0, 1, 2, 3, 4, 5].every((d) => { const [nx, ny] = step(x, y, d); return owner[at(nx, ny)] === 0; });
  const place = (shape: [number, number][], id: number): boolean => {
    if (!shape.every(([x, y]) => roomy(x, y))) return false;
    shape.forEach(([x, y]) => { owner[at(x, y)] = id; });
    return true;
  };
  const tries = (make: () => [number, number][], id: number): boolean => {
    for (let i = 0; i < 3000; i++) if (place(make(), id)) return true;
    return false;
  };
  const margin = hillRadius + 3;
  for (const id of [1, 2]) {
    if (!tries(() => disk(ri(margin, W - 1 - margin), ri(margin, H - 1 - margin), hillRadius), id)) return null;
  }
  for (let r = 0; r < rocks; r++) {
    const rock = () => {
      const cells: [number, number][] = [[ri(3, W - 4), ri(3, H - 4)]], seen = new Set([cells[0].join()]);
      for (let want = ri(rockSize[0], rockSize[1]), guard = 0; cells.length < want && guard < 500; guard++) {
        const [x, y] = cells[ri(0, cells.length - 1)], [nx, ny] = step(x, y, ri(0, 5));
        if (!seen.has(`${nx},${ny}`)) { seen.add(`${nx},${ny}`); cells.push([nx, ny]); }
      }
      return cells;
    };
    if (!tries(rock, 3)) return null;
  }
  const food = new Uint16Array(N);
  for (let b = 0; b < blobs; b++) {
    let ok = false;
    for (let i = 0; i < 3000 && !ok; i++) {
      const [w, h] = (next() & 1) === 0 ? [blobW, blobH] : [blobH, blobW];
      const x0 = ri(1, W - 1 - w), y0 = ri(1, H - 1 - h), cells = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push([x, y]);
      if (cells.every(([x, y]) => owner[at(x, y)] === 0)) {
        cells.forEach(([x, y]) => { owner[at(x, y)] = 4; food[at(x, y)] = perCell; });
        ok = true;
      }
    }
    if (!ok) return null;
  }
  const map: WorldMap = { W, H, rock: new Uint8Array(N), food, hill: new Int8Array(N).fill(-1) };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = owner[at(x, y)];
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || o === 3) map.rock[at(x, y)] = 1;
      else if (o === 1 || o === 2) map.hill[at(x, y)] = o - 1;
    }
  }
  return allReachable(map) ? map : null;
}

/** Every food cell and the second hill reachable from the first hill without crossing rock. */
export function allReachable({ W, H, rock, food, hill }: WorldMap): boolean {
  const start = hill.findIndex((h: number) => h === 0), seen = new Uint8Array(W * H);
  const qx: number[] = [start % W], qy: number[] = [0]; // y is recovered by counting rows below
  qy[0] = 0;
  for (let y = 0; y < H; y++) if (start >= y * W && start < (y + 1) * W) qy[0] = y;
  seen[start] = 1;
  for (let i = 0; i < qx.length; i++) {
    for (let d = 0; d < 6; d++) {
      const [nx, ny] = step(qx[i], qy[i], d), q = ny * W + nx;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && !rock[q] && !seen[q]) { seen[q] = 1; qx.push(nx); qy.push(ny); }
    }
  }
  return food.every((f: number, p: number) => !f || seen[p]) && hill.every((h: number, p: number) => h !== 1 || seen[p]);
}
