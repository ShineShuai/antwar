// The map designer's model (web/mapedit.ts): brushes and symmetry, undo, generators, and the checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFairWorld, generateWorld, isShiftSymmetric, isSymmetric, SYMMETRIC_WORLD } from '../src/core/gen.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { History, addBorder, brushCells, checks, copies, docFromText, docOf, generate, hasBorder, mapOf, nearestFood, newDoc, paint, shiftFor, sizeOfShift, textOf } from '../web/mapedit.ts';
import type { Brush, Doc, Symmetry } from '../web/mapedit.ts';

const NONE: Symmetry = { mode: 'none' };
const brush = (o: Partial<Brush>): Brush => ({ tool: 'rock', radius: 0, food: 5, label: 0, sym: NONE, ...o });
const at = (d: Doc, x: number, y: number): number => y * d.W + x;

test('newDoc: sizes are checked; text round trips; a generated world is a document and back', () => {
  assert.throws(() => newDoc(2, 4), RangeError); assert.throws(() => newDoc(10, 5), /even/); assert.throws(() => newDoc(201, 4), RangeError); assert.throws(() => newDoc(1.5, 4), RangeError);
  const d = newDoc(6, 4);
  assert.deepEqual([d.W, d.H, d.rock.length], [6, 4, 24]); assert.ok(d.hill.every((h) => h === -1));
  for (const w of [generateWorld(3), generateFairWorld(3, 2)]) {
    assert.equal(textOf(docOf(w)), formatMap(w)); assert.deepEqual(mapOf(docFromText(formatMap(w))), mapOf(docOf(parseMap(formatMap(w)))));
  }
});

test('docFromText: a world file, and a clear message for anything else', () => {
  const text = formatMap(generateFairWorld(3, 2));
  assert.equal(textOf(docFromText(text)), text); assert.equal(textOf(docFromText(text.replace(/\n/g, '\r\n'))), text, 'Windows line ends');
  for (const bad of ['', 'nonsense', 'a\nb\nc', '5\n6']) assert.throws(() => docFromText(bad), RangeError, JSON.stringify(bad));
  assert.throws(() => docFromText('4\n4\n....\n....'), Error, 'a map with too few rows (the core parser says so)');
  assert.throws(() => docFromText('nonsense\nmore\nlines'), /not a world file/);
});

test('paint: each tool, the rules for hills, and what is reported as changed', () => {
  const d = newDoc(8, 8), p = at(d, 3, 3);
  assert.deepEqual(paint(d, p, brush({ tool: 'rock' })), [p]); assert.equal(d.rock[p], 1);
  assert.deepEqual(paint(d, p, brush({ tool: 'rock' })), [], 'painting what is there changes nothing');
  assert.deepEqual(paint(d, p, brush({ tool: 'food' })), [], 'no food on rock'); assert.equal(d.food[p], 0);
  paint(d, p, brush({ tool: 'erase' })); assert.equal(d.rock[p], 0);
  paint(d, p, brush({ tool: 'food', food: 7 })); assert.equal(d.food[p], 7);
  paint(d, p, brush({ tool: 'food', food: 99 })); assert.equal(d.food[p], 9, 'at most 9: the map text says one digit');
  paint(d, p, brush({ tool: 'hill', label: 2 })); assert.deepEqual([d.hill[p], d.food[p], d.rock[p]], [2, 0, 0], 'a hill clears food and rock');
  assert.deepEqual(paint(d, p, brush({ tool: 'rock' })), [], 'no rock on a hill'); assert.deepEqual(paint(d, p, brush({ tool: 'food' })), [], 'no food on a hill');
  paint(d, p, brush({ tool: 'erase' })); assert.equal(d.hill[p], -1);
});

test('brushCells: radius 0, 1, 2 are 1, 7 and 19 cells away from the edge, and are clipped at it', () => {
  const d = newDoc(20, 20);
  for (const [r, n] of [[0, 1], [1, 7], [2, 19]] as const) assert.equal(new Set(brushCells(d, at(d, 9, 9), r)).size, n);
  assert.ok(brushCells(d, at(d, 0, 0), 2).length < 19);
  assert.ok(brushCells(d, at(d, 0, 0), 2).every((q) => q >= 0 && q < 400));
});

