#!/usr/bin/env node
// Measure a brain on generated contest worlds.
//   node cli/eval.ts --ant FILE [--vs FILE] [--swap] [--seeds 20] [--from 1] [--rounds 100000] [--symmetric] [--rules classic] [--json]
// A brain file is any format (script, rules, flat assembly, official .ant: the content decides, not the name); --rules picks the ruleset.
// Without --vs the opponent colony idles, so nothing dies and the score is the food a colony can bring home alone.
// With --vs the colonies play each other (--swap puts --ant on the second hill, which acts later in a round), and the
// summary adds wins/draws/losses by nest food, and how many packets each side took from the other's nest (food on a nest
// cell can be picked up by anyone, so a stash is raided).
// Besides the final nest food, each seed reports the round at which 25/50/90% of all food was home and the
// carrier statistics the trail kit is judged by: pickups, deliveries, packets dropped elsewhere, and carriers that
// are still holding food after STUCK rounds (lost carriers).
// --symmetric plays point-mirror worlds, where both colonies have the same terrain: the contest generator's worlds are lopsided
// map by map (docs/MATCH.md, Fairness), which matters for --vs, and --swap still tells the move order apart.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { SYMMETRIC_WORLD, generateWorld } from '../src/core/gen.ts';
import { RULESETS } from '../src/core/rules.ts';
import { createSim } from '../src/core/sim.ts';
import { loadAnyBrain } from '../src/lang/index.ts';

const { values: o } = parseArgs({ options: {
  ant: { type: 'string' }, vs: { type: 'string' }, swap: { type: 'boolean', default: false }, seeds: { type: 'string', default: '20' }, from: { type: 'string', default: '1' },
  rounds: { type: 'string', default: '100000' }, symmetric: { type: 'boolean', default: false }, rules: { type: 'string', default: 'classic' }, json: { type: 'boolean', default: false },
} });
if (!o.ant) { console.error('usage: eval.ts --ant FILE [--vs FILE] [--swap] [--seeds N] [--from SEED] [--rounds N] [--symmetric] [--rules R] [--json]'); process.exit(2); }
if (!Object.hasOwn(RULESETS, o.rules)) { console.error(`unknown ruleset "${o.rules}"; try ${Object.keys(RULESETS).join(', ')}`); process.exit(2); }
const rules = RULESETS[o.rules as keyof typeof RULESETS];
const STUCK = 5000, rounds = Number(o.rounds);
const load = (f: string) => loadAnyBrain(readFileSync(f, 'utf8'), rules).program;
const mine = load(o.ant), foe = o.vs ? load(o.vs) : loadAnyBrain('Drop 0', rules).program;

export interface Row {
  seed: number; food: number; foe: number; total: number; t25: number | null; t50: number | null; t90: number | null;
  pickups: number; deliveries: number; droppedAway: number; stuck: number; alive: number; medianTrip: number;
  /** packets this colony picked up from the other colony's nest / the other colony picked up from ours */
  stole: number; lost: number;
}
const median = (xs: number[]): number => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);

const rows: Row[] = [];
for (let s = 0; s < Number(o.seeds); s++) {
  const seed = Number(o.from) + s, map = o.symmetric ? generateWorld(seed, SYMMETRIC_WORLD) : generateWorld(seed);
  const me = o.swap ? 1 : 0, sim = createSim({ map, programs: o.swap ? [foe, mine] : [mine, foe], seed, rules });
  const total = map.food.reduce((a, b) => a + b, 0);
  const mineIds = Array.from({ length: sim.ants }, (_, i) => i).filter((i) => sim.ant(i).col === me);
  const since = new Map<number, number>(), prev = new Map<number, number>(), trips: number[] = [];
  const foeIds = o.vs ? Array.from({ length: sim.ants }, (_, i) => i).filter((i) => sim.ant(i).col === 1 - me) : [], foePrev = new Map<number, number>();
  const row: Row = { seed, food: 0, foe: 0, total, t25: null, t50: null, t90: null, pickups: 0, deliveries: 0, droppedAway: 0, stuck: 0, alive: 0, medianTrip: 0, stole: 0, lost: 0 };
  for (let r = 1; r <= rounds; r++) {
    sim.step();
    for (const i of mineIds) {
      const a = sim.ant(i), was = prev.get(i) ?? 0;
      if (a.has > 0 && was === 0) { row.pickups++; since.set(i, r); if (a.alive && map.hill[a.pos] === 1 - me) row.stole++; }
      else if (a.has === 0 && was > 0) {
        if (a.alive && map.hill[a.pos] === me) { row.deliveries++; trips.push(r - (since.get(i) ?? r)); } else row.droppedAway++;
      }
      prev.set(i, a.has);
    }
    for (const i of foeIds) { const a = sim.ant(i), was = foePrev.get(i) ?? 0; if (a.has > 0 && was === 0 && a.alive && map.hill[a.pos] === me) row.lost++; foePrev.set(i, a.has); }
    if (r % 50 === 0) {
      const f = sim.score()[me];
      if (row.t25 === null && f >= 0.25 * total) row.t25 = r;
      if (row.t50 === null && f >= 0.5 * total) row.t50 = r;
      if (row.t90 === null && f >= 0.9 * total) row.t90 = r;
    }
  }
  row.food = sim.score()[me];
  row.foe = sim.score()[1 - me];
  row.alive = sim.alive(me);
  row.stuck = mineIds.filter((i) => sim.ant(i).has > 0 && rounds - (since.get(i) ?? rounds) > STUCK).length;
  row.medianTrip = median(trips);
  rows.push(row);
  if (!o.json) {
    const f = (v: number | null): string => (v === null ? '    -' : String(v).padStart(5));
    console.log(`seed ${String(seed).padStart(3)}  food ${String(row.food).padStart(3)}/${total}  t25 ${f(row.t25)}  t50 ${f(row.t50)}  t90 ${f(row.t90)}  ` +
      `pickups ${String(row.pickups).padStart(4)}  delivered ${String(row.deliveries).padStart(4)}  away ${String(row.droppedAway).padStart(3)}  ` +
      `stuck ${String(row.stuck).padStart(2)}  trip~${row.medianTrip}` + (o.vs ? `  foe ${row.foe}  alive ${row.alive}  stole ${row.stole}  lost ${row.lost}` : ''));
  }
}
const foods = rows.map((r) => r.food), pk = rows.reduce((a, r) => a + r.pickups, 0), dl = rows.reduce((a, r) => a + r.deliveries, 0);
const summary = {
  seeds: rows.length, rounds, ...(o.symmetric ? { symmetric: true } : {}), ...(o.rules !== 'classic' ? { rules: o.rules } : {}), medianFood: median(foods), minFood: Math.min(...foods), maxFood: Math.max(...foods),
  medianT50: median(rows.map((r) => r.t50 ?? Infinity).filter(Number.isFinite)), reachedT90: rows.filter((r) => r.t90 !== null).length,
  deliveredPerPickup: pk ? Math.round((1000 * dl) / pk) / 1000 : 0, stuckCarriers: rows.reduce((a, r) => a + r.stuck, 0),
  ...(o.vs ? { wins: rows.filter((r) => r.food > r.foe).length, draws: rows.filter((r) => r.food === r.foe).length, losses: rows.filter((r) => r.food < r.foe).length, medianAlive: median(rows.map((r) => r.alive)), medianStole: median(rows.map((r) => r.stole)), medianLost: median(rows.map((r) => r.lost)) } : {}),
};
console.log(o.json ? JSON.stringify({ summary, rows }) : `summary ${JSON.stringify(summary)}`);
