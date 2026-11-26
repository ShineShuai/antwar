// Brain diff and version history (web/versions.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TEXT, MAX_VERSIONS, VERSIONS_KEY, diffStats, hunks, lineDiff, linesOf, readVersions, removeVersion, snapshot } from '../web/versions.ts';
import type { DiffOp } from '../web/versions.ts';

const mem = (init: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const rebuild = (ops: DiffOp[], keep: 'del' | 'add'): string[] => ops.filter((o) => o.type === 'same' || o.type === keep).map((o) => o.text);

test('linesOf: a trailing newline is not a line; Windows line ends', () => {
  assert.deepEqual(linesOf('a\nb\n'), ['a', 'b']); assert.deepEqual(linesOf('a\r\nb'), ['a', 'b']); assert.deepEqual(linesOf(''), []); assert.deepEqual(linesOf('\n'), ['']);
});

test('lineDiff: identical, insert, delete, replace, move, empty', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nb\nc').map((o) => o.type), ['same', 'same', 'same']);
  assert.deepEqual(lineDiff('a\nc', 'a\nb\nc'), [{ type: 'same', text: 'a' }, { type: 'add', text: 'b' }, { type: 'same', text: 'c' }]);
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nc'), [{ type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'same', text: 'c' }]);
  assert.deepEqual(diffStats(lineDiff('a\nb\nc', 'a\nX\nc')), { added: 1, removed: 1 });
  assert.deepEqual(diffStats(lineDiff('', 'x\ny')), { added: 2, removed: 0 }); assert.deepEqual(diffStats(lineDiff('x\ny', '')), { added: 0, removed: 2 });
  assert.deepEqual(lineDiff('', ''), []);
  const moved = diffStats(lineDiff('a\nb\nc\nd', 'a\nc\nd\nb'));
  assert.deepEqual(moved, { added: 1, removed: 1 }, 'a moved line is one deletion and one addition');
});

test('lineDiff: the ops always give back both texts, and the diff is minimal (random texts)', () => {
  let s = 99; const rnd = (n: number): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) % n;
  const words = ['sense', 'move', 'turn', 'mark', 'pickup', 'drop', 'flip', 'goto'];
  const text = (n: number): string => Array.from({ length: n }, () => words[rnd(words.length)] + ' ' + rnd(4)).join('\n');
  for (let k = 0; k < 300; k++) {
    const a = text(rnd(14)), b = rnd(3) === 0 ? text(rnd(14)) : a.split('\n').filter(() => rnd(5) !== 0).concat(rnd(2) ? [words[rnd(8)]] : []).join('\n');
    const ops = lineDiff(a, b);
    assert.deepEqual(rebuild(ops, 'del'), linesOf(a)); assert.deepEqual(rebuild(ops, 'add'), linesOf(b));
    const same = ops.filter((o) => o.type === 'same').length, x = linesOf(a), y = linesOf(b); // minimal: `same` is a longest common subsequence
    const lcs = (() => { const t = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0)); for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) t[i][j] = x[i - 1] === y[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]); return t[x.length][y.length]; })();
    assert.equal(same, lcs, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
});

test('lineDiff: very long texts do not take forever (the middle is shown replaced as a whole)', () => {
  const a = Array.from({ length: 4000 }, (_, i) => `a${i}`).join('\n'), b = Array.from({ length: 4000 }, (_, i) => `b${i}`).join('\n');
  const t = Date.now(), ops = lineDiff(a, b);
  assert.ok(Date.now() - t < 2000); assert.deepEqual(diffStats(ops), { added: 4000, removed: 4000 });
  assert.deepEqual(rebuild(ops, 'add'), linesOf(b));
});

test('hunks: changed lines with context, and how many lines lie between', () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`), b = [...a]; b[3] = 'X'; b[15] = 'Y';
  const h = hunks(lineDiff(a.join('\n'), b.join('\n')), 2);
  assert.equal(h.length, 2); assert.equal(h[0].skipped, 1); assert.equal(h[1].skipped, 7, 'l6 to l12');
  assert.deepEqual(h[0].ops.map((o) => o.text), ['l1', 'l2', 'l3', 'X', 'l4', 'l5']);
  assert.deepEqual(hunks(lineDiff('a\nb', 'a\nb'), 2), []);
  assert.equal(hunks(lineDiff('a\nb\nc\nd', 'a\nb\nc\nX'), 1).length, 1);
});

test('versions: snapshot, no duplicate of the newest, labels, delete, per slot', () => {
  const s = mem();
  assert.deepEqual(readVersions(s, 'A'), []);
  assert.equal(snapshot(s, 'A', 'one', 'first', 10), true); assert.equal(snapshot(s, 'A', 'one', 'again', 20), false, 'the same as the newest');
  assert.equal(snapshot(s, 'A', 'two', '', 30), true); assert.equal(snapshot(s, 'A', 'one', '', 40), true, 'an older text again is a new version');
  assert.deepEqual(readVersions(s, 'A').map((v) => [v.t, v.text, v.label]), [[10, 'one', 'first'], [30, 'two', ''], [40, 'one', '']]);
  assert.equal(snapshot(s, 'B', 'b-text', 'x'.repeat(100), 5), true); assert.equal(readVersions(s, 'B')[0].label.length, 60);
  assert.deepEqual(removeVersion(s, 'A', 30).map((v) => v.t), [10, 40]); assert.deepEqual(readVersions(s, 'B').length, 1);
  assert.equal(snapshot(s, 'A', '   \n', '', 50), false, 'blank text is not a version');
  assert.equal(snapshot(s, 'A', 'x'.repeat(MAX_TEXT + 1), '', 60), false);
  assert.throws(() => snapshot(s, 'a', 'x'), RangeError); assert.throws(() => snapshot(s, 'AA', 'x'), RangeError);
});

test('versions: at most 30 per editor, and 2 MiB in all (the oldest go)', () => {
  const s = mem();
  for (let k = 0; k < 40; k++) snapshot(s, 'A', `text ${k}`, '', k);
  const list = readVersions(s, 'A'); assert.equal(list.length, MAX_VERSIONS); assert.equal(list[0].text, 'text 10'); assert.equal(list.at(-1)?.text, 'text 39');
  const big = mem();
  for (let k = 0; k < 20; k++) snapshot(big, 'A', `${k} ` + 'x'.repeat(MAX_TEXT - 10), '', k);
  const total = readVersions(big, 'A').reduce((a, v) => a + v.text.length, 0);
  assert.ok(total <= 2 << 20, `${total}`); assert.equal(readVersions(big, 'A').at(-1)?.t, 19, 'the newest is kept');
});

test('versions: damaged data is skipped', () => {
  for (const bad of ['{oops', 'null', '[]', '{"A":5}', '{"a":[{"t":1,"text":"x","label":""}]}', '{"A":[{"t":"1","text":"x","label":""},{"t":2,"text":"ok","label":"l"},{"text":"no t"}]}'])
    assert.ok(readVersions(mem({ [VERSIONS_KEY]: bad }), 'A').every((v) => v.text === 'ok'), bad);
  assert.equal(readVersions(mem({ [VERSIONS_KEY]: '{"A":[{"t":2,"text":"ok","label":"l"}]}' }), 'A').length, 1);
});
