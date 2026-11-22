#!/usr/bin/env node
// Behavioural fairness: the same brain in every colony; does each colony win about 1 game in n? (docs/MATCH.md)
//   node cli/fairness.ts BRAIN [--world FILE | --colonies N | --symmetric] [--map-seed S] [--games 200] [--from 1]
//                              [--rounds 30000] [--rules R] [--json]
// Worlds: the contest generator, or --symmetric (point mirror), or --colonies N (fair worlds for N colonies), or one --world FILE.
// By default every game has its own world and simulator seed, from + game number: that tests the generator. With --map-seed S (or
// --world) the map stays the same and only the simulator seed changes: that tests the map. Rules default to classic for two colonies,
// colonies for more. Exit code 0 whatever the verdict (it is a measurement); 2 for bad arguments.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateFairWorld } from '../src/core/gen.ts';
import { playColonies, worldFor } from '../src/core/match.ts';
import { parseMap } from '../src/core/map.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import type { WorldMap } from '../src/core/types.ts';
import { fairness } from '../src/fairness.ts';
import { loadAnyBrain } from '../src/lang/index.ts';

const { values: o, positionals: files } = parseArgs({ allowPositionals: true, options: {
  world: { type: 'string' }, colonies: { type: 'string' }, symmetric: { type: 'boolean', default: false }, 'map-seed': { type: 'string' },
  games: { type: 'string', default: '200' }, from: { type: 'string', default: '1' }, rounds: { type: 'string', default: '30000' },
  rules: { type: 'string' }, json: { type: 'boolean', default: false },
} });
const die = (m: string): never => { console.error(m); process.exit(2); };
const int = (v: string, lo: number, what: string): number => (/^\d+$/.test(v) && Number(v) >= lo ? Number(v) : die(`${what} must be an integer >= ${lo}`));
if (files.length !== 1) die('usage: fairness.ts BRAIN [--world FILE | --colonies N | --symmetric] [--map-seed S] [--games N] [--from SEED] [--rounds N] [--rules R] [--json]');
if ([o.world !== undefined, o.colonies !== undefined, o.symmetric].filter(Boolean).length > 1) die('--world, --colonies and --symmetric exclude each other');
if (o.world !== undefined && o['map-seed'] !== undefined) die('--world is one map already; --map-seed is for generated worlds');
if (o.rules !== undefined && !Object.hasOwn(RULESETS, o.rules)) die(`unknown ruleset "${o.rules}"; try ${Object.keys(RULESETS).join(', ')}`);
const games = int(o.games, 1, '--games'), from = int(o.from, 0, '--from'), rounds = int(o.rounds, 0, '--rounds');
const mapSeed = o['map-seed'] === undefined ? undefined : int(o['map-seed'], 0, '--map-seed');
const nColonies = o.colonies === undefined ? undefined : int(o.colonies, 2, '--colonies');

const fixed: WorldMap | undefined = o.world !== undefined ? parseMap(readFileSync(o.world, 'utf8')) : undefined;
const make = (seed: number): WorldMap => {
  if (fixed) return fixed;
  try { return nColonies !== undefined ? generateFairWorld(nColonies, seed) : worldFor(seed, o.symmetric); } catch (e) { return die(e instanceof Error ? e.message : String(e)); }
};
const count = (m: WorldMap): number => Math.max(2, 1 + Math.max(...m.hill));
let cache: WorldMap | undefined;
const mapOf = (seed: number): WorldMap => (fixed ?? (mapSeed !== undefined ? (cache ??= make(mapSeed)) : make(seed)));

const first = mapOf(from), n = count(first);
const rulesId = (o.rules ?? (n > 2 ? 'colonies' : 'classic')) as RulesId, rules = RULESETS[rulesId];
const program = loadAnyBrain(readFileSync(files[0], 'utf8'), rules).program;
const foods: number[][] = [];
for (let g = 0; g < games; g++) {
  const seed = from + g, map = mapOf(seed);
  if (count(map) !== n) die('the worlds do not all have the same number of colonies');
  foods.push(playColonies(map, Array.from({ length: n }, () => program), seed, rounds, rules));
}
const result = fairness(foods);
const what = fixed ? `map ${o.world}` : `${nColonies !== undefined ? `fair worlds, ${nColonies} colonies` : o.symmetric ? 'symmetric worlds' : 'contest worlds'}${mapSeed !== undefined ? `, the map of seed ${mapSeed}` : ', a new world per game'}`;
if (o.json) {
  console.log(JSON.stringify({ brain: files[0], world: what, rules: rulesId, rounds, from, ...result }));
} else {
  const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
  console.log(`${files[0]} in every colony | ${what} | ${result.games} games of ${rounds} rounds | rules ${rulesId}`);
  console.log('colony  win chance  z       mean points  mean food');
  for (const r of result.rows) console.log(`${String.fromCharCode(65 + r.colony).padEnd(7)} ${pct(r.share).padEnd(11)} ${r.z.toFixed(2).padStart(5)}   ${r.points.toFixed(2).padStart(11)}  ${r.food.toFixed(1).padStart(9)}`);
  console.log(`fair would be ${pct(1 / n)} each and ${n - 1} point${n === 2 ? '' : 's'}. ${result.fair ? 'No bias found' : 'BIASED'} (p = ${result.p.toFixed(3)}, Bonferroni over ${n} colonies); a bias below +-${pct(result.resolution)} of win chance cannot be seen with ${result.games} games.`);
}
