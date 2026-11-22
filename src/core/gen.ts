// Contest-world generator, task spec section 3.1: 100x100, rocky perimeter, two hexagonal
// anthills (side 6 = 91 cells), ten rocks, eight 3x4 food blobs (5 per cell), >= 1 empty cell
// between non-food elements, nothing overlaps. Rock shape is not in the spec: random growth.
// Symmetric mode (ranked worlds): every element has a twin under the point mirror (x, y) -> (W-1-x, H-1-y), which is a
// symmetry of the hex grid when H is even: the second hill is the first one's twin, rocks and blobs come in mirrored pairs.
import { disk, step } from './hex.ts';
import type { WorldMap } from './types.ts';

export interface WorldConfig {
  W: number; H: number; hillRadius: number; rocks: number; rockSize: readonly [number, number];
  blobs: number; blobW: number; blobH: number; perCell: number;
  /** Point-mirror symmetric (rocks and blobs must be even in number, H even). Absent = the contest generator. */
  symmetric?: boolean;
}

export const CLASSIC_WORLD: Readonly<WorldConfig> = Object.freeze({
  W: 100, H: 100, hillRadius: 5, rocks: 10, rockSize: [8, 30] as [number, number], blobs: 8, blobW: 3, blobH: 4, perCell: 5,
});

/** Ranked worlds: the contest elements, laid out as mirrored pairs. */
export const SYMMETRIC_WORLD: Readonly<WorldConfig> = Object.freeze({ ...CLASSIC_WORLD, symmetric: true });

