// node bench/run.ts [rounds] [--gate FACTOR] [--write]
// Rounds/second and ns per ant-round for four workloads (median of 3).
// --gate F fails if any workload is more than F times slower than bench/baseline.json (a coarse guard against
// accidental slowdowns: shared CI runners are noisy, so CI uses 3). --write refreshes the baseline on this machine.
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { parseIcfp } from '../src/core/asm.ts';
import { generateWorld } from '../src/core/gen.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import type { WorldMap } from '../src/core/types.ts';
import { STARTER } from '../web/default-ant.ts';

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { gate: { type: 'string' }, write: { type: 'boolean', default: false } } });
const rounds = Number(positionals[0]) || 20000;
const baselineFile = new URL('./baseline.json', import.meta.url);
const measured: Record<string, number> = {};

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
  measured[name] = (med * 1e6) / (rounds * ants);
  console.log(`${name.padEnd(36)} ${String(ants).padStart(4)} ants  ${med.toFixed(0).padStart(5)} ms  ` +
    `${((rounds / med) * 1000).toFixed(0).padStart(7)} rounds/s  ${((med * 1e6) / (rounds * ants)).toFixed(1).padStart(5)} ns/ant-round`);
}

if (opt.write) {
  const ns = Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  writeFileSync(baselineFile, `${JSON.stringify({ rounds, ns }, null, 1)}\n`);
  console.log(`wrote bench/baseline.json (${rounds} rounds)`);
}
if (opt.gate !== undefined) {
  const factor = Number(opt.gate), base = JSON.parse(readFileSync(baselineFile, 'utf8')) as { rounds: number; ns: Record<string, number> };
  if (!(factor > 1)) throw new Error('--gate needs a factor above 1');
  if (base.rounds !== rounds) console.log(`note: baseline was taken at ${base.rounds} rounds, this run used ${rounds}`);
  const slow = Object.entries(measured).filter(([k, v]) => v > base.ns[k] * factor);
  slow.forEach(([k, v]) => console.error(`SLOWER than ${factor}x baseline: ${k}: ${v.toFixed(1)} vs ${base.ns[k]} ns/ant-round`));
  if (slow.length) process.exit(1);
  console.log(`bench gate ok (limit ${factor}x baseline)`);
}
