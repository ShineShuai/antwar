// The map designer's model: a world as three arrays, brushes with symmetry, undo, and the checks of a map. Pure: no DOM, so it is tested
// in Node; web/maps.ts draws it and turns pointer events into strokes.
import { CLASSIC_WORLD, SYMMETRIC_WORLD, allReachable, fairLayout, generateFairWorld, generateWorld, isShiftSymmetric, isSymmetric, reachableOnTorus } from '../src/core/gen.ts';
import type { FairLayout, WorldConfig } from '../src/core/gen.ts';
import { disk, step } from '../src/core/hex.ts';
import { MAX_SIDE, formatMap, parseMap } from '../src/core/map.ts';
import type { WorldMap } from '../src/core/types.ts';

export const MIN_SIDE = 3, MAX_CELLS = 65535, MAX_FOOD = 9;

/** An editable world: rock (0/1), food per cell (0..9, what the map text can say), hill label (-1 none, 0 = A, ...). */
export interface Doc { W: number; H: number; rock: Uint8Array; food: Uint8Array; hill: Int8Array }

export function newDoc(W: number, H: number): Doc {
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < MIN_SIDE || H < MIN_SIDE || W > MAX_SIDE || H > MAX_SIDE) throw new RangeError(`a world is ${MIN_SIDE} to ${MAX_SIDE} cells a side`);
  if (H % 2) throw new RangeError('the height must be even (the rows alternate, and the world wraps)');
  if (W * H > MAX_CELLS) throw new RangeError(`at most ${MAX_CELLS} cells`);
  return { W, H, rock: new Uint8Array(W * H), food: new Uint8Array(W * H), hill: new Int8Array(W * H).fill(-1) };
}
export const docOf = (m: WorldMap): Doc => ({ W: m.W, H: m.H, rock: Uint8Array.from(m.rock), food: Uint8Array.from(m.food, (f) => Math.min(f, MAX_FOOD)), hill: Int8Array.from(m.hill) });
export const mapOf = (d: Doc): WorldMap => ({ W: d.W, H: d.H, rock: Uint8Array.from(d.rock), food: Uint16Array.from(d.food), hill: Int8Array.from(d.hill) });
export const textOf = (d: Doc): string => formatMap(mapOf(d));
/** A map text (the contest's world file: width, height, then one line per row) as a document; says what is wrong with anything else. */
export function docFromText(text: string): Doc {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 3 || !/^\d+$/.test(lines[0].trim()) || !/^\d+$/.test(lines[1].trim())) throw new RangeError('this is not a world file: the first two lines are the width and the height, then one line per row');
  return docOf(parseMap(text));
}
const copyDoc = (d: Doc): Doc => ({ W: d.W, H: d.H, rock: d.rock.slice(), food: d.food.slice(), hill: d.hill.slice() });

// ---------- symmetry
/** none; the point mirror (x, y) -> (W-1-x, H-1-y), which swaps hills A and B; or tiles: the world is across x down tiles of w x h cells, and
 * what is drawn in one tile is drawn in all (the hill of tile t is colony t, row by row: the fair worlds of generateFairWorld). */
export type Symmetry = { mode: 'none' } | { mode: 'mirror' } | ({ mode: 'shift' } & Pick<FairLayout, 'across' | 'down' | 'w' | 'h'>);

/** The tile layout for n colonies as a symmetry, or null when n cannot be tiled (13, 17, 19, 23, 26). */
export function shiftFor(n: number): Extract<Symmetry, { mode: 'shift' }> | null {
  const l = fairLayout(n);
  return l ? { mode: 'shift', across: l.across, down: l.down, w: l.w, h: l.h } : null;
}
export const sizeOfShift = (s: Extract<Symmetry, { mode: 'shift' }>): [number, number] => [s.across * s.w, s.down * s.h];

/** A cell and its copies under the symmetry, each with the hill label that a brush of label `c` leaves there. */
export function copies(d: Doc, p: number, c: number, sym: Symmetry): { p: number; label: number }[] {
  const x = p % d.W, y = (p / d.W) | 0;
  if (sym.mode === 'mirror') return [{ p, label: c }, ...(d.W - 1 - x === x && d.H - 1 - y === y ? [] : [{ p: (d.H - 1 - y) * d.W + (d.W - 1 - x), label: c === 0 ? 1 : c === 1 ? 0 : c }])];
  if (sym.mode === 'shift') {
    const out: { p: number; label: number }[] = [];
    for (let j = 0; j < sym.down; j++) for (let i = 0; i < sym.across; i++) {
      const qx = (x + i * sym.w) % d.W, qy = (y + j * sym.h) % d.H;
      out.push({ p: qy * d.W + qx, label: Math.floor(qy / sym.h) * sym.across + Math.floor(qx / sym.w) });
    }
    return out;
  }
  return [{ p, label: c }];
}

