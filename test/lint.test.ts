import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSource } from '../scripts/lint-core.ts';

test('lint-core flags division, floats, fractional Math functions, Math.random and clocks; allows hex, modulo and **', () => {
  const bad = (src: string): number => lintSource('x.ts', src).length;
  assert.equal(bad('const a = 7 / 2;'), 1);
  assert.equal(bad('let a = 1; a /= 2;'), 1);
  assert.equal(bad('const a = 0.5;'), 1);
  assert.equal(bad('const a = 1e3;'), 1);
  assert.equal(bad('const a = Math.random();'), 1);
  assert.equal(bad('const a = new Date();'), 1);
  assert.equal(bad('const a = performance.now();'), 1);
  for (const f of ['sqrt(2)', 'pow(2, 3)', 'floor(1)', 'round(1)', 'PI', 'log(1)']) assert.equal(bad(`const a = Math.${f};`), 1, f);
  assert.equal(bad('const a = parseFloat("1");'), 1);
  assert.equal(bad('const a = Math.imul(3, 5) + Math.min(1, 2) + Math.max(1, 2) + Math.abs(-1) + Math.clz32(1) + Math.sign(-3);'), 0);
  assert.equal(bad('const a = 0x811c9dc5 % 7 + (2 ** 31) + (5 >> 1); const re = /a/;'), 0);
});
