#!/usr/bin/env node
// node cli/gen.ts SEED [--symmetric] > world.txt   (contest world, official file format; --symmetric: point-mirror ranked world)
import { parseArgs } from 'node:util';
import { worldFor } from '../src/core/match.ts';
import { formatMap } from '../src/core/map.ts';

const { values: o, positionals: [arg] } = parseArgs({ allowPositionals: true, options: { symmetric: { type: 'boolean', default: false } } });
const seed = Number(arg);
if (!Number.isInteger(seed)) { console.error('usage: gen.ts SEED [--symmetric]'); process.exit(2); }
process.stdout.write(formatMap(worldFor(seed, o.symmetric)));
