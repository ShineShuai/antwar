// Deterministic random programs and worlds for the fuzz and cross-check tests.
import { OP, makeProgram } from '../src/core/asm.ts';
import type { WorldMap } from '../src/core/types.ts';

export const lcg = (seed: number): (() => number) => { let s = seed; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8); };

export function randProgram(r: () => number, n: number) {
  const pick = (k: number): number => r() % k, tgt = () => pick(n);
  const gens = [
    () => ({ op: OP.SENSE, a: pick(4), b: 1 << pick(15), t: tgt(), e: tgt() }),
    () => ({ op: OP.SENSE, a: pick(4), b: 1 << (pick(2) ? 0 : 1), t: tgt(), e: tgt() }),
    () => ({ op: OP.MARK, a: pick(6), t: tgt() }), () => ({ op: OP.UNMARK, a: pick(6), t: tgt() }),
    () => ({ op: OP.MOVE, t: tgt(), e: tgt() }), () => ({ op: OP.MOVE, t: tgt(), e: tgt() }),
    () => ({ op: OP.MOVE, t: tgt(), e: tgt() }), () => ({ op: OP.PICKUP, t: tgt(), e: tgt() }),
    () => ({ op: OP.DROP, t: tgt() }), () => ({ op: OP.TURN, a: pick(2), t: tgt() }),
    () => ({ op: OP.TURN, a: pick(2), t: tgt() }), () => ({ op: OP.FLIP, a: 1 + pick(4), t: tgt(), e: tgt() }),
  ];
  return makeProgram(Array.from({ length: n }, () => gens[pick(gens.length)]()));
}

export function randMap(r: () => number, border = true): WorldMap {
  const W = 16, H = 12, N = W * H;
  const map: WorldMap = { W, H, rock: new Uint8Array(N), food: new Uint16Array(N), hill: new Int8Array(N).fill(-1) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, edge = border && (x === 0 || y === 0 || x === W - 1 || y === H - 1);
    if (x >= 3 && x <= 6 && y >= 3 && y <= 8) map.hill[p] = 0;
    else if (x >= 8 && x <= 11 && y >= 3 && y <= 8) map.hill[p] = 1;
    else if (edge || r() % 100 < 8) map.rock[p] = 1;
    else if (r() % 100 < 10) map.food[p] = 1 + (r() % 9);
  }
  return map;
}

/** A random official-syntax (.ant) program: n states, explicit successors. */
export function randIcfp(r: () => number, n: number): string {
  const pick = (k: number): number => r() % k, st = (): number => pick(n);
  const conds = ['Friend', 'Foe', 'FriendWithFood', 'FoeWithFood', 'Food', 'Rock', 'FoeMarker', 'Home', 'FoeHome'];
  const gens: (() => string)[] = [
    () => `Sense ${['Here', 'Ahead', 'LeftAhead', 'RightAhead'][pick(4)]} ${st()} ${st()} ${conds[pick(conds.length)]}`,
    () => `Sense ${['Ahead', 'Here'][pick(2)]} ${st()} ${st()} Marker ${pick(6)}`,
    () => `Mark ${pick(6)} ${st()}`, () => `Unmark ${pick(6)} ${st()}`,
    () => `Move ${st()} ${st()}`, () => `Move ${st()} ${st()}`, () => `Move ${st()} ${st()}`,
    () => `PickUp ${st()} ${st()}`, () => `Drop ${st()}`,
    () => `Turn ${['Left', 'Right'][pick(2)]} ${st()}`, () => `Turn ${['Left', 'Right'][pick(2)]} ${st()}`,
    () => `Flip ${1 + pick(6)} ${st()} ${st()}`,
  ];
  return Array.from({ length: n }, () => gens[pick(gens.length)]()).join('\n');
}
