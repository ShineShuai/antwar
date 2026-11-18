// The ICFP 2004 task's own trace (section 2.13): tiny.world x sample.ant, seed 12345, the whole state after each of rounds 0..10000.
// The files are not committed; `node scripts/fetch-trace.ts` puts them in traces/official/ (docs/TRACE.md).
// Skipped when absent, a failure when ANTWAR_OFFICIAL=1 (CI sets it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseIcfp } from '../src/core/asm.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { CLASSIC } from '../src/core/rules.ts';
import { compareDump, mergeDumps, parseDump } from '../src/core/trace.ts';

const manifest = JSON.parse(readFileSync(new URL('../spec/official-trace.json', import.meta.url), 'utf8')) as {
  seed: number; rounds: number; sha256: Record<string, string>;
};
const url = (f: string): URL => new URL(`../traces/official/${f}`, import.meta.url);
const names = Object.keys(manifest.sha256);
const present = names.every((f) => existsSync(url(f)));
const required = process.env.ANTWAR_OFFICIAL === '1';
const skip = !present && !required ? 'official trace not downloaded: node scripts/fetch-trace.ts' : false;

test('official trace: the pinned files are the ones we ran against; formatMap writes tiny.world byte for byte', { skip }, () => {
  assert.ok(present, 'traces/official/ is incomplete: node scripts/fetch-trace.ts');
  const world = readFileSync(url('tiny.world'), 'utf8');
  assert.equal(formatMap(parseMap(world)), world);
  for (const f of names) assert.equal(createHash('sha256').update(readFileSync(url(f))).digest('hex'), manifest.sha256[f], f);
});

for (const wrap of [true, false]) {
  test(`official trace: all 10,001 frames identical (${wrap ? 'toroidal' : 'bounded'} world)`, { skip }, () => {
    assert.ok(present, 'traces/official/ is incomplete: node scripts/fetch-trace.ts');
    const ant = parseIcfp(readFileSync(url('sample.ant'), 'utf8'), CLASSIC);
    const dump = mergeDumps(names.filter((f) => f.endsWith('.gz')).map((f) => parseDump(gunzipSync(readFileSync(url(f))).toString('latin1'))));
    assert.equal(dump.seed, manifest.seed);
    assert.equal(dump.frames.length, manifest.rounds + 1);
    const v = compareDump(dump, { map: parseMap(readFileSync(url('tiny.world'), 'utf8')), programs: [ant, ant], rules: CLASSIC, wrap });
    assert.deepEqual(v, { ok: true, frames: manifest.rounds + 1, rounds: manifest.rounds });
  });
}
