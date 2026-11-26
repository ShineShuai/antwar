#!/usr/bin/env node
// What does hill size do? The same brain in both colonies of mirrored worlds; hill B is cut down to radius r (A keeps radius 5, 91 cells):
//   node scripts/hill-size.ts BRAIN 5,4,3,2 [WORLDS=60] [ROUNDS=30000]
// Ants start one per hill cell, so a smaller hill is a smaller colony. Radius 5 against 5 is the control (about 50%).
import { readFileSync } from 'node:fs';
import { SYMMETRIC_WORLD, generateWorld } from '../src/core/gen.ts';
import { step } from '../src/core/hex.ts';
import { playColonies } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import { wilson } from '../src/stats.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
if (process.argv.length < 3) { console.error('usage: hill-size.ts BRAIN 5,4,3,2 [WORLDS] [ROUNDS]'); process.exit(2); }
const brainFile = process.argv[2] ?? '', radii = (process.argv[3] ?? '5,3').split(',').map(Number), worlds = Number(process.argv[4] ?? '60'), rounds = Number(process.argv[5] ?? '30000');
const program = loadAnyBrain(readFileSync(brainFile, 'utf8'), RULESETS.classic).program;
for (const r of radii) {
  let aWins = 0, bWins = 0, draws = 0, fa = 0, fb = 0, antsB = 0;
  for (let seed = 1; seed <= worlds; seed++) {
    const m = generateWorld(seed, SYMMETRIC_WORLD), W = m.W, H = m.H, cells = [] as number[];
    m.hill.forEach((h, p) => { if (h === 1) cells.push(p); });
    // the centre: the hill cell from which every other cell of the hill is within distance 5
    const dist = (from: number): Map<number, number> => { const d = new Map<number, number>([[from, 0]]), q = [from]; for (let i = 0; i < q.length; i++) { const p = q[i], x = p % W, y = (p / W) | 0; for (let k = 0; k < 6; k++) { const [nx, ny] = step(x, y, k), n = (((ny % H) + H) % H) * W + (((nx % W) + W) % W); if (!d.has(n) && d.get(p)! < 6) { d.set(n, d.get(p)! + 1); q.push(n); } } } return d; };
    const centre = cells.find((c) => { const d = dist(c); return cells.every((p) => (d.get(p) ?? 99) <= 5); }) as number, dc = dist(centre);
    for (const p of cells) if ((dc.get(p) ?? 99) > r) m.hill[p] = -1;
    antsB += m.hill.filter((h) => h === 1).length;
    const food = playColonies(m, [program, program], seed, rounds, RULESETS.classic);
    fa += food[0]; fb += food[1]; if (food[0] > food[1]) aWins++; else if (food[0] < food[1]) bWins++; else draws++;
  }
  const [lo, hi] = wilson(aWins + draws / 2, worlds);
  console.log(`hill B radius ${r} (${Math.round(antsB / worlds)} ants vs 91): A (big hill) wins ${aWins}, B ${bWins}, draws ${draws} of ${worlds}; A score ${(100 * (aWins + draws / 2) / worlds).toFixed(1)}% [${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}]; mean nest food A ${(fa / worlds).toFixed(0)}, B ${(fb / worlds).toFixed(0)}`);
}
