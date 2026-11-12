import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSource } from '../scripts/lint-core.ts';

test('lint-core flags division, floats, Math.random and clocks; allows hex, modulo and **', () => {
  const bad = (src: string): number => lintSource('x.ts', src).length;
  assert.equal(bad('const a = 7 / 2;'), 1);
  assert.equal(bad('let a = 1; a /= 2;'), 1);
  assert.equal(bad('const a = 0.5;'), 1);
  assert.equal(bad('const a = 1e3;'), 1);
  assert.equal(bad('const a = Math.random();'), 1);
  assert.equal(bad('const a = new Date();'), 1);
  assert.equal(bad('const a = performance.now();'), 1);
  assert.equal(bad('const a = 0x811c9dc5 % 7 + (2 ** 31) + (5 >> 1); const re = /a/;'), 0);
});
