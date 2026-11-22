import test from 'node:test';
import assert from 'node:assert/strict';
import { allReachable, generateWorld } from '../src/core/gen.ts';
import { parseMap } from '../src/core/map.ts';
import { ANT_STRIDE } from '../src/core/types.ts';
import { createEngine } from '../web/engine.ts';
import type { Reply } from '../web/protocol.ts';
import { STARTER } from '../web/default-ant.ts';
import { MAX_COLONIES, colonyCount, colonyName, exampleWorld, keepBrains, letter, padBrains, paletteFor, rulesFor, statusLine } from '../web/colonies.ts';
import { describeCell } from '../web/inspect.ts';
import { decodeShare, encodeShare } from '../web/share.ts';
import { DARK, LIGHT, createViewer, layout } from '../web/viewer.ts';
import type { Ctx } from '../web/viewer.ts';

type Of<T extends Reply['type']> = Extract<Reply, { type: T }>;

test('labels and counts: A to Z, a colour name for the first eight, colonies = highest hill letter (never fewer than two)', () => {
  assert.deepEqual([0, 1, 2, 25].map(letter), ['A', 'B', 'C', 'Z']);
  assert.deepEqual([0, 1, 2, 7, 8].map(colonyName), ['red', 'blue', 'green', 'brown', 'colony I']);
  assert.equal(colonyCount(generateWorld(1).hill), 2);
  assert.equal(colonyCount(parseMap(exampleWorld(5)).hill), 5);
  assert.equal(colonyCount(Int8Array.from([-1, -1])), 2, 'a map with one hill still shows two editors');
  assert.equal(colonyCount(Int8Array.from([0, 25])), 26);
});

test('the ruleset a map needs: the chosen one while it allows that many colonies, else the many-colonies ruleset', () => {
  assert.equal(rulesFor('classic', 2), 'classic');
  assert.equal(rulesFor('classic', 3), 'colonies');
  assert.equal(rulesFor('tinyminds', 26), 'tinyminds', 'Tinyminds allows 26 already');
  assert.equal(rulesFor('altorder', 4), 'colonies');
  assert.equal(rulesFor('colonies', 26), 'colonies');
});

test('padBrains gives exactly n texts: the ones given, then the fill', () => {
  assert.deepEqual(padBrains(['a', 'b'], 4, 'x'), ['a', 'b', 'x', 'x']);
  assert.deepEqual(padBrains(['a', 'b', 'c'], 2, 'x'), ['a', 'b']);
});

test('palette: the contest colours for A and B, then one distinct hue per colony, in both themes', () => {
  for (const [dark, base] of [[false, LIGHT], [true, DARK]] as const) {
    const two = paletteFor(2, dark), many = paletteFor(26, dark);
    assert.deepEqual([two.hill, two.ant, two.mark], [base.hill, base.ant, base.mark], 'two colonies look as before');
    for (const k of ['hill', 'ant', 'mark'] as const) {
      assert.equal(many[k].length, 26);
      assert.deepEqual(many[k].slice(0, 2), base[k]);
      assert.equal(new Set(many[k]).size, 26, `${k} colours are all different`);
    }
  }
  assert.notDeepEqual(paletteFor(5, false).ant, paletteFor(5, true).ant);
});

test('status line: the contest wording for two colonies, the ranking (more food first, equal food shares a place) for more', () => {
  assert.equal(statusLine(10, [3, 4], [91, 90], 100000), 'Round 10 | A 3 (91 ants) | B 4 (90 ants)');
  assert.equal(statusLine(100000, [3, 4], [91, 90], 100000), 'Round 100000 | A 3 (91 ants) | B 4 (90 ants) | B wins');
  assert.equal(statusLine(100000, [4, 3], [1, 2], 100000).endsWith('| A wins'), true);
  assert.equal(statusLine(100000, [4, 4], [1, 2], 100000).endsWith('| draw'), true);
  assert.equal(statusLine(5, [1, 2, 3], [10, 9, 8], 100000), 'Round 5 | A 1 (10 ants) | B 2 (9 ants) | C 3 (8 ants)');
  assert.equal(statusLine(100000, [1, 7, 3], [1, 1, 1], 100000), 'Round 100000 | A 1 (1 ants) | B 7 (1 ants) | C 3 (1 ants) | ranking B > C > A');
  assert.equal(statusLine(100000, [7, 1, 7], [1, 1, 1], 100000).endsWith('| ranking A = C > B'), true);
  assert.equal(statusLine(100000, [5, 5, 5], [1, 1, 1], 100000).endsWith('| ranking A = B = C'), true);
  assert.equal(statusLine(100000, [2, 9, 4, 9, 0], [1, 1, 1, 1, 1], 100000).endsWith('| ranking B = D > C > A > E'), true);
  assert.equal(statusLine(99999, [1, 7, 3], [1, 1, 1], 100000).includes('ranking'), false, 'only at the end of the match')
});

test('example worlds: valid, one hill each of about the same size, food reachable, deterministic, sizes within the 200 limit', () => {
  for (const n of [2, 3, 4, 6, 8, 12, 16, MAX_COLONIES]) {
    const text = exampleWorld(n), m = parseMap(text), cnt = new Array<number>(n).fill(0);
    for (let p = 0; p < m.W * m.H; p++) if (m.hill[p] >= 0) cnt[m.hill[p]]++;
    assert.ok(m.W <= 200 && m.H <= 200 && m.H % 2 === 0 && m.W === m.H, `${n}: ${m.W}x${m.H}`);
    assert.equal(colonyCount(m.hill), n);
    assert.ok(Math.min(...cnt) >= 20 && Math.max(...cnt) - Math.min(...cnt) <= 5, `${n} colonies: hills ${cnt.join(' ')}`);
    assert.ok(allReachable(m), `${n}: unreachable food or hill`);
    assert.equal(exampleWorld(n), text);
  }
  assert.throws(() => exampleWorld(1), RangeError);
  assert.throws(() => exampleWorld(27), RangeError);
});

