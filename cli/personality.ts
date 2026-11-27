#!/usr/bin/env node
// Print the rules text for a personality: node cli/personality.ts --template trail [--curiosity 1] [--boldness 1]
//   [--sociability 1] [--settling 2] [--colonies 3] [--mix 70/20/10]  (settling: keeper only, 1 time in 20/15/10/7; colonies: keeper only, the
//   number of colonies of the map, 3 to 26: the dose is then 1 in 40, which wins with three or more; not with --settling; mix: worker/scout/guard
//   percent, trail and raider only)
import { parseArgs } from 'node:util';
import { DEFAULTS, TEMPLATES, personality } from '../src/lang/templates.ts';
import type { Personality, Template } from '../src/lang/templates.ts';

const { values: o } = parseArgs({ options: {
  template: { type: 'string', default: 'trail' }, curiosity: { type: 'string' }, boldness: { type: 'string' },
  sociability: { type: 'string' }, settling: { type: 'string' }, colonies: { type: 'string' }, mix: { type: 'string' },
} });
if (!TEMPLATES.includes(o.template as Template)) { console.error(`usage: personality.ts --template ${TEMPLATES.join('|')} [--curiosity 0-4] [--boldness 0-3] [--sociability 0-2] [--settling 0-3] [--colonies 3-26] [--mix W/S/G]`); process.exit(2); }
const d = DEFAULTS[o.template as Template];
const p: Personality = {
  template: d.template, curiosity: Number(o.curiosity ?? d.curiosity), boldness: Number(o.boldness ?? d.boldness), sociability: Number(o.sociability ?? d.sociability),
};
if (o.settling !== undefined) p.settling = Number(o.settling);
if (o.colonies !== undefined) p.colonies = Number(o.colonies);
if (o.mix) { const [worker, scout, guard] = o.mix.split('/').map(Number); p.mix = { worker, scout, guard }; }
try { process.stdout.write(personality(p)); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
