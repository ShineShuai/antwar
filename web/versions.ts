// Brain history and diff: a line diff of two texts, and the saved versions of each editor (localStorage). Pure: tests use a fake storage.

// ---------- line diff
export type DiffOp = { type: 'same' | 'del' | 'add'; text: string };

/** Splits into lines, keeping an empty last line out (a text that ends with a newline has no extra line). */
export const linesOf = (t: string): string[] => { const l = t.split(/\r?\n/); if (l.length && l[l.length - 1] === '') l.pop(); return l; };

const MAX_CELLS = 4_000_000; // the table of the longest common subsequence: beyond this the middle is shown as replaced as a whole

/** The line diff from `a` to `b`: `same` and `del` lines in order are `a`, `same` and `add` lines in order are `b`. */
export function lineDiff(a: string, b: string): DiffOp[] {
  const x = linesOf(a), y = linesOf(b);
  let lo = 0;
  while (lo < x.length && lo < y.length && x[lo] === y[lo]) lo++;
  let hx = x.length, hy = y.length;
  while (hx > lo && hy > lo && x[hx - 1] === y[hy - 1]) { hx--; hy--; }
  const out: DiffOp[] = x.slice(0, lo).map((text) => ({ type: 'same', text }));
  const mx = x.slice(lo, hx), my = y.slice(lo, hy), n = mx.length, m = my.length;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
    for (const text of mx) out.push({ type: 'del', text });
    for (const text of my) out.push({ type: 'add', text });
  } else {
    const w = m + 1, len = new Uint32Array((n + 1) * w); // len[i][j]: the longest common subsequence of the last n - i lines of mx and m - j of my
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i * w + j] = mx[i] === my[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (mx[i] === my[j]) { out.push({ type: 'same', text: mx[i] }); i++; j++; }
      else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) out.push({ type: 'del', text: mx[i++] });
      else out.push({ type: 'add', text: my[j++] });
    }
    while (i < n) out.push({ type: 'del', text: mx[i++] });
    while (j < m) out.push({ type: 'add', text: my[j++] });
  }
  for (const text of x.slice(hx)) out.push({ type: 'same', text });
  return out;
}

export const diffStats = (ops: readonly DiffOp[]): { added: number; removed: number } => ({ added: ops.filter((o) => o.type === 'add').length, removed: ops.filter((o) => o.type === 'del').length });

/** The changed lines with `context` unchanged lines around them; a gap between hunks is a `skipped` count. */
export type Hunk = { skipped: number; ops: DiffOp[] };
export function hunks(ops: readonly DiffOp[], context = 2): Hunk[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, i) => { if (o.type !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true; });
  const out: Hunk[] = [];
  let cur: Hunk | undefined, skipped = 0;
  ops.forEach((o, i) => {
    if (!keep[i]) { skipped++; cur = undefined; return; }
    if (!cur) { cur = { skipped, ops: [] }; out.push(cur); skipped = 0; }
    cur.ops.push(o);
  });
  return out;
}

// ---------- versions of each editor
export const VERSIONS_KEY = 'tinyminds.versions.v1';
export const MAX_VERSIONS = 30, MAX_TEXT = 1 << 17, MAX_TOTAL = 2 << 20, MAX_LABEL = 60;
export interface Version { t: number; text: string; label: string }
type Store = Pick<Storage, 'getItem' | 'setItem'>;
type All = Record<string, Version[]>;

function readAll(storage: Pick<Storage, 'getItem'>): All {
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(VERSIONS_KEY) ?? '{}'); } catch { return {}; }
  const out: All = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [slot, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Z]$/.test(slot) || !Array.isArray(list)) continue;
    out[slot] = (list as Partial<Version>[]).filter((v) => typeof v?.t === 'number' && typeof v.text === 'string' && typeof v.label === 'string' && v.text.length <= MAX_TEXT).slice(-MAX_VERSIONS)
      .map((v) => ({ t: v.t as number, text: v.text as string, label: (v.label as string).slice(0, MAX_LABEL) }));
  }
  return out;
}

/** The saved versions of an editor slot ('A', 'B', ...), oldest first. */
export const readVersions = (storage: Pick<Storage, 'getItem'>, slot: string): Version[] => readAll(storage)[slot] ?? [];

/** Saves `text` as the newest version unless it is the same as the newest one (returns false then). The oldest go when there are more than 30 or the whole history is over 2 MiB. */
export function snapshot(storage: Store, slot: string, text: string, label = '', now = Date.now()): boolean {
  if (!/^[A-Z]$/.test(slot)) throw new RangeError('a slot is a letter A to Z');
  if (text.length > MAX_TEXT || text.trim() === '') return false;
  const all = readAll(storage), list = all[slot] ?? [];
  if (list.length && list[list.length - 1].text === text) return false;
  list.push({ t: now, text, label: label.slice(0, MAX_LABEL) });
  while (list.length > MAX_VERSIONS) list.shift();
  all[slot] = list;
  const size = (): number => Object.values(all).reduce((a, l) => a + l.reduce((b, v) => b + v.text.length, 0), 0);
  while (size() > MAX_TOTAL) { // drop the oldest version of the slot with the most text, never the one just saved
    const slots = Object.keys(all).filter((s) => all[s].length > (s === slot ? 1 : 0));
    if (slots.length === 0) break;
    const big = slots.reduce((b, s) => (all[s].reduce((a, v) => a + v.text.length, 0) > all[b].reduce((a, v) => a + v.text.length, 0) ? s : b));
    all[big].shift();
  }
  storage.setItem(VERSIONS_KEY, JSON.stringify(all));
  return true;
}

export function removeVersion(storage: Store, slot: string, t: number): Version[] {
  const all = readAll(storage);
  all[slot] = (all[slot] ?? []).filter((v) => v.t !== t);
  storage.setItem(VERSIONS_KEY, JSON.stringify(all));
  return all[slot];
}