/** The point mirror (x, y) -> (W-1-x, H-1-y) of cell p = y*W + x in a world of n cells: the index reversed. */
export const twinOf = (n: number, p: number): number => n - 1 - p;

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
  const { W, H, hillRadius, rocks, rockSize, blobs, blobW, blobH, perCell } = cfg, sym = !!cfg.symmetric;
  if (sym && (rocks % 2 || blobs % 2 || H % 2)) throw new Error('symmetric worlds need an even number of rocks and blobs and an even height');
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
  const twin = (shape: [number, number][]): [number, number][] => shape.map(([x, y]) => [W - 1 - x, H - 1 - y]);
  /** Place a shape; in symmetric mode also its twin (as `twinId`), all or nothing. */
  const placeBoth = (shape: [number, number][], id: number, twinId: number): boolean => {
    if (!place(shape, id)) return false;
    if (!sym || place(twin(shape), twinId)) return true;
    shape.forEach(([x, y]) => { owner[at(x, y)] = 0; });
    return false;
  };
  const tries = (make: () => [number, number][], id: number, twinId = id): boolean => {
    for (let i = 0; i < 3000; i++) if (placeBoth(make(), id, twinId)) return true;
    return false;
  };
  const margin = hillRadius + 3;
  const hill = (): [number, number][] => disk(ri(margin, W - 1 - margin), ri(margin, H - 1 - margin), hillRadius);
  if (sym) { if (!tries(hill, 1, 2)) return null; }
  else for (const id of [1, 2]) if (!tries(hill, id)) return null;
  for (let r = 0; r < (sym ? rocks >> 1 : rocks); r++) {
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
  const blob = (cells: [number, number][], mark: number): void => cells.forEach(([x, y]) => { owner[at(x, y)] = mark; food[at(x, y)] = mark ? perCell : 0; });
  for (let b = 0; b < (sym ? blobs >> 1 : blobs); b++) {
    let ok = false;
    for (let i = 0; i < 3000 && !ok; i++) {
      const [w, h] = (next() & 1) === 0 ? [blobW, blobH] : [blobH, blobW];
      const x0 = ri(1, W - 1 - w), y0 = ri(1, H - 1 - h), cells: [number, number][] = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push([x, y]);
      if (!cells.every(([x, y]) => owner[at(x, y)] === 0)) continue;
      blob(cells, 4);
      if (sym) {
        const t = twin(cells);
        if (!t.every(([x, y]) => owner[at(x, y)] === 0)) { blob(cells, 0); continue; }
        blob(t, 4);
      }
      ok = true;
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

/** The point mirror maps rock to rock, food to food, hill 0 to hill 1 and back: what a ranked world must satisfy. */
export function isSymmetric({ W, H, rock, food, hill }: WorldMap): boolean {
  if (H % 2) return false;
  for (let p = 0; p < W * H; p++) {
    const q = twinOf(W * H, p);
    if (rock[p] !== rock[q] || food[p] !== food[q] || hill[q] !== (hill[p] < 0 ? -1 : 1 - hill[p])) return false;
  }
  return true;
}

// ---------------------------------------------------------------- fair worlds for 3 or more colonies
// The point mirror above gives two colonies the same surroundings. For n colonies the same is done with translations: a tile holding
// one hill, some rocks and some food is generated on its own torus and repeated across x tiles by down y tiles (across * down = n)
// on a wrapped world. Shifting the map by a tile maps it onto itself, rock for rock and food for food, and takes hill 0 to any other
// hill, so every colony has the same terrain (`isShiftSymmetric`; the point mirror above is `isSymmetric`). That is a sufficient condition for a
// fair world, not the definition: whether identical brains win equally often from every colony is measured (`src/fairness.ts`, docs/MATCH.md).
// These worlds have no rock border: they need the wrapped play the simulator does by default, and they are not files for the official engine.

export interface FairLayout { across: number; down: number; w: number; h: number; hillRadius: number }
const TILE_MAX = 50, TILE_MIN = 16, SIDE_MAX = 200;
/** The largest tile side that fits k times into SIDE_MAX (integer arithmetic only: core has no division). */
const fit = (k: number): number => { let s = 0; while ((s + 1) * k <= SIDE_MAX && s < TILE_MAX) s++; return s; };

/** How n colonies are tiled, or null when no tiling gives tiles of at least 16 cells a side (n = 13, 17, 19, 23, 26 and beyond). */
export function fairLayout(n: number): FairLayout | null {
  if (!Number.isInteger(n) || n < 2 || n > 26) throw new RangeError('colonies must be 2 to 26');
  // the tiling with the biggest smaller tile side, then the biggest tile, then the squarest world
  let best: FairLayout | null = null, bestKey: [number, number, number] = [0, 0, 0];
  for (let across = 1; across <= n; across++) {
    for (let down = 1; down <= n; down++) {
      if (across * down !== n) continue;
      const w = fit(across), h = fit(down) & ~1, m = Math.min(w, h);
      if (m < TILE_MIN) continue;
      const key: [number, number, number] = [m, w * h, -Math.abs(across * w - down * h)];
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
        bestKey = key; best = { across, down, w, h, hillRadius: m >= 44 ? 5 : m >= 30 ? 4 : m >= 22 ? 3 : 2 };
      }
    }
  }
  return best;
}

/** Deterministic: the same (n, seed) always gives the same world. */
export function generateFairWorld(n: number, seed: number): WorldMap {
  const lay = fairLayout(n);
  if (!lay) throw new RangeError(`no fair world for ${n} colonies: its tiles would be smaller than ${TILE_MIN} cells a side`);
  for (let attempt = 0; attempt < 200; attempt++) {
    const tile = attemptTile(mulberry32(seed + attempt), lay);
    if (!tile) continue;
    const map = tileMap(tile, lay);
    if (reachableOnTorus(map)) return map;
  }
  throw new Error(`no valid fair world for ${n} colonies, seed ${seed}`);
}

interface Tile { rock: Uint8Array; food: Uint16Array; hill: Uint8Array }

/** One tile on its own torus: the hill in the middle, then rocks, then food blobs, as in the contest generator. */
function attemptTile(next: () => number, { w, h, hillRadius }: FairLayout): Tile | null {
  const small = hillRadius < 4, tiny = hillRadius < 3;
  const rocks = tiny ? 1 : small ? 2 : hillRadius === 4 ? 2 : 3, rockSize: [number, number] = tiny ? [3, 8] : small ? [4, 12] : [8, 24];
  const blobs = tiny ? 2 : small ? 3 : 4, perCell = 5;
  const N = w * h, owner = new Uint8Array(N); // 0 empty, 1 hill, 3 rock, 4 food
  const food = new Uint16Array(N);
  const ri = (lo: number, hi: number): number => lo + (next() % (hi - lo + 1));
  const wrap = (x: number, y: number): number => (((y % h) + h) % h) * w + (((x % w) + w) % w);
  const roomy = (x: number, y: number): boolean => owner[wrap(x, y)] === 0 && [0, 1, 2, 3, 4, 5].every((d) => { const [nx, ny] = step(x, y, d); return owner[wrap(nx, ny)] === 0; });
  const unique = (cells: [number, number][]): boolean => new Set(cells.map(([x, y]) => wrap(x, y))).size === cells.length;
  const place = (cells: [number, number][], id: number): boolean => {
    if (!unique(cells) || !cells.every(([x, y]) => roomy(x, y))) return false;
    cells.forEach(([x, y]) => { owner[wrap(x, y)] = id; });
    return true;
  };
  if (!place(disk(w >> 1, (h >> 1) & ~1, hillRadius), 1)) return null;
  for (let r = 0; r < rocks; r++) {
    let ok = false;
    for (let i = 0; i < 3000 && !ok; i++) {
      const cells: [number, number][] = [[ri(0, w - 1), ri(0, h - 1)]], seen = new Set([wrap(...cells[0])]);
      for (let want = ri(rockSize[0], rockSize[1]), guard = 0; cells.length < want && guard < 500; guard++) {
        const [x, y] = cells[ri(0, cells.length - 1)], [nx, ny] = step(x, y, ri(0, 5)), key = wrap(nx, ny);
        if (!seen.has(key)) { seen.add(key); cells.push([nx, ny]); }
      }
      ok = place(cells, 3);
    }
    if (!ok) return null;
  }
  for (let b = 0; b < blobs; b++) {
    let ok = false;
    for (let i = 0; i < 3000 && !ok; i++) {
      const [bw, bh] = (next() & 1) === 0 ? [3, 4] : [4, 3], x0 = ri(0, w - 1), y0 = ri(0, h - 1), cells: [number, number][] = [];
      for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) cells.push([x, y]);
      if (!unique(cells) || !cells.every(([x, y]) => owner[wrap(x, y)] === 0)) continue;
      cells.forEach(([x, y]) => { owner[wrap(x, y)] = 4; food[wrap(x, y)] = perCell; });
      ok = true;
    }
    if (!ok) return null;
  }
  const rock = new Uint8Array(N), hill = new Uint8Array(N);
  for (let p = 0; p < N; p++) { rock[p] = owner[p] === 3 ? 1 : 0; hill[p] = owner[p] === 1 ? 1 : 0; }
  return { rock, food, hill };
}

/** The tile repeated across x down times; hill label = row of tiles * across + column. */
function tileMap(t: Tile, { across, down, w, h }: FairLayout): WorldMap {
  const W = across * w, H = down * h, N = W * H;
  const map: WorldMap = { W, H, rock: new Uint8Array(N), food: new Uint16Array(N), hill: new Int8Array(N).fill(-1) };
  for (let ty = 0; ty < down; ty++) {
    for (let tx = 0; tx < across; tx++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const from = y * w + x, to = (ty * h + y) * W + tx * w + x;
          map.rock[to] = t.rock[from]; map.food[to] = t.food[from];
          if (t.hill[from]) map.hill[to] = ty * across + tx;
        }
      }
    }
  }
  return map;
}