test('the engine plays three colonies: a frame has a score, a live count and a rule-counter slot for each', () => {
  const eng = createEngine(), map = exampleWorld(3);
  const ready = eng.handle({ type: 'init', seed: 5, mapText: map, rules: 'colonies', brains: [STARTER, STARTER, STARTER] }).msg as Of<'ready'>;
  assert.equal(ready.type, 'ready');
  assert.equal(colonyCount(ready.hill), 3);
  const f = eng.handle({ type: 'run', n: 300 }).msg as Of<'frame'>;
  assert.equal(f.score.length, 3);
  assert.equal(f.alive.length, 3);
  assert.equal(f.fires.length, 3);
  assert.equal(f.marks.length, 3 * ready.W * ready.H);
  const cols = new Set<number>();
  for (let i = 0; i < f.ants.length; i += ANT_STRIDE) cols.add(f.ants[i + 2]);
  assert.deepEqual([...cols].sort(), [0, 1, 2]);
  const bad = eng.handle({ type: 'init', seed: 5, mapText: map, rules: 'classic', brains: [STARTER, STARTER, STARTER] }).msg;
  assert.equal(bad.type, 'error', 'classic cannot play three colonies');
});

test('share links carry one brain per colony (2 to 26) and nothing else', async () => {
  const s = { seed: 7, brains: ['a', 'b', 'ünï c'], map: exampleWorld(3), rules: 'colonies' as const };
  assert.deepEqual(await decodeShare(await encodeShare(s)), { ...s, gen: undefined });
  const many = Array.from({ length: 26 }, (_, i) => `brain ${i}`);
  assert.deepEqual((await decodeShare(await encodeShare({ seed: 1, brains: many })))?.brains, many);
  assert.equal(await decodeShare(await encodeShare({ seed: 1, brains: [...many, 'extra'] })), null);
  assert.equal(await decodeShare(await encodeShare({ seed: 1, brains: ['only one'] })), null);
});

test('the cell inspector names colonies beyond B', () => {
  const N = 4, marks = new Uint8Array(3 * N);
  marks[2 * N + 1] = 0b101;
  const ants = Int32Array.from([9, 1, 2, 0, 1, 4]);
  assert.equal(describeCell({ food: new Uint16Array(N), marks, ants }, 2, 2, 1), 'cell 1,0 | scent C: 0,2 | ant #9 (C) state 4, facing E, carrying 1');
});

test('the viewer: colony colours come from the palette, and each colony\'s scents sit on their own line (two keep the old +/-0.22)', () => {
  const W = 3, H = 2, N = W * H, rock = new Uint8Array(N), hill = new Int8Array(N).fill(-1);
  const L = layout(W, H, 10);
  const draw = (n: number) => {
    const rects: [string, number][] = [], discs: string[] = [];
    let fill = '';
    const ctx: Ctx = { get fillStyle() { return fill; }, set fillStyle(v) { fill = String(v); }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
      fillRect(_x, y) { rects.push([fill, y]); }, arc() { discs.push(fill); } };
    const marks = new Uint8Array(n * N);
    for (let c = 0; c < n; c++) marks[c * N + 1] = 1; // the same cell, every colony's scent 0
    const ants = Int32Array.from(Array.from({ length: n }, (_, c) => [c, 3 + c % 3, c, 0, 0, 0]).flat());
    createViewer(ctx, { W, H, rock, hill }, L, paletteFor(n, false)).draw({ food: new Uint16Array(N), marks, ants }, { marks: true });
    return { rects: rects.filter(([f]) => f !== LIGHT.bg), discs };
  };
  const pal = paletteFor(5, false), five = draw(5), s = 10 * 0.16;
  assert.deepEqual(five.discs.filter((c) => c !== LIGHT.carry), pal.ant, 'each ant in its colony\'s colour');
  const ys = five.rects.filter(([f]) => pal.mark.includes(f)).map(([, y]) => y);
  assert.equal(new Set(ys).size, 5, 'five scent lines');
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'in colony order, top to bottom');
  const two = draw(2).rects.filter(([f]) => LIGHT.mark.includes(f)).map(([, y]) => y), cy = (0.75 * 0 + 0.5) * L.h;
  assert.ok(Math.abs(two[0] - (cy - 0.22 * L.h - s / 2)) < 1e-9 && Math.abs(two[1] - (cy + 0.22 * L.h - s / 2)) < 1e-9, `two colonies as before: ${two}`);
});

test('keepBrains: live editors first, then the stash beyond them, so a smaller map never costs a brain', () => {
  assert.deepEqual(keepBrains(['x', 'y'], ['c', 'd', 'e']), ['c', 'd', 'e'], 'the live editors win');
  assert.deepEqual(keepBrains(['x', 'y', 'z'], ['c']), ['c', 'y', 'z'], 'colonies D and E are not on the map now: their brains stay');
  assert.deepEqual(keepBrains(['x', 'y'], []), ['x', 'y'], 'a two-colony map keeps all of C..');
  assert.deepEqual(keepBrains([], ['c']), ['c']);
});
