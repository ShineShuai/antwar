// The Maps page: draw a world with brushes and symmetry, see what is wrong with it as you draw, generate one, keep a library, and take the map to the
// workshop or the Arena. The model and the checks are web/mapedit.ts; this file draws it and turns pointer events into strokes.
import { CLASSIC_WORLD } from '../src/core/gen.ts';
import { History, MAX_FOOD, addBorder, checks, copyDoc, docFromText, generate, mirrorHalf, mirrorMismatch, newDoc, paint, shiftFor, sizeOfShift, textOf } from './mapedit.ts';
import type { Brush, Doc, Symmetry, Tool } from './mapedit.ts';
import { deleteMap, readLibrary, saveMap } from './maplib.ts';
import { mountMapFairness } from './mapfair.ts';
import { mountNav } from './nav.ts';
import { paletteFor } from './colonies.ts';
import { readProject, writeProjectWorld } from './project.ts';
import { cellAt, center, layout } from './viewer.ts';
import type { Layout } from './viewer.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const DRAFT_KEY = 'tinyminds.maps.draft.v1';
const letter = (c: number): string => String.fromCharCode(65 + c);
mountNav($('nav'), 'maps');

const canvas = $<HTMLCanvasElement>('board'), ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const msg = (t: string, err = false): void => { $('msg').textContent = t; $('msg').className = err ? 'note err' : 'note'; };

// ---- state
let doc: Doc = newDoc(60, 60), sym: Symmetry = { mode: 'none' }, tool: Tool = 'rock', L: Layout = layout(60, 60, 8);
const history = new History();
const showAsym = $<HTMLInputElement>('showasym');
const dark = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

// ---- controls
const TOOLS: [Tool, string][] = [['rock', 'Rock'], ['food', 'Food'], ['hill', 'Hill'], ['erase', 'Erase']];
const toolButtons = new Map<Tool, HTMLButtonElement>();
for (const [t, label] of TOOLS) {
  const b = document.createElement('button'); b.textContent = label; b.onclick = () => { tool = t; syncTools(); }; toolButtons.set(t, b); $('toolrow').append(b);
}
const syncTools = (): void => { for (const [t, b] of toolButtons) b.classList.toggle('on', t === tool); };
for (let f = 1; f <= MAX_FOOD; f++) $<HTMLSelectElement>('foodamt').add(new Option(String(f), String(f)));
$<HTMLSelectElement>('foodamt').value = '5';
for (let c = 0; c < 26; c++) $<HTMLSelectElement>('label').add(new Option(letter(c), String(c)));
for (let n = 2; n <= 25; n++) if (shiftFor(n)) { $<HTMLSelectElement>('symn').add(new Option(String(n), String(n))); $<HTMLSelectElement>('genn').add(new Option(String(n), String(n))); }
$<HTMLSelectElement>('symn').value = '3'; $<HTMLSelectElement>('genn').value = '3';
const P = CLASSIC_WORLD;
const params: [string, number][] = [['gW', P.W], ['gH', P.H], ['gR', P.hillRadius], ['gRocks', P.rocks], ['gRs0', P.rockSize[0]], ['gRs1', P.rockSize[1]], ['gBlobs', P.blobs], ['gPer', P.perCell]];
for (const [id, v] of params) $<HTMLInputElement>(id).value = String(v);
syncTools();

const brush = (): Brush => ({ tool, radius: Number($<HTMLSelectElement>('radius').value), food: Number($<HTMLSelectElement>('foodamt').value), label: Number($<HTMLSelectElement>('label').value), sym });

