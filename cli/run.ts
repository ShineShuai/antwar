#!/usr/bin/env node
// node cli/run.js --map w.world --ant a.ant [--ant b.ant] [--rounds 100000] [--seed 12345] [--rules classic|tiny]
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadBrain } from '../src/core/asm.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, TINYMINDS, createSim } from '../src/core/sim.ts';

const { values: o } = parseArgs({ options: {
  map: { type: 'string' }, ant: { type: 'string', multiple: true }, rounds: { type: 'string', default: '100000' },
  seed: { type: 'string', default: '12345' }, rules: { type: 'string', default: 'classic' },
  every: { type: 'string', default: '0' }, 'no-wrap': { type: 'boolean', default: false },
} });
if (!o.map || !o.ant?.length) { console.error('usage: run.js --map FILE --ant FILE [--ant FILE]'); process.exit(2); }
const rules = o.rules === 'tiny' ? TINYMINDS : CLASSIC;
const load = (f: string) => loadBrain(readFileSync(f, 'utf8'), rules);
const programs = o.ant.length === 1 ? [load(o.ant[0]), load(o.ant[0])] : o.ant.map(load);
const sim = createSim({ map: parseMap(readFileSync(o.map, 'utf8')), programs, seed: +o.seed, rules, wrap: !o['no-wrap'] });
const every = Number(o.every);
if (every > 0) {
  for (let r = every; r <= Number(o.rounds); r += every) {
    sim.run(r - sim.cycle);
    console.log(JSON.stringify({ round: sim.cycle, hash: sim.hash() }));
  }
}
sim.run(Number(o.rounds) - sim.cycle);
console.log(JSON.stringify({ rounds: sim.cycle, score: sim.score(), alive: programs.map((_, k) => sim.alive(k)), hash: sim.hash() }));
