// Spec-literal reference simulator (ICFP 2004 task, section 2): slow, 2-D arrays, boolean
// food flag, decrementing `resting`. Classic rules only. Shares only the RNG and the IR.
import { OP } from '../src/core/asm.ts';
import { createRng } from '../src/core/rng.ts';
import type { Program, WorldMap } from '../src/core/types.ts';

type Pos = [number, number];
interface RefAnt {
  id: number; color: number; state: number; resting: number; dir: number; food: boolean; pos: Pos; alive: boolean;
}

export function refSim({ map, programs, seed }: { map: WorldMap; programs: Program[]; seed: number }) {
  const { W, H } = map, rng = createRng(seed), ncol = programs.length;
  const key = ([x, y]: Pos): number => y * W + x;
  const inside = ([x, y]: Pos): boolean => x >= 0 && x < W && y >= 0 && y < H;
  const rocky = (q: Pos): boolean => !inside(q) || map.rock[key(q)] === 1;
  const adjacent = ([x, y]: Pos, d: number): Pos => {
    const even = y % 2 === 0;
    switch (d) {
      case 0: return [x + 1, y];
      case 1: return even ? [x, y + 1] : [x + 1, y + 1];
      case 2: return even ? [x - 1, y + 1] : [x, y + 1];
      case 3: return [x - 1, y];
      case 4: return even ? [x - 1, y - 1] : [x, y - 1];
      default: return even ? [x, y - 1] : [x + 1, y - 1];
    }
  };
  const food = Array.from(map.food);
  const mark = Array.from({ length: ncol }, () => new Array<number>(W * H).fill(0));
  const grid: (RefAnt | null)[] = new Array(W * H).fill(null), ants: RefAnt[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = map.hill[y * W + x];
      if (c < 0) continue;
      const a: RefAnt = { id: ants.length, color: c, state: 0, resting: 0, dir: 0, food: false, pos: [x, y], alive: true };
      ants.push(a); grid[y * W + x] = a;
    }
  }
  const antAt = (q: Pos): RefAnt | null => (inside(q) ? grid[key(q)] : null);
  const matches = (q: Pos, cond: number, c: number): boolean => {
    if (rocky(q)) return cond === 5;
    const a = antAt(q);
    switch (cond) {
      case 0: return !!a && a.color === c;
      case 1: return !!a && a.color !== c;
      case 2: return !!a && a.color === c && a.food;
      case 3: return !!a && a.color !== c && a.food;
      case 4: return food[key(q)] > 0;
      case 5: return false;
      case 12: return mark.some((m, k) => k !== c && m[key(q)] !== 0);
      case 13: return map.hill[key(q)] === c;
      case 14: return map.hill[key(q)] >= 0 && map.hill[key(q)] !== c;
      default: return ((mark[c][key(q)] >> (cond - 6)) & 1) === 1;
    }
  };
  const adjacentAnts = (q: Pos, c: number): number => {
    let n = 0;
    for (let d = 0; d < 6; d++) { const a = antAt(adjacent(q, d)); if (a && a.color === c) n++; }
    return n;
  };
  const checkSurrounded = (q: Pos): void => {
    const a = antAt(q);
    if (a && adjacentAnts(q, 1 - a.color) >= 5) {
      grid[key(q)] = null; a.alive = false; food[key(q)] += 3 + (a.food ? 1 : 0);
    }
  };
  const step = (a: RefAnt): void => {
    if (!a.alive) return;
    if (a.resting > 0) { a.resting--; return; }
    const P = programs[a.color], s = a.state, p = a.pos, k = P.a[s];
    switch (P.op[s]) {
      case OP.SENSE: {
        const q = k === 0 ? p : adjacent(p, k === 1 ? a.dir : (a.dir + (k === 2 ? 5 : 1)) % 6);
        const cond = 31 - Math.clz32(P.b[s]); // classic: exactly one condition bit
        a.state = matches(q, cond, a.color) ? P.t[s] : P.e[s];
        break;
      }
      case OP.MARK: mark[a.color][key(p)] |= 1 << k; a.state = P.t[s]; break;
      case OP.UNMARK: mark[a.color][key(p)] &= ~(1 << k); a.state = P.t[s]; break;
      case OP.PICKUP:
        if (a.food || food[key(p)] === 0) a.state = P.e[s];
        else { food[key(p)]--; a.food = true; a.state = P.t[s]; }
        break;
      case OP.DROP: if (a.food) { food[key(p)]++; a.food = false; } a.state = P.t[s]; break;
      case OP.TURN: a.dir = (a.dir + (k ? 1 : 5)) % 6; a.state = P.t[s]; break;
      case OP.MOVE: {
        const q = adjacent(p, a.dir);
        if (rocky(q) || antAt(q)) a.state = P.e[s];
        else {
          grid[key(p)] = null; grid[key(q)] = a; a.pos = q; a.state = P.t[s]; a.resting = 14;
          checkSurrounded(q);
          for (let d = 0; d < 6; d++) checkSurrounded(adjacent(q, d));
        }
        break;
      }
      case OP.FLIP: a.state = rng.int(k) === 0 ? P.t[s] : P.e[s]; break;
      default: throw new Error('op not in Classic');
    }
  };
  return {
    step() { ants.forEach(step); },
    alive: () => ants.filter((a) => a.alive).length,
    snapshot() {
      return Array.from({ length: W * H }, (_, p) => {
        const a = grid[p];
        const m = mark.map((arr) => arr[p]);
        return `${food[p]}|${m}|${a ? `${a.id}:${a.color}:${a.dir}:${a.food ? 1 : 0}:${a.state}:${a.resting}` : ''}`;
      }).join('\n');
    },
  };
}
