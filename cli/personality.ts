#!/usr/bin/env node
// Print the rules text for a personality: node cli/personality.ts --template trail [--curiosity 1] [--boldness 1]
//   [--sociability 1] [--mix 70/20/10]  (worker/scout/guard percent; trail and raider only)
import { parseArgs } from 'node:util';
import { DEFAULTS, TEMPLATES, personality } from '../src/lang/templates.ts';
import type { Personality, Template } from '../src/lang/templates.ts';

const { values: o } = parseArgs({ options: {
  template: { type: 'string', default: 'trail' }, curiosity: { type: 'string' }, boldness: { type: 'string' },
  sociability: { type: 'string' }, mix: { type: 'string' },
} });
if (!TEMPLATES.includes(o.template as Template)) { console.error(`usage: personality.ts --template ${TEMPLATES.join('|')} [--curiosity 0-4] [--boldness 0-3] [--sociability 0-2] [--mix W/S/G]`); process.exit(2); }
const d = DEFAULTS[o.template as Template];
const p: Personality = {
  template: d.template, curiosity: Number(o.curiosity ?? d.curiosity), boldness: Number(o.boldness ?? d.boldness), sociability: Number(o.sociability ?? d.sociability),
};
if (o.mix) { const [worker, scout, guard] = o.mix.split('/').map(Number); p.mix = { worker, scout, guard }; }
try { process.stdout.write(personality(p)); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
