#!/usr/bin/env node
// node cli/run.js --map w.world --ant a.ant [--ant b.ant] [--rounds 100000] [--seed 12345] [--rules classic|tiny]
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { assemble, parseIcfp } from '../src/core/asm.js';
import { parseMap } from '../src/core/map.js';
import { CLASSIC, TINYMINDS, createSim } from '../src/core/sim.js';

const { values: o } = parseArgs({ options: {
  map: { type: 'string' }, ant: { type: 'string', multiple: true }, rounds: { type: 'string', default: '100000' },
  seed: { type: 'string', default: '12345' }, rules: { type: 'string', default: 'classic' },
} });
if (!o.map || !o.ant?.length) { console.error('usage: run.js --map FILE --ant FILE [--ant FILE]'); process.exit(2); }
const rules = o.rules === 'tiny' ? TINYMINDS : CLASSIC;
const load = (f) => (f.endsWith('.asm') ? assemble : parseIcfp)(readFileSync(f, 'utf8'), rules);
const programs = o.ant.length === 1 ? [load(o.ant[0]), load(o.ant[0])] : o.ant.map(load);
const sim = createSim({ map: parseMap(readFileSync(o.map, 'utf8')), programs, seed: +o.seed, rules });
sim.run(+o.rounds);
console.log(JSON.stringify({ rounds: sim.cycle, score: sim.score(), alive: programs.map((_, k) => sim.alive(k)), hash: sim.hash() }));
