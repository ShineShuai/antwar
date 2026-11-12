// node bench/run.ts [rounds]  - rounds/second and ns per ant-round for four workloads (median of 3).
import { performance } from 'node:perf_hooks';
import { parseIcfp } from '../src/core/asm.ts';
import { generateWorld } from '../src/core/gen.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import type { WorldMap } from '../src/core/types.ts';
import { STARTER } from '../web/default-ant.ts';

const rounds = Number(process.argv[2]) || 20000;

/** 40x40 world, two 8x8 anthills 8 cells apart: ants meet quickly, so surround checks dominate. */
function dense(): WorldMap {
  const W = 40, H = 40, N = W * H;
  const map: WorldMap = { W, H, rock: new Uint8Array(N), food: new Uint16Array(N), hill: new Int8Array(N).fill(-1) };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) map.rock[p] = 1;
      else if (y >= 16 && y < 24 && x >= 8 && x < 16) map.hill[p] = 0;
      else if (y >= 16 && y < 24 && x >= 24 && x < 32) map.hill[p] = 1;
    }
  }
  return map;
}

const scenarios: [string, WorldMap, string][] = [
  ['starter ant, contest world', generateWorld(3), STARTER],
  ['always-move swarm, dense contact', dense(), 'Move 0 1\nTurn Left 0'],
  ['rng-heavy (flip every round)', generateWorld(3), 'Flip 2 1 2\nFlip 3 0 2\nTurn Left 0'],
  ['starter ant, dense world', dense(), STARTER],
];

console.log(`node ${process.version}, ${rounds} rounds, median of 3`);
for (const [name, map, text] of scenarios) {
  const P = parseIcfp(text, CLASSIC), ms: number[] = [];
  let ants = 0;
  for (let rep = 0; rep < 3; rep++) {
    const sim = createSim({ map, programs: [P, P] });
    ants = sim.ants;
    const t0 = performance.now();
    sim.run(rounds);
    ms.push(performance.now() - t0);
  }
  const med = ms.sort((a, b) => a - b)[1];
  console.log(`${name.padEnd(36)} ${String(ants).padStart(4)} ants  ${med.toFixed(0).padStart(5)} ms  ` +
    `${((rounds / med) * 1000).toFixed(0).padStart(7)} rounds/s  ${((med * 1e6) / (rounds * ants)).toFixed(1).padStart(5)} ns/ant-round`);
}