test('the point mirror: every stroke has its twin, hills swap A and B, and the drawn map is isSymmetric', () => {
  const d = newDoc(10, 8), sym: Symmetry = { mode: 'mirror' };
  assert.deepEqual(copies(d, at(d, 2, 1), 0, sym), [{ p: at(d, 2, 1), label: 0 }, { p: at(d, 7, 6), label: 1 }]);
  assert.equal(copies(d, at(d, 2, 1), 5, sym)[1].label, 5, 'other hills keep their label (the mirror is for two colonies)');
  paint(d, at(d, 2, 1), brush({ tool: 'hill', label: 0, sym, radius: 1 }));
  paint(d, at(d, 5, 3), brush({ tool: 'rock', sym })); paint(d, at(d, 6, 4), brush({ tool: 'food', food: 3, sym }));
  paint(d, at(d, 4, 6), brush({ tool: 'food', food: 4, sym, radius: 1 }));
  assert.equal(isSymmetric(mapOf(d)), true);
  const labels = new Set(d.hill.filter((h) => h >= 0)); assert.deepEqual([...labels].sort(), [0, 1]);
  paint(d, at(d, 0, 0), brush({ tool: 'rock' })); assert.equal(isSymmetric(mapOf(d)), false, 'a stroke without the mirror breaks it');
});

test('shift tiles: a stroke is drawn in every tile, hill t belongs to tile t, and the drawn map is isShiftSymmetric (3 and 4 colonies)', () => {
  assert.equal(shiftFor(13), null); assert.equal(shiftFor(26), null);
  for (const n of [3, 4, 6]) {
    const sym = shiftFor(n) as Extract<Symmetry, { mode: 'shift' }>, [W, H] = sizeOfShift(sym), d = newDoc(W, H);
    assert.equal(sym.across * sym.down, n);
    const cs = copies(d, at(d, 5, 5), 0, sym);
    assert.equal(new Set(cs.map((c) => c.p)).size, n, `${n} distinct copies`); assert.deepEqual(cs.map((c) => c.label).sort((a, b) => a - b), Array.from({ length: n }, (_, k) => k));
    paint(d, at(d, 8, 8), brush({ tool: 'hill', sym, radius: 2 }));
    paint(d, at(d, 12, 10), brush({ tool: 'rock', sym, radius: 1 })); paint(d, at(d, 3, 14), brush({ tool: 'food', food: 4, sym }));
    assert.equal(isShiftSymmetric(mapOf(d)), true, `${n} colonies`);
    assert.deepEqual([...new Set(d.hill.filter((h) => h >= 0))].sort((a, b) => a - b), Array.from({ length: n }, (_, k) => k));
  }
});

test('addBorder: rock round the edge, hills stay, food on the edge goes', () => {
  const d = newDoc(6, 4);
  paint(d, at(d, 0, 0), brush({ tool: 'food' })); paint(d, at(d, 3, 0), brush({ tool: 'hill' }));
  assert.equal(hasBorder(d), false);
  const ch = addBorder(d); assert.ok(ch.length > 0);
  assert.equal(d.food[at(d, 0, 0)], 0); assert.equal(d.hill[at(d, 3, 0)], 0); assert.equal(d.rock[at(d, 3, 0)], 0);
  assert.equal(hasBorder(d), true); assert.deepEqual(addBorder(d), [], 'twice changes nothing');
  assert.equal(hasBorder(docOf(generateWorld(1))), true, 'the contest generator makes a border');
});

test('History: undo and redo, a new change drops the redo, the limit', () => {
  let d = newDoc(6, 4); const h = new History(3);
  assert.equal(h.canUndo, false);
  for (let k = 0; k < 5; k++) { h.push(d); paint(d, k, brush({ tool: 'rock' })); }
  assert.equal(d.rock.reduce((a, r) => a + r, 0), 5);
  let steps = 0; for (let u = h.undo(d); u; u = h.undo(d)) { d = u; steps++; }
  assert.equal(steps, 3, 'the limit keeps the last 3 snapshots'); assert.equal(d.rock.reduce((a, r) => a + r, 0), 2);
  assert.equal(h.canRedo, true);
  const redo = h.redo(d) as Doc; assert.equal(redo.rock.reduce((a, r) => a + r, 0), 3); d = redo;
  h.push(d); assert.equal(h.canRedo, false, 'a new change drops the redo');
  const big = newDoc(8, 6), small = newDoc(6, 4); h.push(small); assert.equal((h.undo(big) as Doc).W, 6, 'snapshots keep their own size');
});

test('generate: the three generators, with parameters', () => {
  assert.equal(textOf(generate({ kind: 'contest', seed: 4 })), formatMap(generateWorld(4)));
  assert.equal(textOf(generate({ kind: 'mirror', seed: 4 })), formatMap(generateWorld(4, SYMMETRIC_WORLD)));
  assert.equal(textOf(generate({ kind: 'fair', seed: 4, colonies: 3 })), formatMap(generateFairWorld(3, 4)));
  const small = generate({ kind: 'contest', seed: 4, cfg: { W: 40, H: 40, hillRadius: 3, rocks: 4, blobs: 4 } });
  assert.deepEqual([small.W, small.H], [40, 40]);
  assert.throws(() => generate({ kind: 'fair', seed: 1, colonies: 13 }), /no fair world/);
});

