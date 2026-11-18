#!/usr/bin/env node
// Official ICFP 2004 dumps (docs/TRACE.md):
//   node cli/trace.ts export  --map W --ant A [--ant B] [--rounds 10000] [--from 0] [--seed 12345] [--no-wrap] [--out F]
//   node cli/trace.ts compare --map W --ant A [--ant B] [--no-wrap] DUMP...    (.gz ok; chunk files are merged; exit 1 on a difference)
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { CLASSIC } from '../src/core/rules.ts';
import { parseMap } from '../src/core/map.ts';
import { TraceError, compareDump, dumpChunks, mergeDumps, parseDump } from '../src/core/trace.ts';
import { loadAnyBrain } from '../src/lang/index.ts';

const { values: o, positionals: [cmd, ...files] } = parseArgs({ allowPositionals: true, options: {
  map: { type: 'string' }, ant: { type: 'string', multiple: true }, rounds: { type: 'string', default: '10000' },
  from: { type: 'string', default: '0' }, seed: { type: 'string', default: '12345' }, 'no-wrap': { type: 'boolean', default: false },
  out: { type: 'string' },
} });
function die(m: string): never { console.error(m); return process.exit(2); }
if ((cmd !== 'export' && cmd !== 'compare') || !o.map || !o.ant?.length) {
  die('usage: trace.ts export|compare --map FILE --ant FILE [--ant FILE] [...] (see the header of cli/trace.ts)');
}
const texts = o.ant.map((f) => readFileSync(f, 'utf8'));
if (texts.length === 1) texts.push(texts[0]);
const map = parseMap(readFileSync(o.map, 'utf8'));
const opts = { map, programs: texts.map((t) => loadAnyBrain(t, CLASSIC).program), rules: CLASSIC, wrap: !o['no-wrap'] };

try {
  if (cmd === 'export') {
    const fd = o.out ? openSync(o.out, 'w') : 1;
    for (const chunk of dumpChunks({ ...opts, seed: Number(o.seed) }, Number(o.from), Number(o.rounds))) writeSync(fd, chunk);
    if (o.out) closeSync(fd);
  } else {
    if (!files.length) die('usage: trace.ts compare ... DUMP...');
    const read = (f: string): string => (f.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString('latin1') : readFileSync(f, 'latin1'));
    const dump = mergeDumps(files.map((f) => parseDump(read(f))));
    const v = compareDump(dump, opts);
    if (v.ok) console.log(`ok: ${v.frames} frames, rounds ${dump.frames[0].round}..${v.rounds} identical`);
    else {
      console.log(`DIFF at round ${v.round}, line ${v.index + 1} of the frame:\n  official: ${v.expected}\n  ours:     ${v.actual}`);
      process.exit(1);
    }
  }
} catch (e) {
  if (e instanceof TraceError) die(e.message);
  throw e;
}
