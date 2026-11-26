#!/usr/bin/env node
// Does the order in which the colonies act favour one of them? One brain in every colony of fair worlds (identical terrain for all), many
// worlds, then the win chances and the paired food difference. Resumable and time-boxed, so a long measurement can be done in pieces:
//   node scripts/order-bias.ts BRAIN --colonies 3 --rules altorder --games 600 [--from 1] [--rounds 30000] [--budget 240] [--out /tmp/order]
//   node scripts/order-bias.ts --report FILE.jsonl [FILE.jsonl ...]     pool the files and print the tables
// The games are those of `cli/fairness.ts BRAIN --colonies N --from S`; each game's food goes on one line of the file named after the setup.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { fairGame, fairness, fairnessLines, foodVsOthers, worldMaker } from '../src/fairness.ts';
import { loadAnyBrain } from '../src/lang/index.ts';

const { values: o, positionals: files } = parseArgs({ allowPositionals: true, options: {
  colonies: { type: 'string' }, rules: { type: 'string', default: 'classic' }, games: { type: 'string', default: '300' }, from: { type: 'string', default: '1' },
  rounds: { type: 'string', default: '30000' }, budget: { type: 'string', default: '240' }, out: { type: 'string', default: '.' }, report: { type: 'boolean', default: false },
} });
const die = (m: string): never => { console.error(m); process.exit(2); };
const letter = (c: number): string => String.fromCharCode(65 + c);

if (o.report) {
  if (files.length === 0) die('usage: order-bias.ts --report FILE.jsonl [FILE.jsonl ...]');
  const foods = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as number[]));
  if (foods.length < 2) die('fewer than 2 games in the files');
  console.log(`${foods.length} fair worlds, one brain in every colony`);
  for (const l of fairnessLines(fairness(foods))) console.log(l);
  const rows = foodVsOthers(foods), n = rows.length, bonferroni = [0, 0, 1.96, 2.39, 2.50, 2.58, 2.64][n] ?? 2.7;
  console.log(`nest food of each colony minus the mean of the others, per world (paired; Bonferroni |z| > ${bonferroni} for ${n} colonies; confirm anything on fresh seeds):`);
  for (const r of rows) console.log(`  ${letter(r.colony)}: ${r.mean >= 0 ? '+' : ''}${r.mean.toFixed(1)} +- ${(1.96 * r.se).toFixed(1)} (z ${r.z.toFixed(2)})`);
} else {
  if (files.length !== 1 || !o.colonies) die('usage: order-bias.ts BRAIN --colonies N [--rules R] [--games G] [--from S] [--rounds N] [--budget SECONDS] [--out DIR]   (or --report FILE...)');
  const n = Number(o.colonies), games = Number(o.games), from = Number(o.from), rounds = Number(o.rounds), budget = Number(o.budget) * 1000, rules = o.rules as RulesId;
  if (!Object.hasOwn(RULESETS, rules)) die(`unknown ruleset "${rules}"`);
  if (![n, games, from, rounds, budget].every((x) => Number.isInteger(x) && x >= 0) || n < 2 || games < 1) die('--colonies, --games, --from, --rounds and --budget are whole numbers');
  mkdirSync(o.out, { recursive: true });
  const file = join(o.out, `foods_${n}_${rules}_${basename(files[0])}_from${from}.jsonl`);
  let g = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
  const program = loadAnyBrain(readFileSync(files[0], 'utf8'), RULESETS[rules]).program, make = worldMaker({ kind: 'fair', colonies: n }), t0 = Date.now();
  try {
    for (; g < games && Date.now() - t0 < budget; g++) { const seed = from + g; appendFileSync(file, `${JSON.stringify(fairGame(make(seed), program, seed, rounds, RULESETS[rules]))}\n`); }
  } catch (e) { die(e instanceof Error ? e.message : String(e)); }
  console.log(`${file}: ${g}/${games} games${g < games ? ' (budget reached: run the same command again to go on)' : ''}`);
}
