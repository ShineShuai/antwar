import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_INFLATED, decodeShare, encodeShare } from '../web/share.ts';
import { EXAMPLES } from '../web/default-ant.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { CLASSIC } from '../src/core/rules.ts';

test('share link round trip: seed, both brains, optional map; URL-safe token', async () => {
  const s = { seed: 191274032, brains: [EXAMPLES[0].text, 'ünïcode ; ✓\nMove 0 0'] as [string, string], map: '4\n4\n.\n', gen: 2 };
  const token = await encodeShare(s);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeShare(token), s);
  assert.deepEqual(await decodeShare(await encodeShare({ seed: 1, brains: ['a', 'b'] })), { seed: 1, brains: ['a', 'b'], map: undefined, gen: undefined });
});

test('share link decoder rejects garbage, wrong shapes and oversized payloads', async () => {
  assert.equal(await decodeShare(''), null);
  assert.equal(await decodeShare('not base64 !!'), null);
  assert.equal(await decodeShare('AAAA'), null);
  const bomb = await encodeShare({ seed: 1, brains: ['x'.repeat(MAX_INFLATED), ''] });
  assert.ok(bomb.length < 5000, 'highly compressible input stays tiny');
  assert.equal(await decodeShare(bomb), null, 'inflated size is capped');
  const raw = async (o: unknown): Promise<string> => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return Buffer.from(out).toString('base64url');
  };
  assert.equal(await decodeShare(await raw({ v: 2, seed: 1, brains: ['a', 'b'] })), null);
  assert.equal(await decodeShare(await raw({ v: 1, seed: 'x', brains: ['a', 'b'] })), null);
  assert.equal(await decodeShare(await raw({ v: 1, seed: 1, brains: ['a'] })), null);
  assert.ok(await decodeShare(await raw({ v: 1, seed: 1, brains: ['a', 'b'] })));
});

test('every built-in example loads as a Classic brain', () => {
  for (const e of EXAMPLES) assert.ok(loadAnyBrain(e.text, CLASSIC).program.n > 0, e.name);
});