// ---- drawing
function fit(): void {
  const avail = Math.max(320, $('stage').clientWidth || 760), w = Math.max(3, Math.min(14, Math.floor(avail / (doc.W + 1))));
  L = layout(doc.W, doc.H, w); canvas.width = L.width; canvas.height = L.height;
}
function hexPath(cx: number, cy: number): void {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (60 * k - 30), x = cx + (L.h / 2) * Math.cos(a), y = cy + (L.h / 2) * Math.sin(a); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.closePath();
}
function hex(cx: number, cy: number): void { hexPath(cx, cy); ctx.fill(); }
function drawCell(p: number): void {
  const pal = paletteFor(26, dark()), [cx, cy] = center(L, p % doc.W, (p / doc.W) | 0);
  ctx.fillStyle = doc.rock[p] ? pal.rock : doc.hill[p] >= 0 ? pal.hill[doc.hill[p]] : pal.bg; hex(cx, cy);
  if (doc.food[p]) { ctx.fillStyle = pal.food; const s = L.w * (0.3 + 0.5 * doc.food[p] / MAX_FOOD); ctx.fillRect(cx - s / 2, cy - s / 2, s, s); }
  if (doc.hill[p] >= 0 && L.w >= 9) { ctx.fillStyle = pal.ant[doc.hill[p]]; ctx.font = `${Math.floor(L.w * 0.8)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter(doc.hill[p]), cx, cy); }
}
function drawAll(): void {
  ctx.fillStyle = paletteFor(26, dark()).bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let p = 0; p < doc.W * doc.H; p++) if (doc.rock[p] || doc.hill[p] >= 0 || doc.food[p]) drawCell(p); // (the empty cells are the background)
  if (showAsym.checked) { // the cells that differ from their twin under the point mirror, outlined
    ctx.strokeStyle = '#d946ef'; ctx.lineWidth = Math.max(1, L.w / 5);
    for (const p of mirrorMismatch(doc) ?? []) { const [cx, cy] = center(L, p % doc.W, (p / doc.W) | 0); hexPath(cx, cy); ctx.stroke(); }
  }
}

// ---- checks, draft, buttons
function refresh(): void {
  fair.invalidate();
  if (showAsym.checked) drawAll();
  const list = $('checks'); list.replaceChildren();
  for (const c of checks(doc)) { const d = document.createElement('div'); d.className = c.level; d.textContent = c.text; list.append(d); }
  $<HTMLButtonElement>('undo').disabled = !history.canUndo; $<HTMLButtonElement>('redo').disabled = !history.canRedo;
  try { localStorage.setItem(DRAFT_KEY, textOf(doc)); } catch { /* a full or blocked storage: the drawing is just not kept */ }
}
function show(d: Doc, note = ''): void { doc = d; fit(); drawAll(); refresh(); if (note) msg(note); }
/** Replace the document (undoable). */
function replace(d: Doc, note: string): void { history.push(doc); show(d, note); }
function symNote(): void {
  $('symnote').textContent = sym.mode === 'mirror' ? 'Every stroke is drawn twice, turned half a turn; hill A makes hill B.'
    : sym.mode === 'shift' ? `Every stroke is drawn in all ${sym.across * sym.down} tiles of ${sym.w} x ${sym.h}; each tile has its own hill.` : '';
  $<HTMLSelectElement>('label').disabled = sym.mode === 'shift';
}
function setSymmetry(): void {
  const mode = $<HTMLSelectElement>('symmode').value;
  $('symnbox').hidden = mode !== 'shift';
  if (mode === 'shift') {
    const s = shiftFor(Number($<HTMLSelectElement>('symn').value)) as Extract<Symmetry, { mode: 'shift' }>, [W, H] = sizeOfShift(s);
    sym = s;
    if (doc.W !== W || doc.H !== H) replace(newDoc(W, H), `A new empty map of ${s.across * s.down} tiles (${W} x ${H}).`);
  } else sym = { mode: mode === 'mirror' ? 'mirror' : 'none' };
  symNote();
}
$('symmode').onchange = setSymmetry; $('symn').onchange = setSymmetry;
$('genkind').onchange = () => { $('gennbox').hidden = $<HTMLSelectElement>('genkind').value !== 'fair'; };
showAsym.onchange = () => {
  drawAll();
  if (showAsym.checked) { const off = mirrorMismatch(doc); msg(off === null ? 'An odd height has no point mirror.' : off.length ? `${off.length} cells differ from their twin under the point mirror (outlined).` : 'The map is point-symmetric: nothing to mark.'); }
};
/** Turns one half of the map into the other, so a two-colony map is fair by construction (undoable). */
function mirror(keep: 'first' | 'last'): void {
  if (mirrorMismatch(doc)?.length === 0) { msg('The map is point-symmetric already.'); return; }
  const before = copyDoc(doc);
  try {
    const changed = mirrorHalf(doc, keep);
    history.push(before); drawAll(); refresh(); msg(`Mirrored the ${keep === 'first' ? 'top' : 'bottom'} half: ${changed.length} cells changed.`);
  } catch (e) { msg(e instanceof Error ? e.message : String(e), true); }
}
$('mirfirst').onclick = () => mirror('first'); $('mirlast').onclick = () => mirror('last');
$('undo').onclick = () => { const d = history.undo(doc); if (d) show(d); };
$('redo').onclick = () => { const d = history.redo(doc); if (d) show(d); };
$('border').onclick = () => { history.push(doc); const ch = addBorder(doc); if (ch.length === 0) { msg('The map has a rock border already.'); return; } ch.forEach(drawCell); refresh(); msg('A rock border was added.'); };
$('newdoc').onclick = () => {
  try { replace(newDoc(Number($<HTMLInputElement>('nW').value), Number($<HTMLInputElement>('nH').value)), 'A new empty map.'); } catch (e) { msg(e instanceof Error ? e.message : String(e), true); }
};
$('rand').onclick = () => { $<HTMLInputElement>('seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffffff); };
$('gen').onclick = () => {
  const kind = $<HTMLSelectElement>('genkind').value as 'contest' | 'mirror' | 'fair', seed = Number($<HTMLInputElement>('seed').value);
  if (!Number.isInteger(seed) || seed < 0) { msg('The seed is a whole number from 0.', true); return; }
  const n = (id: string): number => Number($<HTMLInputElement>(id).value);
  try {
    const d = kind === 'fair' ? generate({ kind, seed, colonies: Number($<HTMLSelectElement>('genn').value) })
      : generate({ kind, seed, cfg: { W: n('gW'), H: n('gH'), hillRadius: n('gR'), rocks: n('gRocks'), rockSize: [n('gRs0'), n('gRs1')], blobs: n('gBlobs'), perCell: n('gPer') } });
    $<HTMLSelectElement>('symmode').value = kind === 'fair' ? 'shift' : kind === 'mirror' ? 'mirror' : 'none';
    if (kind === 'fair') $<HTMLSelectElement>('symn').value = $<HTMLSelectElement>('genn').value;
    replace(d, `Generated a ${kind} world from seed ${seed}.`);
    setSymmetry();
  } catch (e) { msg(e instanceof Error ? e.message : String(e), true); }
};
$<HTMLInputElement>('import').onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try { replace(docFromText(await file.text()), `Imported ${file.name}.`); $<HTMLSelectElement>('symmode').value = 'none'; setSymmetry(); } catch (err) { msg(err instanceof Error ? err.message : String(err), true); }
};
$('export').onclick = () => {
  try {
    const url = URL.createObjectURL(new Blob([textOf(doc)], { type: 'text/plain' })), a = document.createElement('a');
    a.href = url; a.download = 'map.world'; a.click(); URL.revokeObjectURL(url); msg('Exported map.world.');
  } catch { msg('Could not export: use Copy text instead.', true); }
};
$('copytext').onclick = async () => { try { await navigator.clipboard.writeText(textOf(doc)); msg('Map text copied.'); } catch { msg('Could not copy the map text.', true); } };
$('fromproject').onclick = () => {
  const w = readProject().world;
  if (w.mapText === '') { msg('The workshop has no map text: it plays the contest world of its seed. Generate one here with the same seed.', true); return; }
  try { replace(docFromText(w.mapText), "The workshop's map."); } catch (e) { msg(e instanceof Error ? e.message : String(e), true); }
};

// ---- library
function drawLibrary(): void {
  const ul = $('lib'); ul.replaceChildren();
  for (const m of readLibrary(localStorage)) {
    const li = document.createElement('li'), load = document.createElement('button'), del = document.createElement('button');
    load.textContent = m.name; load.title = 'load'; del.textContent = '\u00d7'; del.title = 'delete';
    load.onclick = () => { try { replace(docFromText(m.text), `Loaded ${m.name}.`); } catch (e) { msg(e instanceof Error ? e.message : String(e), true); } };
    del.onclick = () => { deleteMap(localStorage, m.name); drawLibrary(); };
    li.append(load, ' ', del); ul.append(li);
  }
}
$('libsave').onclick = () => {
  try { saveMap(localStorage, $<HTMLInputElement>('libname').value, textOf(doc)); drawLibrary(); msg('Saved to the library.'); } catch (e) { msg(e instanceof Error ? e.message : String(e), true); }
};

// ---- hand-off
function useMap(to: string): void {
  const bad = checks(doc).find((c) => c.id === 'colonies' && c.level === 'bad');
  if (bad) { msg(bad.text, true); return; }
  try { writeProjectWorld(localStorage, { kind: 'custom', mapText: textOf(doc) }); location.href = to; } catch (e) { msg(e instanceof Error ? e.message : String(e), true); }
}
$('play').onclick = () => useMap('index.html');
$('arena').onclick = () => useMap('arena.html#fair');

// ---- the board
let stroking = false, last: [number, number] | undefined;
const pixel = (e: MouseEvent): [number, number] => {
  const r = canvas.getBoundingClientRect(), k = r.width > 0 ? canvas.width / r.width : 1;
  return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
};
function stroke(px: number, py: number): void {
  const p = cellAt(L, doc.W, doc.H, px, py);
  if (p < 0) return;
  for (const q of paint(doc, p, brush())) drawCell(q);
}
function strokeTo(x: number, y: number): void {
  if (last) { // fill in the cells between two pointer events
    const n = Math.max(1, Math.ceil(Math.hypot(x - last[0], y - last[1]) / (L.w / 2)));
    for (let k = 1; k <= n; k++) stroke(last[0] + ((x - last[0]) * k) / n, last[1] + ((y - last[1]) * k) / n);
  } else stroke(x, y);
  last = [x, y];
}
canvas.onpointerdown = (e) => {
  if (e.button > 0) return;
  stroking = true; last = undefined; history.push(doc); canvas.setPointerCapture?.(e.pointerId);
  strokeTo(...pixel(e));
};
canvas.onpointermove = (e) => {
  const [x, y] = pixel(e);
  if (stroking) strokeTo(x, y);
  const p = cellAt(L, doc.W, doc.H, x, y);
  $('cursor').textContent = p < 0 ? '\u00a0' : `x ${p % doc.W}, y ${(p / doc.W) | 0}: ${doc.rock[p] ? 'rock' : doc.hill[p] >= 0 ? `hill ${letter(doc.hill[p])}` : doc.food[p] ? `food ${doc.food[p]}` : 'empty'}`;
};
const endStroke = (): void => { if (!stroking) return; stroking = false; last = undefined; refresh(); };
canvas.onpointerup = endStroke; canvas.onpointercancel = endStroke;
addEventListener('pointerup', endStroke);

// ---- fairness (two colonies)
const fair = mountMapFairness($('fair'), () => {
  const hills = new Set<number>(); for (const h of doc.hill) if (h >= 0) hills.add(h);
  return { text: textOf(doc), colonies: hills.size, problem: checks(doc).find((c) => c.id === 'colonies' && c.level === 'bad')?.text };
});

// ---- start: the draft, else the workshop's map, else a mirrored world of the workshop's seed
try {
  const draft = localStorage.getItem(DRAFT_KEY), p = readProject();
  if (draft) show(docFromText(draft));
  else if (p.world.mapText) show(docFromText(p.world.mapText), "The workshop's map.");
  else { show(generate({ kind: 'mirror', seed: p.seed })); $<HTMLSelectElement>('symmode').value = 'mirror'; setSymmetry(); }
} catch { show(generate({ kind: 'mirror', seed: 1 })); }
drawLibrary();
