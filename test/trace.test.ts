import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, parseIcfp } from '../src/core/asm.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { RULESETS } from '../src/core/rules.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { TraceError, compareDump, dumpChunks, firstDiff, frameLines, mergeDumps, parseDump } from '../src/core/trace.ts';

const fx = (f: string): string => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const tiny = parseMap(fx('tiny.world'));
const starter = parseIcfp(fx('starter.ant'), CLASSIC);
const dumpOf = (opts: Parameters<typeof dumpChunks>[0], from: number, to: number): string => [...dumpChunks(opts, from, to)].join('');
const TINY = { map: tiny, programs: [starter, starter], rules: CLASSIC };

test('round 0 of tiny.world: the lines of the official dump, byte for byte', () => {
  const L = frameLines(createSim(TINY), tiny);
  assert.equal(L.length, 100);
  assert.equal(L[0], 'cell (0, 0): rock');
  assert.equal(L[11], 'cell (1, 1): 9 food; ');                 // a trailing space is part of the format
  assert.equal(L[13], 'cell (3, 1): ');                          // so is an empty remainder
  assert.equal(L[24], 'cell (4, 2): black hill; black ant of id 0, dir 0, food 0, state 0, resting 0');
  assert.equal(L[43], 'cell (3, 4): 5 food; ');
  assert.equal(L[51], 'cell (1, 5): red hill; red ant of id 16, dir 0, food 0, state 0, resting 0');
  assert.equal(L.filter((l) => l.includes('black ant')).length, 16);
  assert.equal(L.filter((l) => l.includes('red ant')).length, 16);
});

test('formatMap writes the official layout: the leading space is on odd rows, as in the task\'s tiny.world', () => {
  const text = fx('tiny.world');
  assert.equal(formatMap(tiny), text);
  assert.ok(text.split('\n')[2].startsWith('#') && text.split('\n')[3].startsWith(' #'));
});

test('marks list their digits in ascending order, per colour; resting counts 14 down after a move', () => {
  const map = parseMap('6\n4\n. . . . . .\n . + . . . .\n. . . . . .\n . . . . . .\n');
  const sim = createSim({ map, programs: [assemble('top: mark 3\nmark 0\nmove else top\nturn left\ngoto top', CLASSIC)], rules: CLASSIC });
  const at = (r: number, p: number): string => { sim.run(r - sim.cycle); return frameLines(sim, map)[p]; };
  assert.equal(at(2, 7), 'cell (1, 1): red hill; red marks: 03; red ant of id 0, dir 0, food 0, state 2, resting 0');
  assert.equal(at(3, 7), 'cell (1, 1): red hill; red marks: 03; ');
  assert.equal(at(3, 8), 'cell (2, 1): red ant of id 0, dir 0, food 0, state 3, resting 14');
  assert.equal(at(4, 8), 'cell (2, 1): red ant of id 0, dir 0, food 0, state 3, resting 13');
  assert.equal(at(17, 8), 'cell (2, 1): red ant of id 0, dir 0, food 0, state 3, resting 0');
  assert.equal(at(18, 8), 'cell (2, 1): red ant of id 0, dir 5, food 0, state 0, resting 0'); // the goto is free: back at state 0
});

test('black marks, food and a carried packet appear in the official order', () => {
  const map = parseMap('6\n4\n. . . . . .\n . - 3 . . .\n. . . . . .\n . . . . . .\n');
  const sim = createSim({ map, programs: [assemble('drop\ngoto 0', CLASSIC), assemble('top: mark 5\nmove else top\npickup else top\ngoto top', CLASSIC)], rules: CLASSIC });
  sim.run(17); // mark at 1, move at 2 (rests 14), pickup at 17
  assert.deepEqual(frameLines(sim, map).slice(7, 9), [
    'cell (1, 1): black hill; black marks: 5; ',
    'cell (2, 1): 2 food; black ant of id 0, dir 0, food 1, state 0, resting 0',
  ]);
});

test('two colonies at most: the format has red and black only', () => {
  const map = parseMap('6\n4\n. . . . . .\n . + - c . .\n. . . . . .\n . . . . . .\n');
  const p = assemble('drop\ngoto 0', CLASSIC);
  assert.throws(() => frameLines(createSim({ map, programs: [p, p, p], rules: RULESETS.colonies }), map), TraceError);
});

test('export, parse and compare round-trip; a changed line is found at its round and index', () => {
  const text = dumpOf(TINY, 0, 40);
  assert.ok(text.startsWith('random seed: 12345\n\nAfter round 0...\ncell (0, 0): rock\n'));
  const dump = parseDump(text);
  assert.equal(dump.frames.length, 41);
  assert.deepEqual(compareDump(dump, TINY), { ok: true, frames: 41, rounds: 40 });
  assert.deepEqual(parseDump(text.replace(/\n/g, '\r\n')), dump, 'CRLF files read the same');
  const k = dump.frames[17].lines.findIndex((l) => l.includes(', food 0,'));
  assert.ok(k >= 0);
  dump.frames[17].lines[k] = dump.frames[17].lines[k].replace(', food 0,', ', food 1,');
  const v = compareDump(dump, TINY);
  assert.ok(!v.ok && v.round === 17 && v.index === k && v.expected.includes('food 1,') && v.actual.includes('food 0,'), JSON.stringify(v));
});

test('the seed line is part of the proof: the same frames under another seed differ', () => {
  const text = dumpOf(TINY, 0, 60).replace('random seed: 12345', 'random seed: 12346');
  assert.equal(compareDump(parseDump(text), TINY).ok, false);
});

test('a dump that starts late is checked against a run from round 0', () => {
  const dump = parseDump(dumpOf(TINY, 25, 30));
  assert.deepEqual(dump.frames.map((f) => f.round), [25, 26, 27, 28, 29, 30]);
  assert.deepEqual(compareDump(dump, TINY), { ok: true, frames: 6, rounds: 30 });
});

test('chunk files share their boundary round; merge joins them and rejects conflicts', () => {
  const a = parseDump(dumpOf(TINY, 0, 10)), b = parseDump(dumpOf(TINY, 10, 20));
  const m = mergeDumps([b, a]);
  assert.deepEqual(m.frames.map((f) => f.round), Array.from({ length: 21 }, (_, i) => i));
  assert.deepEqual(compareDump(m, TINY), { ok: true, frames: 21, rounds: 20 });
  b.frames[0].lines[3] += 'x';
  assert.throws(() => mergeDumps([a, b]), /round 10 differs/);
  assert.throws(() => mergeDumps([a, { seed: 1, frames: [] }]), /seeds differ/);
  assert.throws(() => compareDump({ seed: 12345, frames: [...a.frames].reverse() }, TINY), /out of order/);
});

test('parseDump rejects framing errors with a line number', () => {
  assert.throws(() => parseDump('seed 1\n'), /line 1/);
  assert.throws(() => parseDump('random seed: 1\n\nRound 0\n'), /line 3/);
  assert.throws(() => parseDump('random seed: 1\ncell (0, 0): rock\n'), /line 2/);
  assert.deepEqual(parseDump('random seed: 7\n'), { seed: 7, frames: [] });
});

test('firstDiff treats a missing line as different', () => {
  assert.equal(firstDiff(['a'], ['a']), undefined);
  assert.deepEqual(firstDiff(['a', 'b'], ['a']), { index: 1, expected: 'b', actual: '' });
});
