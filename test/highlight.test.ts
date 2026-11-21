import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { COND, FLAT_OPS } from '../src/core/isa.ts';
import { ACTION_WORDS, WHAT_WORDS, WHERE_WORDS } from '../src/lang/parse.ts';
import { KEYWORDS } from '../src/lang/script.ts';
import { DEFAULTS, TEMPLATES, personality } from '../src/lang/templates.ts';
import { detectLang, segments, tokenize } from '../src/lang/highlight.ts';
import type { Kind, Lang } from '../src/lang/highlight.ts';
import { EXAMPLES } from '../web/default-ant.ts';

/** `[kind:text]` for a coloured run, the text itself for a plain one: a whole line is easy to compare. */
const show = (text: string, lang?: Lang): string => segments(text, tokenize(text, lang)).map((s) => (s.kind ? `[${s.kind}:${s.text}]` : s.text)).join('');
const kinds = (text: string, lang?: Lang): Kind[] => tokenize(text, lang).map((t) => t.kind);

test('the language is told from the text: a script starts with define, rules with a rule word, anything else is assembly', () => {
  assert.equal(detectLang('// c\ndefine main { move ; }'), 'script');
  assert.equal(detectLang('# c\nmood a\n  always -> wait'), 'rules');
  assert.equal(detectLang('kit trail\n'), 'rules');
  assert.equal(detectLang('search: sense ahead food else search'), 'asm');
  assert.equal(detectLang('Sense Ahead 1 3 Food ; 0'), 'asm');
  assert.equal(detectLang(''), 'asm');
});

test('rules: structure, senses, actions, arguments, mood names and comments', () => {
  assert.equal(show('mood search'), '[keyword:mood] [label:search]');
  assert.equal(show('kit trail'), '[keyword:kit] [arg:trail]');
  assert.equal(show('mix worker 9, scout 1', 'rules'), '[keyword:mix] [ref:worker] [number:9][punct:,] [ref:scout] [number:1]'); // (a text cannot start with mix: looksLikeRules)
  assert.equal(show('  when food here and not home ahead -> pickup, turn around, switch return', 'rules'),
    '  [keyword:when] [sense:food] [arg:here] [keyword:and] [keyword:not] [sense:home] [arg:ahead] [punct:->] [action:pickup][punct:,] [action:turn] [arg:around][punct:,] [action:switch] [ref:return]');
  assert.equal(show('  when 1 in 16 -> wander', 'rules'), '  [keyword:when] [number:1] [keyword:in] [number:16] [punct:->] [action:wander]');
  assert.equal(show('  always -> return home', 'rules'), '  [keyword:always] [punct:->] [action:return] [arg:home]');
  assert.equal(show('  otherwise explore', 'rules'), '  [keyword:otherwise] [action:explore]');
  assert.equal(show('  when foe left ahead -> turn left, step # fight ; or flee', 'rules'),
    '  [keyword:when] [sense:foe] [arg:left] [arg:ahead] [punct:->] [action:turn] [arg:left][punct:,] [action:step] [comment:# fight ; or flee]');
  assert.equal(show('  when carrying -> move ; walk', 'rules'), '  [keyword:when] [sense:carrying] [punct:->] [action:move] [comment:; walk]', 'both # and ; start a comment');
  assert.equal(show('  WHEN Food HERE -> Pickup', 'rules'), '  [keyword:WHEN] [sense:Food] [arg:HERE] [punct:->] [action:Pickup]', 'case does not matter');
  assert.equal(show('  when blorp here -> mumble', 'rules'), '  [keyword:when] blorp [arg:here] [punct:->] mumble', 'unknown words stay plain');
});

test('assembly: labels, mnemonics, else targets, senses; only ; starts a comment', () => {
  assert.equal(show('search: sense ahead food else wander ; look for food'),
    '[label:search][punct::] [keyword:sense] [arg:ahead] [sense:food] [keyword:else] [ref:wander] [comment:; look for food]');
  assert.equal(show('  sense here marker 3 else 7', 'asm'), '  [keyword:sense] [arg:here] [sense:marker] [number:3] [keyword:else] [number:7]');
  assert.equal(show('  turn left\n  mark 0\n  goto search', 'asm'), '  [action:turn] [arg:left]\n  [action:mark] [number:0]\n  [keyword:goto] [ref:search]');
  assert.equal(show('  flipzero 4 else head', 'asm'), '  [keyword:flipzero] [number:4] [keyword:else] [ref:head]');
  assert.equal(show('  move else x # not a comment', 'asm'), '  [action:move] [keyword:else] [ref:x] # not a comment');
});

test('official .ant lines highlight like assembly', () => {
  assert.equal(show('Sense Ahead 1 3 Food ; 0: search: food ahead?'),
    '[keyword:Sense] [arg:Ahead] [number:1] [number:3] [sense:Food] [comment:; 0: search: food ahead?]');
  assert.equal(show('Sense Here 4 5 Marker 2', 'asm'), '[keyword:Sense] [arg:Here] [number:4] [number:5] [sense:Marker] [number:2]');
  assert.equal(show('Flip 3 1 2\nPickUp 5 6\nTurn Right 9', 'asm'), '[keyword:Flip] [number:3] [number:1] [number:2]\n[action:PickUp] [number:5] [number:6]\n[action:Turn] [arg:Right] [number:9]');
});

