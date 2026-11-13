#!/usr/bin/env node
// node cli/gen.ts SEED > world.txt   (Classic contest world, official file format)
import { generateWorld } from '../src/core/gen.ts';
import { formatMap } from '../src/core/map.ts';

const seed = Number(process.argv[2]);
if (!Number.isInteger(seed)) { console.error('usage: gen.ts SEED'); process.exit(2); }
process.stdout.write(formatMap(generateWorld(seed)));
