// Deterministic simulator. Pure functions of (map, programs, seed, rules); no DOM, no I/O.
import { COND as C, OP } from './asm.ts';
import { DE, DO } from './hex.ts';
import { CLASSIC, TINYMINDS, unsupported } from './rules.ts';
import { createRng } from './rng.ts';
import { ANT_STRIDE } from './types.ts';
import type { AntId, Cell, Dir, Frame, Program, Rules, WorldMap } from './types.ts';

export { CLASSIC, TINYMINDS };

/** FNV-1a, 32 bit: the regression fingerprint of the state stream (RNG tab). */
export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}
const ACT_EVERY = 15; // a mover rests 14 rounds, so it acts again 15 rounds later

export interface SimOptions {
  map: WorldMap;
  /** One program per colony (v1: one or two). */
  programs: Program[];
  seed?: number;
  rules?: Rules;
  /** Toroidal world (the spec default; needs an even height). */
  wrap?: boolean;
}
export type Sim = ReturnType<typeof createSim>;

export function createSim({ map, programs, seed = 12345, rules = CLASSIC, wrap = true }: SimOptions) {
  const { W, H } = map, N = W * H, ncol = programs.length;
  const missing = unsupported(rules); // VARIATION POINT (all flags): see docs/EXTENDING.md
  if (missing.length) throw new Error(`ruleset needs features not implemented yet: ${missing.join(', ')}`);
  if (ncol < 1 || ncol > rules.maxColonies) throw new Error('v1 supports one or two colonies'); // VARIATION POINT: maxColonies
  if (N > 65535) throw new Error('world too large: cells must fit u16 with 0xFFFF reserved');
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
  const nbr = (c: Cell, d: Dir): Cell | -1 => nb[c * 6 + d] as Cell | -1;
  const antAt = (c: Cell): AntId | -1 => occ[c] as AntId | -1;

  const cells: number[] = [];
  for (let p = 0; p < N; p++) if (hill[p] >= 0) cells.push(p); // ids: row-major, both colonies
  if (cells.some((p) => hill[p] >= ncol)) throw new Error('map has more hills than programs');
  const n = cells.length;
  if (n > 32767) throw new Error('too many ants: ids must fit i16');
  const apos = Int32Array.from(cells), acol = Uint8Array.from(cells, (p) => hill[p]);
  const pc = new Uint16Array(n), dir = new Uint8Array(n), has = new Uint8Array(n);
  const wake = new Int32Array(n), alive = new Uint8Array(n).fill(1);
  cells.forEach((p, i) => { occ[p] = i; });

  const sensed = (p: Cell, d: Dir, sd: number): Cell | -1 =>
    sd === 0 ? p : nbr(p, ((d + [0, 0, 5, 1][sd]) % 6) as Dir);

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
      const q = nbr(c, d as Dir);
      if (q !== -1 && occ[q] >= 0 && acol[occ[q]] !== col) k++;
    }
    return k;
  }
  function check(c: Cell | -1): void { // check_for_surrounded_ant_at
    if (c === -1) return;
    const a = antAt(c);
    // VARIATION POINT: scareThreshold (an ant with exactly that many enemy neighbours drops its food and survives)
    if (a !== -1 && enemies(c, acol[a]) >= 5) {
      occ[c] = -1; alive[a] = 0; food[c] += 3 + has[a]; has[a] = 0;
    }
  }
  function surround(c: Cell): void {
    check(c);
    for (let d = 0; d < 6; d++) check(nbr(c, d as Dir));
  }

  function stepAnt(i: AntId): void {
    if (!alive[i] || cycle < wake[i]) return;
    const col = acol[i], P = programs[col], s = pc[i], p = apos[i] as Cell, a = P.a[s];
    switch (P.op[s]) {
      case OP.SENSE: case OP.SENSEANY: {
        const q = sensed(p, dir[i] as Dir, a);
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
        const q = nbr(p, dir[i] as Dir);
        // VARIATION POINT: dropOnBlocked (a blocked mover carrying two drops one packet here)
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
      default: throw new Error(`bad opcode ${P.op[s]} (gotos are resolved when the program is loaded)`);
      case OP.DIRECTION: pc[i] = dir[i] === a ? P.t[s] : P.e[s]; break;
      case OP.PAYLOAD: pc[i] = has[i] === a ? P.t[s] : P.e[s]; break;
    }
  }

  const streamSize = 12 + N * (4 + ncol) + n * 9;
  const hillCells = Array.from({ length: ncol }, (_, k) => cells.filter((p) => hill[p] === k));
  return {
    W, H, ants: n, food, rock, marks,
    get cycle(): number { return cycle; },
    // VARIATION POINT: altOrder (alternate which colony acts first); Classic: ascending id
    step(): void { cycle++; for (let i = 0; i < n; i++) stepAnt(i as AntId); },
    run(rounds: number): void { for (let r = 0; r < rounds; r++) this.step(); },
    /** Food on each colony's hill cells (carried food does not count). */
    score: (): number[] => hillCells.map((cs) => cs.reduce((sum, p) => sum + food[p], 0)),
    alive: (col: number): number => alive.reduce((k, v, i) => k + (v && acol[i] === col ? 1 : 0), 0),
    ant: (i: number) => ({ pos: apos[i], col: acol[i], dir: dir[i], has: has[i], pc: pc[i], alive: !!alive[i],
      rest: alive[i] ? Math.max(0, wake[i] - cycle - 1) : 0 }),
    /** Number of RNG values drawn so far. */
    get draws(): number { return rng.draws; },
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
    /** Canonical state stream (RNG tab, v3): little-endian, cells then ants. Also the checkpoint format. */
    snapshot(): Uint8Array {
      const out = new Uint8Array(streamSize), dv = new DataView(out.buffer);
      let o = 0;
      dv.setUint32(o, cycle, true); dv.setUint32(o + 4, rng.state, true); dv.setUint32(o + 8, rng.draws, true);
      o += 12;
      for (let p = 0; p < N; p++) {
        dv.setUint16(o, food[p], true); o += 2;
        for (let c = 0; c < ncol; c++) out[o++] = marks[c * N + p];
        dv.setInt16(o, occ[p], true); o += 2;
      }
      for (let i = 0; i < n; i++) {
        const up = alive[i] === 1; // dead ants: cell 0xFFFF, other fields 0
        out[o++] = alive[i]; out[o++] = acol[i];
        dv.setUint16(o, up ? apos[i] : 0xffff, true); o += 2;
        out[o++] = up ? dir[i] : 0;
        dv.setUint16(o, up ? pc[i] : 0, true); o += 2;
        out[o++] = up ? has[i] : 0;
        out[o++] = up ? Math.max(0, wake[i] - cycle - 1) : 0;
      }
      return out;
    },
    /** Restore a snapshot taken from a match with the same map, programs and rules. */
    restore(buf: Uint8Array): void {
      if (buf.length !== streamSize) throw new Error('snapshot does not match this match');
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      cycle = dv.getUint32(0, true);
      rng.load(dv.getUint32(4, true), dv.getUint32(8, true));
      let o = 12;
      for (let p = 0; p < N; p++) {
        food[p] = dv.getUint16(o, true); o += 2;
        for (let c = 0; c < ncol; c++) marks[c * N + p] = buf[o++];
        occ[p] = dv.getInt16(o, true); o += 2;
      }
      for (let i = 0; i < n; i++) {
        alive[i] = buf[o++]; o++; // colony is fixed by the map
        const cell = dv.getUint16(o, true); o += 2;
        dir[i] = buf[o++]; pc[i] = dv.getUint16(o, true); o += 2;
        has[i] = buf[o++];
        wake[i] = cycle + 1 + buf[o++];
        if (alive[i]) apos[i] = cell;
      }
    },
    /** Canonical per-cell text of the whole state, for readable test diffs. */
    dump(): string {
      const out: string[] = [];
      for (let p = 0; p < N; p++) {
        const a = occ[p], m: number[] = [];
        for (let k = 0; k < ncol; k++) m.push(marks[k * N + p]);
        const ant = a < 0 ? '' : `${a}:${acol[a]}:${dir[a]}:${has[a]}:${pc[a]}:${Math.max(0, wake[a] - cycle - 1)}`;
        out.push(`${food[p]}|${m}|${ant}`);
      }
      return out.join('\n');
    },
    /** Canonical state hash: FNV-1a over snapshot(). */
    hash(): number {
      return fnv1a(this.snapshot());
    },
  };
}