test('script: macros, labels, jumps, blocks, three kinds of comment', () => {
  assert.equal(show('define wander { w: choose { case: turn left ; case: move else goto w ; } }'),
    '[keyword:define] [label:wander] [punct:{] [label:w][punct::] [keyword:choose] [punct:{] [keyword:case][punct::] [action:turn] [arg:left] [punct:;] ' +
    '[keyword:case][punct::] [action:move] [keyword:else] [keyword:goto] [ref:w] [punct:;] [punct:}] [punct:}]');
  assert.equal(show('define main { loop { sense ahead food then { move ; } else wander } }', 'script'),
    '[keyword:define] [label:main] [punct:{] [keyword:loop] [punct:{] [keyword:sense] [arg:ahead] [sense:food] [keyword:then] [punct:{] [action:move] [punct:;] [punct:}] [keyword:else] [ref:wander] [punct:}] [punct:}]');
  assert.equal(show('define twice b = { b b }', 'script'), '[keyword:define] [label:twice] [ref:b] [punct:=] [punct:{] [ref:b] [ref:b] [punct:}]');
  assert.equal(show('flip 3 then mark 2 ; repeat 4 move ;', 'script'), '[keyword:flip] [number:3] [keyword:then] [action:mark] [number:2] [punct:;] [keyword:repeat] [number:4] [action:move] [punct:;]');
  assert.equal(show('move ; // one\n# two\n/* three\nlines */ drop ;', 'script'), '[action:move] [punct:;] [comment:// one]\n[comment:# two]\n[comment:/* three\nlines */] [action:drop] [punct:;]');
  assert.equal(show('move ; /* never closed\nmove ;', 'script'), '[action:move] [punct:;] [comment:/* never closed\nmove ;]');
});

test('every word of every language is coloured: a new word in a language needs a row in src/lang/highlight.ts', () => {
  const missing: string[] = [];
  const need = (lang: Lang, words: Iterable<string>): void => {
    for (const w of words) {
      const t = tokenize(w, lang);
      if (t.length !== 1 || t[0].start !== 0 || t[0].end !== w.length || t[0].kind === 'ref' || t[0].kind === 'label') missing.push(`${lang}: ${w}`);
    }
  };
  need('rules', [...WHERE_WORDS, ...WHAT_WORDS, ...ACTION_WORDS, 'left', 'right', 'around', 'random', 'trail', 'foodtrail', 'kit', 'mix', 'mood', 'when', 'always', 'otherwise', 'not', 'and', 'in']);
  need('script', KEYWORDS);
  need('asm', [...FLAT_OPS.map((f) => f.name), ...Object.keys(COND), 'else', 'flip', 'here', 'ahead', 'leftahead', 'rightahead', 'left', 'right']);
  assert.deepEqual(missing, []);
});

const reassembles = (text: string, lang: Lang | undefined, what: string): void => {
  const tokens = tokenize(text, lang);
  let at = 0;
  for (const t of tokens) {
    assert.ok(t.start >= at && t.end > t.start && t.end <= text.length, `${what}: token ${JSON.stringify(t)} after ${at}`);
    at = t.end;
  }
  assert.equal(segments(text, tokens).map((s) => s.text).join(''), text, what);
};

test('the coloured runs put together are always the text itself: every shipped brain, every template, every example', () => {
  const dir = new URL('../ants/', import.meta.url);
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => /\.(rules|asm|script|ant)$/.test(x))) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    reassembles(text, undefined, f);
    assert.ok(tokenize(text).length > 10, `${f} has colours`);
    n++;
  }
  for (const t of TEMPLATES) for (let c = 0; c < 5; c++) { reassembles(personality({ ...DEFAULTS[t], curiosity: c }), undefined, `${t} ${c}`); n++; }
  for (const e of EXAMPLES) { reassembles(e.text, undefined, e.name); n++; }
  assert.ok(n >= 30, `${n} texts`);
  // a shipped brain is read as the language it is written in
  assert.equal(detectLang(readFileSync(new URL('trail.rules', dir), 'utf8')), 'rules');
  assert.equal(detectLang(readFileSync(new URL('starter.script', dir), 'utf8')), 'script');
  assert.equal(detectLang(readFileSync(new URL('trail.asm', dir), 'utf8')), 'asm');
});

test('nothing in any text can make it throw or lose a character (4,000 random texts, 3 languages)', () => {
  let seed = 12345;
  const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  const bits = ['mood', 'when', '->', 'food', 'here', ' ', ' ', '\n', '\r\n', '#', ';', '//', '/*', '*/', ':', '{', '}', ',', '=', '1', '42', 'else', 'goto', 'define', 'x_1', 'é', '\u{1F41C}', '"', '\t', 'Sense', '-'];
  for (let i = 0; i < 4000; i++) {
    let text = '';
    for (let k = rnd(40); k > 0; k--) text += bits[rnd(bits.length)];
    reassembles(text, (['rules', 'script', 'asm'] as const)[i % 3], JSON.stringify(text));
  }
});
