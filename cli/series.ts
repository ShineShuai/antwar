#!/usr/bin/env node
// Nest food (or ants alive) over time in one game: the numbers behind the workshop's chart.
//   node cli/series.ts A.rules B.ant [C ...] [--world FILE] [--seed 1] [--rounds 100000] [--every 500] [--rules R] [--what food|alive] [--json]
// One brain per hill, in hill order. Without --world: two brains on the contest generator's world of the seed (the workshop's default
// world); the simulator seed is --seed either way. The first row is round 0, the last row the last round.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { MATCH_ROUNDS } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { playSeries } from '../src/series.ts';

const { values: o, positionals: files } = parseArgs({ allowPositionals: true, options: {
  world: { type: 'string' }, seed: { type: 'string', default: '1' }, rounds: { type: 'string', default: String(MATCH_ROUNDS) }, every: { type: 'string', default: '500' },
  rules: { type: 'string' }, what: { type: 'string', default: 'food' }, json: { type: 'boolean', default: false },
} });
const die = (m: string): never => { console.error(m); process.exit(2); };
const int = (v: string, lo: number, what: string): number => (/^\d+$/.test(v) && Number(v) >= lo ? Number(v) : die(`${what} must be an integer >= ${lo}`));
const n = files.length;
if (n < 2 || n > 26) die('usage: series.ts A B [C ...] (2 to 26 brains, one per hill) [--world FILE] [--seed N] [--rounds N] [--every N] [--rules R] [--what food|alive] [--json]');
if (o.world === undefined && n !== 2) die('without --world the world is the contest generator\'s: use two brains');
const rulesId = (o.rules ?? 'classic') as RulesId;
if (!Object.hasOwn(RULESETS, rulesId)) die(`unknown ruleset "${rulesId}"; try ${Object.keys(RULESETS).join(', ')}`);
if (o.what !== 'food' && o.what !== 'alive') die('--what is food or alive');
const seed = int(o.seed, 0, '--seed'), rounds = int(o.rounds, 0, '--rounds'), every = int(o.every, 1, '--every');
const names = files.map((f, i) => (files.some((g, j) => j !== i && basename(g) === basename(f)) ? f : basename(f)));
const series = ((): ReturnType<typeof playSeries> => {
  try { return playSeries(files.map((f) => readFileSync(f, 'utf8')), { rules: rulesId, rounds, every, mapText: o.world === undefined ? undefined : readFileSync(o.world, 'utf8') }, seed); } catch (e) { return die(e instanceof Error ? e.message : String(e)); }
})();
const data = o.what === 'food' ? series.food : series.alive;
if (o.json) {
  console.log(JSON.stringify({ config: { rules: rulesId, seed, rounds, every, world: o.world ?? 'contest' }, entries: names, series }));
} else {
  console.log(`${n} brains, seed ${seed}, ${o.world ?? 'the contest world of the seed'}, ${rounds} rounds sampled every ${every}, rules ${rulesId}; ${o.what === 'food' ? 'nest food' : 'ants alive'}`);
  console.log(`${'round'.padStart(7)}${names.map((x) => x.slice(0, 12).padStart(13)).join('')}`);
  series.at.forEach((r, k) => console.log(`${String(r).padStart(7)}${data[k].map((v) => String(v).padStart(13)).join('')}`));
}