// ---------- brushes
export type Tool = 'rock' | 'food' | 'hill' | 'erase';
export interface Brush { tool: Tool; /** cells within this hex distance of the pointer: 0, 1 or 2 */ radius: number; food: number; label: number; sym: Symmetry }

/** The cells of a brush at p (clipped at the edges of the world). */
export function brushCells(d: Doc, p: number, radius: number): number[] {
  const out: number[] = [];
  for (const [x, y] of disk(p % d.W, (p / d.W) | 0, radius)) if (x >= 0 && x < d.W && y >= 0 && y < d.H) out.push(y * d.W + x);
  return out;
}

/** Paints a brush stroke at p; returns the cells that changed (to redraw them). Rock and food do not go onto a hill (erase it first); a hill clears rock and food. */
export function paint(d: Doc, p: number, b: Brush): number[] {
  const changed = new Set<number>();
  for (const base of brushCells(d, p, b.radius)) {
    for (const { p: q, label } of copies(d, base, b.label, b.sym)) {
      const before = [d.rock[q], d.food[q], d.hill[q]];
      if (b.tool === 'rock') { if (d.hill[q] < 0) { d.rock[q] = 1; d.food[q] = 0; } }
      else if (b.tool === 'food') { if (!d.rock[q] && d.hill[q] < 0) d.food[q] = Math.max(1, Math.min(MAX_FOOD, b.food)); }
      else if (b.tool === 'hill') { d.rock[q] = 0; d.food[q] = 0; d.hill[q] = label; }
      else { d.rock[q] = 0; d.food[q] = 0; d.hill[q] = -1; }
      if (before[0] !== d.rock[q] || before[1] !== d.food[q] || before[2] !== d.hill[q]) changed.add(q);
    }
  }
  return [...changed];
}

/** Rock on every cell of the edge (the contest's engine needs a border; the world wraps without one). A hill on the edge stays; food on the edge goes. */
export function addBorder(d: Doc): number[] {
  const changed: number[] = [];
  for (let y = 0; y < d.H; y++) for (let x = 0; x < d.W; x++) {
    if (x !== 0 && y !== 0 && x !== d.W - 1 && y !== d.H - 1) continue;
    const q = y * d.W + x;
    if (d.hill[q] >= 0 || d.rock[q]) continue;
    d.rock[q] = 1; d.food[q] = 0; changed.push(q);
  }
  return changed;
}
export const hasBorder = (d: Doc): boolean => {
  for (let y = 0; y < d.H; y++) for (let x = 0; x < d.W; x++) if ((x === 0 || y === 0 || x === d.W - 1 || y === d.H - 1) && !d.rock[y * d.W + x] && d.hill[y * d.W + x] < 0) return false;
  return true;
};

// ---------- undo
/** Snapshots before each change; `undo` and `redo` hand back the document to show (a new object: the sizes may differ). */
export class History {
  private past: Doc[] = []; private future: Doc[] = [];
  private readonly limit: number;
  constructor(limit = 100) { this.limit = limit; }
  /** Remember `d` as it is now, before a change. */
  push(d: Doc): void { this.past.push(copyDoc(d)); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  undo(current: Doc): Doc | undefined { const d = this.past.pop(); if (d) this.future.push(copyDoc(current)); return d; }
  redo(current: Doc): Doc | undefined { const d = this.future.pop(); if (d) this.past.push(copyDoc(current)); return d; }
}

// ---------- generators
export type Generator = { kind: 'contest' | 'mirror'; seed: number; cfg?: Partial<WorldConfig> } | { kind: 'fair'; seed: number; colonies: number };
export function generate(g: Generator): Doc {
  if (g.kind === 'fair') return docOf(generateFairWorld(g.colonies, g.seed));
  return docOf(generateWorld(g.seed, { ...(g.kind === 'mirror' ? SYMMETRIC_WORLD : CLASSIC_WORLD), ...g.cfg }));
}

// ---------- checks
export interface Check { id: string; level: 'ok' | 'warn' | 'bad' | 'info'; text: string }
const letter = (c: number): string => String.fromCharCode(65 + c);

/** Cells at the same walking distance (round the world, not through rock) from the hill nearest to them: food is counted for the nearest
 * hill, shared when two are equally near. */
export function nearestFood(d: Doc, colonies: number): number[] {
  const N = d.W * d.H, dist = new Int32Array(N).fill(-1), owner = new Int32Array(N).fill(-1); // owner: hill label, -2 = tie
  const queue: number[] = [];
  for (let p = 0; p < N; p++) if (d.hill[p] >= 0) { dist[p] = 0; owner[p] = d.hill[p]; queue.push(p); }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], x = p % d.W, y = (p / d.W) | 0;
    for (let k = 0; k < 6; k++) {
      const [nx, ny] = step(x, y, k), q = (((ny % d.H) + d.H) % d.H) * d.W + (((nx % d.W) + d.W) % d.W);
      if (d.rock[q]) continue;
      if (dist[q] < 0) { dist[q] = dist[p] + 1; owner[q] = owner[p]; queue.push(q); }
      else if (dist[q] === dist[p] + 1 && owner[q] !== owner[p]) owner[q] = -2;
    }
  }
  const per = new Array<number>(colonies).fill(0);
  for (let p = 0; p < N; p++) {
    if (!d.food[p] || owner[p] === -1) continue;
    if (owner[p] >= 0) per[owner[p]] += d.food[p];
    else for (let c = 0; c < colonies; c++) per[c] += d.food[p] / colonies; // a tie: shared (rare; the split is rough)
  }
  return per;
}

