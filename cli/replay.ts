#!/usr/bin/env node
// Replay descriptors (docs/REPLAY.md):
//   node cli/replay.ts record --ant A [--ant B] [--map W] [--rounds 100000] [--seed 12345] [--rules classic] [--no-wrap] [--src] [--out F]
//   node cli/replay.ts verify F...        re-run each descriptor; exit 1 if any checkpoint or the final hash differs
//   node cli/replay.ts seek F ROUND       state at ROUND via keyframes; compared with the stored hash when ROUND is a checkpoint
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { HASH_EVERY, createReplay, fromFlat, parseDescriptor, record, verify } from '../src/core/replay.ts';
import { generateWorld } from '../src/core/gen.ts';
import { parseMap } from '../src/core/map.ts';
import { loadAnyBrain } from '../src/lang/index.ts';

const { values: o, positionals: [cmd, ...rest] } = parseArgs({ allowPositionals: true, options: {
  map: { type: 'string' }, ant: { type: 'string', multiple: true }, rounds: { type: 'string', default: '100000' },
  seed: { type: 'string', default: '12345' }, rules: { type: 'string', default: 'classic' },
  'no-wrap': { type: 'boolean', default: false }, src: { type: 'boolean', default: false }, out: { type: 'string' },
} });
const die = (m: string): never => { console.error(m); process.exit(2); };
const readJson = (f: string): unknown => JSON.parse(readFileSync(f, 'utf8'));

if (cmd === 'record') {
  const ants = o.ant ?? [];
  if (!ants.length) die('usage: replay.ts record --ant FILE [--ant FILE] [--map FILE] [--rounds N] [--seed S] [--rules R]');
  if (!Object.hasOwn(RULESETS, o.rules)) die(`unknown ruleset "${o.rules}"; try ${Object.keys(RULESETS).join(', ')}`);
  const id = o.rules as RulesId, texts = ants.map((f) => readFileSync(f, 'utf8'));
  if (texts.length === 1) texts.push(texts[0]);
  const d = record({
    rules: id, seed: Number(o.seed), rounds: Number(o.rounds), wrap: !o['no-wrap'],
    programs: texts.map((t) => loadAnyBrain(t, RULESETS[id]).program),
    map: o.map === undefined ? undefined : readFileSync(o.map, 'utf8'), sources: o.src ? texts : undefined,
  });
  const json = JSON.stringify(d);
  if (o.out) writeFileSync(o.out, `${json}\n`); else console.log(json);
  console.error(`recorded ${d.rounds} rounds, ${d.brains.length} brains, hash ${d.hash}`);
} else if (cmd === 'verify') {
  if (!rest.length) die('usage: replay.ts verify FILE...');
  let failed = 0;
  for (const f of rest) {
    const v = verify(readJson(f));
    if (v.ok) console.log(`ok   ${f}: ${v.rounds} rounds, hash ${v.hash}`);
    else { failed++; console.log(`FAIL ${f}: ${v.reason}: ${v.message}`); }
  }
  process.exit(failed ? 1 : 0);
} else if (cmd === 'seek') {
  const round = Number(rest[1]);
  if (!rest[0] || !Number.isSafeInteger(round) || round < 0) die('usage: replay.ts seek FILE ROUND');
  const d = parseDescriptor(readJson(rest[0])), rules = RULESETS[d.rules];
  const rp = createReplay({ map: d.map === undefined ? generateWorld(d.seed) : parseMap(d.map), programs: d.brains.map((b) => fromFlat(b.ir, rules)),
    seed: d.seed, rules, wrap: d.wrap !== false });
  rp.seek(round);
  const stored = round % HASH_EVERY === 0 && round > 0 ? d.checkpoints[round / HASH_EVERY - 1] : undefined, hash = rp.sim.hash();
  console.log(JSON.stringify({ round: rp.round, hash, score: rp.sim.score(), match: stored === undefined ? undefined : stored === hash }));
} else die('usage: replay.ts record|verify|seek ...');
