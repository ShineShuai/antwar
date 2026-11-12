// Deterministic simulator. Pure functions of (map, programs, seed, rules); no DOM, no I/O.
import { OP, COND as C } from './asm.js';
import { DE, DO } from './hex.js';
import { createRng } from './rng.js';

/** The ICFP 2004 rules, exactly. */
export const CLASSIC = Object.freeze({ cap: 1, scare: false, dropFail: false, ext: false, maxInstr: 10000 });
/** Classic + flags: carry two, scare at 4, drop on blocked move, direction/payload, 2000 cap. */
export const TINYMINDS = Object.freeze({ cap: 2, scare: true, dropFail: true, ext: true, maxInstr: 2000 });
const ACT_EVERY = 15; // a mover rests 14 rounds, so it acts again 15 rounds later

export function createSim({ map, programs, seed = 12345, rules = CLASSIC, wrap = false }) {
  const { W, H } = map, N = W * H, ncol = programs.length;
  if (wrap && H % 2) throw new Error('wrapped worlds need an even height');
  const rock = Uint8Array.from(map.rock), food = Uint16Array.from(map.food), hill = map.hill;
  const marks = new Uint8Array(ncol * N), occ = new Int32Array(N).fill(-1);
  const rng = createRng(seed);
  let cycle = 0;

  const nb = new Int32Array(N * 6).fill(-1); // neighbour table, -1 = off the world
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let d = 0; d < 6; d++) {
        let nx = x + (y & 1 ? DO : DE)[d][0], ny = y + (y & 1 ? DO : DE)[d][1];
        if (wrap) { nx = (nx + W) % W; ny = (ny + H) % H; }
        else if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        nb[(y * W + x) * 6 + d] = ny * W + nx;
      }
    }
  }

  const cells = [];
  for (let p = 0; p < N; p++) if (hill[p] >= 0) cells.push(p); // ids: row-major, both colonies
  if (cells.some((p) => hill[p] >= ncol)) throw new Error('map has more hills than programs');
  const n = cells.length;
  const apos = Int32Array.from(cells), acol = Uint8Array.from(cells, (p) => hill[p]);
  const pc = new Uint16Array(n), dir = new Uint8Array(n), has = new Uint8Array(n);
  const wake = new Int32Array(n), alive = new Uint8Array(n).fill(1);
  cells.forEach((p, i) => { occ[p] = i; });

  const sensed = (p, d, sd) => (sd === 0 ? p : nb[p * 6 + ((d + [0, 0, 5, 1][sd]) % 6)]);
  function holds(c, p, col) {
    if (p < 0 || rock[p]) return c === C.rock;
    const a = occ[p];
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

  const enemies = (c, col) => {
    let k = 0;
    for (let d = 0; d < 6; d++) {
      const q = nb[c * 6 + d];
      if (q >= 0 && occ[q] >= 0 && acol[occ[q]] !== col) k++;
    }
    return k;
  };
  function check(c) { // check_for_surrounded_ant_at
    if (c < 0 || occ[c] < 0) return;
    const a = occ[c], k = enemies(c, acol[a]);
    if (k >= 5) { occ[c] = -1; alive[a] = 0; food[c] += 3 + has[a]; has[a] = 0; }
    else if (rules.scare && k === 4 && has[a]) { food[c] += has[a]; has[a] = 0; }
  }
  function surround(c) {
    check(c);
    for (let d = 0; d < 6; d++) check(nb[c * 6 + d]);
  }

  function stepAnt(i) {
    if (!alive[i] || cycle < wake[i]) return;
    const col = acol[i], P = programs[col], s = pc[i], p = apos[i], a = P.a[s];
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
        const q = nb[p * 6 + dir[i]];
        if (q < 0 || rock[q] || occ[q] >= 0) {
          if (rules.dropFail && has[i] > 1) { food[p]++; has[i]--; }
          pc[i] = P.e[s];
        } else {
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
    get cycle() { return cycle; },
    step() { cycle++; for (let i = 0; i < n; i++) stepAnt(i); },
    run(rounds) { for (let r = 0; r < rounds; r++) this.step(); },
    /** Food on each colony's hill cells (carried food does not count). */
    score: () => hillCells.map((cs) => cs.reduce((sum, p) => sum + food[p], 0)),
    alive: (col) => alive.reduce((k, v, i) => k + (v && acol[i] === col ? 1 : 0), 0),
    ant: (i) => ({ pos: apos[i], col: acol[i], dir: dir[i], has: has[i], pc: pc[i], alive: !!alive[i] }),
    /** Render data: cell food plus [pos, colony, dir, carried] for each living ant. */
    frame() {
      const out = new Int32Array(alive.reduce((k, v) => k + v, 0) * 4);
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (alive[i]) { out[k++] = apos[i]; out[k++] = acol[i]; out[k++] = dir[i]; out[k++] = has[i]; }
      }
      return { cycle, food: food.slice(), ants: out, score: this.score(),
        alive: Array.from({ length: ncol }, (_, c) => this.alive(c)) };
    },
    /** Canonical per-cell text of the whole state (the spec's dump contents). */
    snapshot() {
      const out = [];
      for (let p = 0; p < N; p++) {
        const a = occ[p], m = [];
        for (let k = 0; k < ncol; k++) m.push(marks[k * N + p]);
        const ant = a < 0 ? '' : `${a}:${acol[a]}:${dir[a]}:${has[a]}:${pc[a]}:${Math.max(0, wake[a] - cycle - 1)}`;
        out.push(`${food[p]}|${m}|${ant}`);
      }
      return out.join('\n');
    },
    /** FNV-1a over the full state, for replay and conformance checks. */
    hash() {
      let h = 0x811c9dc5;
      const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
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