/** What a designer wants to know about a map: can it be played, is it the same for every colony, how much food is where. */
export function checks(d: Doc): Check[] {
  const out: Check[] = [], N = d.W * d.H, m = mapOf(d);
  const counts = new Map<number, number>();
  for (const h of d.hill) if (h >= 0) counts.set(h, (counts.get(h) ?? 0) + 1);
  const colonies = counts.size === 0 ? 0 : Math.max(...counts.keys()) + 1;
  out.push({ id: 'size', level: 'info', text: `${d.W} x ${d.H} cells (${N})` });
  if (counts.size < 2) { out.push({ id: 'colonies', level: 'bad', text: counts.size === 0 ? 'no hills: a match needs at least two' : 'one hill: a match needs at least two' }); return out; }
  const gaps = Array.from({ length: colonies }, (_, c) => c).filter((c) => !counts.has(c));
  if (gaps.length) { out.push({ id: 'colonies', level: 'bad', text: `hill ${gaps.map(letter).join(', ')} is missing: the colonies are the hills A, B, C... without a gap` }); return out; }
  out.push({ id: 'colonies', level: 'ok', text: `${colonies} colonies (hills ${Array.from({ length: colonies }, (_, c) => letter(c)).join(', ')})` });
  const sizes = Array.from({ length: colonies }, (_, c) => counts.get(c) as number);
  out.push(new Set(sizes).size === 1 ? { id: 'hills', level: 'ok', text: `every hill has ${sizes[0]} cells` } : { id: 'hills', level: 'warn', text: `hill sizes differ: ${sizes.map((s, c) => `${letter(c)} ${s}`).join(', ')}` });
  const total = d.food.reduce((a, f) => a + f, 0), near = nearestFood(d, colonies), even = near.every((f) => Math.abs(f - near[0]) < 1e-9);
  out.push(total === 0 ? { id: 'food', level: 'bad', text: 'no food' } : { id: 'food', level: even ? 'ok' : 'warn',
    text: `food ${total}; nearest to each hill: ${near.map((f, c) => `${letter(c)} ${Math.round(f * 10) / 10}`).join(', ')}${even ? '' : ' (not equal)'}` });
  out.push(allReachable(m) ? { id: 'reach', level: 'ok', text: 'every food cell and hill B can be reached from hill A without wrapping (the contest engine)' }
    : reachableOnTorus(m) ? { id: 'reach', level: 'warn', text: 'every hill and food cell can be reached only by wrapping round the world (not in the contest engine)' }
      : { id: 'reach', level: 'bad', text: 'some food or hill cannot be reached from hill A (rock is in the way)' });
  const mirror = colonies === 2 && isSymmetric(m), shift = isShiftSymmetric(m);
  out.push(colonies === 2 ? { id: 'mirror', level: mirror ? 'ok' : 'info', text: mirror ? 'point-mirror symmetric (rock, food, hills)' : 'not point-mirror symmetric' } : { id: 'mirror', level: 'info', text: 'the point mirror is for two colonies' });
  out.push({ id: 'shift', level: shift ? 'ok' : mirror ? 'info' : 'warn', text: shift ? 'same terrain for every colony (a shift of the wrapped world maps each hill onto the others)'
    : mirror ? 'not shift symmetric (the mirror is enough for two colonies)' : 'colonies see different terrain: measure how much it matters with the fairness check' });
  out.push(hasBorder(d) ? { id: 'border', level: 'info', text: 'rock border: yes (a world file for the contest engine)' } : { id: 'border', level: 'info', text: 'rock border: no (fine here: the world wraps; the contest engine needs one)' });
  return out;
}
