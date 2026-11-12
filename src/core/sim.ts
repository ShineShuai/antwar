// Deterministic simulator. Pure functions of (map, programs, seed, rules); no DOM, no I/O.
import { COND as C, OP } from './asm.ts';
import { DE, DO } from './hex.ts';
import { createRng } from './rng.ts';
import { ANT_STRIDE } from './types.ts';
import type { AntId, Cell, Frame, Program, Rules, WorldMap } from './types.ts';

/** The ICFP 2004 rules, exactly. */
export const CLASSIC: Rules = Object.freeze({ cap: 1, ext: false, maxInstr: 10000 });
/** Classic + carry two + direction/payload sensing + a 2000-instruction cap. */
export const TINYMINDS: Rules = Object.freeze({ cap: 2, ext: true, maxInstr: 2000 });
const ACT_EVERY = 15; // a mover rests 14 rounds, so it acts again 15 rounds later

export interface SimOptions {
  map: WorldMap;
  /** One program per colony (v1: one or two). */
  programs: Program[];
  seed?: number;
  rules?: Rules;
  wrap?: boolean;
}
export type Sim = ReturnType<typeof createSim>;

export function createSim({ map, programs, seed = 12345, rules = CLASSIC, wrap = false }: SimOptions) {
  const { W, H } = map, N = W * H, ncol = programs.length;
  if (ncol < 1 || ncol > 2) throw new Error('v1 supports one or two colonies');
  if (N > 65535) throw new Error('world too large');
  if (wrap && H % 2) throw new Error('wrapped worlds need an even height');
  const rock = Uint8Array.from(map.rock), food = Uint16Array.from(map.food), hill = map.hill;
  const marks = new Uint8Array(ncol * N), occ = new Int32Array(N).fill(-1);
  const rng = createRng(seed);
  let cycle = 0;

  const nb = new Int32Array(N * 6).fill(-1); // neighbour table, -1 = off the world
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let d = 0; d < 6; d++) {
        const delta = (y & 1 ? DO : DE)[d];
        let nx = x + delta[0], ny = y + delta[1];
        if (wrap) { nx = (nx + W) % W; ny = (ny + H) % H; }
        else if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        nb[(y * W + x) * 6 + d] = ny * W + nx;
      }
    }
  }
  const nbr = (c: Cell, d: number): Cell | -1 => nb[c * 6 + d] as Cell | -1;
  const antAt = (c: Cell): AntId | -1 => occ[c] as AntId | -1;

  const cells: number[] = [];
  for (let p = 0; p < N; p++) if (hill[p] >= 0) cells.push(p); // ids: row-major, both colonies
  if (cells.some((p) => hill[p] >= ncol)) throw new Error('map has more hills than programs');
  const n = cells.length;
  const apos = Int32Array.from(cells), acol = Uint8Array.from(cells, (p) => hill[p]);
  const pc = new Uint16Array(n), dir = new Uint8Array(n), has = new Uint8Array(n);
  const wake = new Int32Array(n), alive = new Uint8Array(n).fill(1);
  cells.forEach((p, i) => { occ[p] = i; });

  const sensed = (p: Cell, d: number, sd: number): Cell | -1 =>
    sd === 0 ? p : nbr(p, (d + [0, 0, 5, 1][sd]) % 6);

  function holds(c: number, p: Cell | -1, col: number): boolean {
    if (p === -1 || rock[p]) return c === C.rock;
    const a = antAt(p);
    switch (c) {
      case C.friend: return a >= 0 && acol[a] === col;
      case C.foe: return a >= 0 && acol[a] !== col;
      case C.friendwithfood: return a >= 0 && acol[a] === col && has[a] > 0;
      case C.foewithfood: return a >= 0 && acol[a] !== col && has[a] > 0;
      case C.food: return food[p] > 0;
      case C.rock: return false;
      case C.foemarker:
        for (let k = 0; k < ncol; k++) if (k !== col && marks[k * N + p]) return true;
        return false;
      case C.home: return hill[p] === col;
      case C.foehome: return hill[p] >= 0 && hill[p] !== col;
      default: return ((marks[col * N + p] >> (c - C.marker)) & 1) === 1;
    }
  }

  function enemies(c: Cell, col: number): number {
    let k = 0;
    for (let d = 0; d < 6; d++) {
      const q = nbr(c, d);
      if (q !== -1 && occ[q] >= 0 && acol[occ[q]] !== col) k++;
    }
    return k;
  }
  function check(c: Cell | -1): void { // check_for_surrounded_ant_at
    if (c === -1) return;
    const a = antAt(c);
    if (a !== -1 && enemies(c, acol[a]) >= 5) {
      occ[c] = -1; alive[a] = 0; food[c] += 3 + has[a]; has[a] = 0;
    }
  }
  function surround(c: Cell): void {
    check(c);
    for (let d = 0; d < 6; d++) check(nbr(c, d));
  }

  function stepAnt(i: AntId): void {
    if (!alive[i] || cycle < wake[i]) return;
    const col = acol[i], P = programs[col], s = pc[i], p = apos[i] as Cell, a = P.a[s];
    switch (P.op[s]) {
      case OP.SENSE: case OP.SENSEANY: {
        const q = sensed(p, dir[i], a);
        let all = true, any = false;
        for (let c = 0; P.b[s] >> c; c++) {
          if ((P.b[s] >> c) & 1) { const h = holds(c, q, col); all &&= h; any ||= h; }
        }
        pc[i] = (P.op[s] === OP.SENSE ? all : any) ? P.t[s] : P.e[s];
        break;
      }
      case OP.MARK: marks[col * N + p] |= 1 << a; pc[i] = P.t[s]; break;
      case OP.UNMARK: marks[col * N + p] &= ~(1 << a); pc[i] = P.t[s]; break;
      case OP.MOVE: {
        const q = nbr(p, dir[i]);
        if (q === -1 || rock[q] || occ[q] >= 0) pc[i] = P.e[s];
        else {
          occ[p] = -1; occ[q] = i; apos[i] = q; pc[i] = P.t[s]; wake[i] = cycle + ACT_EVERY;
          surround(q);
        }
        break;
      }
      case OP.PICKUP:
        if (has[i] >= rules.cap || food[p] === 0) pc[i] = P.e[s];
        else { food[p]--; has[i]++; pc[i] = P.t[s]; }
        break;
      case OP.DROP: food[p] += has[i]; has[i] = 0; pc[i] = P.t[s]; break;
      case OP.TURN: dir[i] = (dir[i] + (a ? 1 : 5)) % 6; pc[i] = P.t[s]; break;
      case OP.FLIP: pc[i] = rng.int(a) === 0 ? P.t[s] : P.e[s]; break;
      case OP.GOTO: pc[i] = P.t[s]; break;
      case OP.DIRECTION: pc[i] = dir[i] === a ? P.t[s] : P.e[s]; break;
      case OP.PAYLOAD: pc[i] = has[i] === a ? P.t[s] : P.e[s]; break;
    }
  }

  const hillCells = Array.from({ length: ncol }, (_, k) => cells.filter((p) => hill[p] === k));
  return {
    W, H, ants: n, food, rock, marks,
    get cycle(): number { return cycle; },
    step(): void { cycle++; for (let i = 0; i < n; i++) stepAnt(i as AntId); },
    run(rounds: number): void { for (let r = 0; r < rounds; r++) this.step(); },
    /** Food on each colony's hill cells (carried food does not count). */
    score: (): number[] => hillCells.map((cs) => cs.reduce((sum, p) => sum + food[p], 0)),
    alive: (col: number): number => alive.reduce((k, v, i) => k + (v && acol[i] === col ? 1 : 0), 0),
    ant: (i: number) => ({ pos: apos[i], col: acol[i], dir: dir[i], has: has[i], pc: pc[i], alive: !!alive[i] }),
    /** Render data for the current round (copies; safe to transfer). */
    frame(): Frame {
      const out = new Int32Array(alive.reduce((k, v) => k + v, 0) * ANT_STRIDE);
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        out[k++] = i; out[k++] = apos[i]; out[k++] = acol[i]; out[k++] = dir[i]; out[k++] = has[i]; out[k++] = pc[i];
      }
      return { cycle, food: food.slice(), marks: marks.slice(), ants: out, score: this.score(),
        alive: Array.from({ length: ncol }, (_, c) => this.alive(c)) };
    },
    /** Canonical per-cell text of the whole state (the spec's dump contents). */
    snapshot(): string {
      const out: string[] = [];
      for (let p = 0; p < N; p++) {
        const a = occ[p], m: number[] = [];
        for (let k = 0; k < ncol; k++) m.push(marks[k * N + p]);
        const ant = a < 0 ? '' : `${a}:${acol[a]}:${dir[a]}:${has[a]}:${pc[a]}:${Math.max(0, wake[a] - cycle - 1)}`;
        out.push(`${food[p]}|${m}|${ant}`);
      }
      return out.join('\n');
    },
    /** FNV-1a over the full state, for replay and conformance checks. */
    hash(): number {
      let h = 0x811c9dc5;
      const mix = (v: number): void => { h = Math.imul(h ^ (v | 0), 0x01000193); };
      mix(cycle); mix(rng.state);
      for (let i = 0; i < n; i++) {
        mix(alive[i]);
        if (alive[i]) { mix(apos[i]); mix(dir[i]); mix(has[i]); mix(pc[i]); mix(Math.max(0, wake[i] - cycle)); }
      }
      for (let p = 0; p < N; p++) mix(food[p]);
      for (let k = 0; k < marks.length; k++) mix(marks[k]);
      return h >>> 0;
    },
  };
}
