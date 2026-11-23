#!/usr/bin/env node
// Behavioural fairness: the same brain in every colony; does each colony win about 1 game in n? (docs/MATCH.md)
//   node cli/fairness.ts BRAIN [--world FILE | --colonies N | --symmetric] [--map-seed S] [--games 200] [--from 1]
//                              [--rounds 30000] [--rules R] [--json]
// Worlds: the contest generator, or --symmetric (point mirror), or --colonies N (fair worlds for N colonies), or one --world FILE.
// By default every game has its own world and simulator seed, from + game number: that tests the generator. With --map-seed S (or
// --world) the map stays the same and only the simulator seed changes: that tests the map. The rules default to classic.
// Exit code 0 whatever the verdict (it is a measurement); 2 for bad arguments.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import type { WorldMap } from '../src/core/types.ts';
import { coloniesOf, fairGame, fairness, fairnessHeader, fairnessLines, worldLabel, worldMaker } from '../src/fairness.ts';
import type { WorldSpec } from '../src/fairness.ts';
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

const spec: WorldSpec = o.world !== undefined ? { kind: 'map', mapText: readFileSync(o.world, 'utf8') }
  : nColonies !== undefined ? { kind: 'fair', colonies: nColonies, mapSeed } : { kind: o.symmetric ? 'mirror' : 'contest', mapSeed };
let make: (seed: number) => WorldMap;
try { make = worldMaker(spec); } catch (e) { make = () => die(e instanceof Error ? e.message : String(e)); }
const mapOf = (seed: number): WorldMap => { try { return make(seed); } catch (e) { return die(e instanceof Error ? e.message : String(e)); } };

const first = mapOf(from), n = coloniesOf(first);
const rulesId = (o.rules ?? 'classic') as RulesId, rules = RULESETS[rulesId];
const program = loadAnyBrain(readFileSync(files[0], 'utf8'), rules).program;
const foods: number[][] = [];
for (let g = 0; g < games; g++) {
  const seed = from + g, map = mapOf(seed);
  if (coloniesOf(map) !== n) die('the worlds do not all have the same number of colonies');
  foods.push(fairGame(map, program, seed, rounds, rules));
}
const result = fairness(foods);
const what = worldLabel(spec, o.world);
if (o.json) {
  console.log(JSON.stringify({ brain: files[0], world: what, rules: rulesId, rounds, from, ...result }));
} else {
  console.log(fairnessHeader(files[0], spec, o.world ?? '', result.games, rounds, rulesId));
  for (const line of fairnessLines(result)) console.log(line);
}
