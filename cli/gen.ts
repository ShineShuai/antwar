#!/usr/bin/env node
// node cli/gen.ts SEED [--symmetric | --colonies N] > world.txt   (contest world, official file format; --symmetric: point-mirror ranked
// world; --colonies N: a fair world for N colonies, wrapped and without a rock border: docs/MATCH.md)
import { parseArgs } from 'node:util';
import { generateFairWorld } from '../src/core/gen.ts';
import { worldFor } from '../src/core/match.ts';
import { formatMap } from '../src/core/map.ts';

const { values: o, positionals: [arg] } = parseArgs({ allowPositionals: true, options: { symmetric: { type: 'boolean', default: false }, colonies: { type: 'string' } } });
const seed = Number(arg);
if (!Number.isInteger(seed) || (o.symmetric && o.colonies !== undefined)) { console.error('usage: gen.ts SEED [--symmetric | --colonies N]'); process.exit(2); }
try {
  process.stdout.write(formatMap(o.colonies !== undefined ? generateFairWorld(Number(o.colonies), seed) : worldFor(seed, o.symmetric)));
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