test('checks: a generated fair world passes everything; a lopsided drawing is told what is wrong', () => {
  const by = (d: Doc) => Object.fromEntries(checks(d).map((c) => [c.id, c]));
  const fair = by(generate({ kind: 'fair', seed: 3, colonies: 4 }));
  for (const id of ['colonies', 'hills', 'food', 'shift']) assert.equal(fair[id].level, 'ok', `${id}: ${fair[id].text}`);
  assert.match(fair.colonies.text, /^4 colonies/); assert.equal(fair.reach.level === 'bad', false);
  const mirror = by(generate({ kind: 'mirror', seed: 3 }));
  assert.equal(mirror.mirror.level, 'ok'); assert.equal(mirror.colonies.level, 'ok'); assert.equal(mirror.border.text.includes('yes'), true);
  assert.equal(by(newDoc(6, 4)).colonies.level, 'bad');
  const d = newDoc(10, 10);
  paint(d, at(d, 1, 1), brush({ tool: 'hill', label: 0, radius: 1 })); paint(d, at(d, 7, 7), brush({ tool: 'hill', label: 2 }));
  assert.match(checks(d).find((c) => c.id === 'colonies')?.text ?? '', /B is missing/);
  paint(d, at(d, 7, 7), brush({ tool: 'erase' })); paint(d, at(d, 7, 7), brush({ tool: 'hill', label: 1 }));
  const c = by(d);
  assert.equal(c.hills.level, 'warn'); assert.match(c.hills.text, /A 7, B 1/); assert.equal(c.food.level, 'bad', 'no food');
  paint(d, at(d, 3, 3), brush({ tool: 'food', food: 9 })); // ((2, 2) is part of the hill A: radius 1)
  assert.equal(by(d).food.level, 'warn', 'food nearest to A only'); assert.match(by(d).food.text, /A 9, B 0/);
  assert.equal(by(d).shift.level, 'warn');
  // rock walls: food that cannot be reached
  const w = newDoc(10, 10);
  paint(w, at(w, 1, 1), brush({ tool: 'hill', label: 0 })); paint(w, at(w, 8, 8), brush({ tool: 'hill', label: 1 })); paint(w, at(w, 5, 5), brush({ tool: 'food', food: 2 }));
  assert.equal(by(w).reach.level, 'ok');
  for (const q of [[4, 5], [6, 5], [4, 4], [5, 4], [4, 6], [5, 6], [3, 5], [7, 5], [5, 3], [5, 7], [6, 4], [6, 6], [3, 4], [3, 6], [7, 4], [7, 6]]) paint(w, at(w, q[0], q[1]), brush({ tool: 'rock' }));
  assert.equal(by(w).reach.level, 'bad', JSON.stringify(by(w).reach));
});

test('nearestFood: the food nearest to each hill, shared at a tie, not through rock', () => {
  const d = newDoc(12, 4);
  paint(d, at(d, 2, 1), brush({ tool: 'hill', label: 0 })); paint(d, at(d, 9, 1), brush({ tool: 'hill', label: 1 }));
  paint(d, at(d, 3, 1), brush({ tool: 'food', food: 4 })); paint(d, at(d, 8, 1), brush({ tool: 'food', food: 6 }));
  assert.deepEqual(nearestFood(d, 2), [4, 6]);
  const sym = newDoc(12, 4);
  paint(sym, at(sym, 2, 1), brush({ tool: 'hill', label: 0, sym: { mode: 'mirror' } })); paint(sym, at(sym, 5, 1), brush({ tool: 'food', food: 4, sym: { mode: 'mirror' } }));
  const [a, b] = nearestFood(sym, 2); assert.equal(a, b);
});

test('scripts/hill-size.ts: the control is about even and a much smaller hill loses (small run)', async () => {
  const { spawnSync } = await import('node:child_process');
  const root = (f: string): string => new URL(`../${f}`, import.meta.url).pathname;
  const r = spawnSync(process.execPath, [root('scripts/hill-size.ts'), root('ants/trail.rules'), '5,2', '4', '2500'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 2); assert.match(lines[0], /^hill B radius 5 \(91 ants vs 91\)/); assert.match(lines[1], /^hill B radius 2 \(19 ants vs 91\): A \(big hill\) wins \d+, B \d+/);
  assert.equal(spawnSync(process.execPath, [root('scripts/hill-size.ts')], { encoding: 'utf8' }).status, 2);
});