/** Every food cell and every hill reachable from hill 0 without crossing rock, walking round the edges of the world. */
export function reachableOnTorus({ W, H, rock, food, hill }: WorldMap): boolean {
  const N = W * H, seen = new Uint8Array(N), qx: number[] = [], qy: number[] = [];
  const start = hill.findIndex((v: number) => v === 0);
  if (start < 0) return false;
  seen[start] = 1; qx.push(start % W); qy.push(0);
  for (let y = 0; y < H; y++) if (start >= y * W && start < (y + 1) * W) qy[0] = y;
  for (let i = 0; i < qx.length; i++) {
    for (let d = 0; d < 6; d++) {
      const [nx, ny] = step(qx[i], qy[i], d), x = ((nx % W) + W) % W, y = ((ny % H) + H) % H, q = y * W + x;
      if (!rock[q] && !seen[q]) { seen[q] = 1; qx.push(x); qy.push(y); }
    }
  }
  return food.every((f: number, p: number) => !f || seen[p]) && hill.every((v: number, p: number) => v < 0 || seen[p]);
}

/** Fair for every colony: for each hill there is a shift of the wrapped world (an even number of rows, so the rows keep their
 * offsets) that maps rock to rock, food to food, and hill 0 exactly onto that hill (and, for that reason, every other hill onto a hill). */
export function isShiftSymmetric({ W, H, rock, food, hill }: WorldMap): boolean {
  if (H % 2) return false;
  const first = new Map<number, [number, number]>();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const l = hill[y * W + x]; if (l >= 0 && !first.has(l)) first.set(l, [x, y]); }
  const n = first.size;
  if (n < 2 || ![...first.keys()].every((l) => l < n)) return false;
  const [x0, y0] = first.get(0) as [number, number];
  for (let c = 1; c < n; c++) {
    const [xc, yc] = first.get(c) as [number, number], dx = (xc - x0 + W) % W, dy = (yc - y0 + H) % H;
    if (dy % 2) return false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x, q = ((y + dy) % H) * W + ((x + dx) % W);
        if (rock[p] !== rock[q] || food[p] !== food[q] || (hill[p] === 0) !== (hill[q] === c)) return false; // (so every hill is hill 0's image)
      }
    }
  }
  return true;
}
