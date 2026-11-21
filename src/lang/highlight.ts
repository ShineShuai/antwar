// Syntax highlighting for the brain editors: a tokenizer for the three kinds of text a brain can be written in. Rules (levels 0-2),
// scripts (level 3) and assembly, where the flat .asm and the official .ant share one tokenizer. Text in, tokens out: it never
// throws, never changes the text, and an unknown word is simply left plain (the compilers say what is wrong, not this).
// Keep the word tables in step with the languages: test/highlight.test.ts fails when a word of a language has no colour.
import { FLAT_OPS } from '../core/isa.ts';
import { looksLikeRules } from './index.ts';
import { KEYWORDS as SCRIPT_KEYWORDS, looksLikeScript } from './script.ts';

/** keyword: structure and flow; action: changes the world; sense: what is looked at; arg: a direction or object word;
 * label: a name being defined; ref: a name being used. */
export type Kind = 'comment' | 'keyword' | 'action' | 'sense' | 'arg' | 'number' | 'label' | 'ref' | 'punct';
export type Lang = 'rules' | 'script' | 'asm';
export interface Token { start: number; end: number; kind: Kind }
export interface Segment { text: string; kind?: Kind }

export const detectLang = (text: string): Lang => (looksLikeScript(text) ? 'script' : looksLikeRules(text) ? 'rules' : 'asm');

const set = (...words: string[]): ReadonlySet<string> => new Set(words);
const kindOf = (w: string, table: readonly (readonly [ReadonlySet<string>, Kind])[]): Kind | undefined => table.find(([s]) => s.has(w))?.[1];

// ---------------------------------------------------------------- rules
const RULES_WORDS = [
  [set('kit', 'mix', 'mood', 'when', 'always', 'otherwise', 'not', 'and', 'or', 'in', 'one'), 'keyword'],
  [set('move', 'pickup', 'drop', 'turn', 'mark', 'unmark', 'switch', 'step', 'wander', 'explore', 'roam', 'return', 'follow', 'lay', 'wait'), 'action'],
  [set('food', 'rock', 'foe', 'friend', 'home', 'marker', 'carrying'), 'sense'],
  [set('here', 'ahead', 'left', 'right', 'leftahead', 'rightahead', 'around', 'random', 'trail', 'foodtrail'), 'arg'],
] as const;
const WORD = /[A-Za-z_][A-Za-z0-9_]*|\d+|->|[,:{};=]/g;

function lines(text: string, comment: RegExp, each: (code: string, base: number, out: Token[]) => void, out: Token[]): void {
  let base = 0;
  for (const line of text.split('\n')) {
    const cut = line.search(comment);
    each(cut < 0 ? line : line.slice(0, cut), base, out);
    if (cut >= 0) out.push({ start: base + cut, end: base + line.length, kind: 'comment' });
    base += line.length + 1;
  }
}

function rulesLine(code: string, base: number, out: Token[]): void {
  let head = '', prev = '', i = 0;
  for (const m of code.matchAll(WORD)) {
    const w = m[0].toLowerCase(), at = base + (m.index ?? 0);
    let kind: Kind | undefined;
    if (/^\d/.test(w)) kind = 'number';
    else if (w === '->' || w === ',' || w === ':' || w === '=' || w === '{' || w === '}' || w === ';') kind = 'punct';
    else if (i > 0 && head === 'mood') kind = 'label';
    else if (head === 'mix' && i > 0) kind = 'ref';
    else if (prev === 'switch') kind = 'ref';
    else if (prev === 'return' && w === 'home') kind = 'arg';
    else kind = kindOf(w, RULES_WORDS);
    if (i === 0) head = w;
    if (kind) out.push({ start: at, end: at + m[0].length, kind });
    prev = w; i++;
  }
}

// ---------------------------------------------------------------- flat assembly and official .ant
const ASM_OPS = new Set([...FLAT_OPS.map((f) => f.name), 'flip']); // `flip` is the official spelling of flipzero
const FLOW = set('else', 'goto', 'flip', 'flipzero', 'sense', 'senseany', 'senseall', 'direction', 'payload');
const ASM_WORDS = [
  [FLOW, 'keyword'],
  [set('mark', 'unmark', 'move', 'pickup', 'drop', 'turn'), 'action'],
  [set('friend', 'foe', 'friendwithfood', 'foewithfood', 'food', 'rock', 'marker', 'foemarker', 'home', 'foehome'), 'sense'],
  [set('here', 'ahead', 'leftahead', 'rightahead', 'left', 'right'), 'arg'],
] as const;
const LABEL = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(:)/;

function asmLine(code: string, base: number, out: Token[]): void {
  let from = 0;
  const lab = LABEL.exec(code);
  if (lab) {
    const at = base + lab[1].length;
    out.push({ start: at, end: at + lab[2].length, kind: 'label' }, { start: at + lab[2].length, end: at + lab[2].length + 1, kind: 'punct' });
    from = lab[0].length;
  }
  let prev = '';
  for (const m of code.slice(from).matchAll(WORD)) {
    const w = m[0].toLowerCase(), at = base + from + (m.index ?? 0);
    let kind: Kind | undefined;
    if (/^\d/.test(w)) kind = 'number';
    else if ((prev === 'else' || prev === 'goto') && /^[a-z_]/.test(w)) kind = 'ref';
    else kind = kindOf(w, ASM_WORDS);
    if (kind) out.push({ start: at, end: at + m[0].length, kind });
    prev = w;
  }
}

// ---------------------------------------------------------------- scripts
const SCRIPT_WORDS = [
  [set('define', 'loop', 'exit', 'choose', 'case', 'repeat', 'goto', 'then', 'else', 'sense', 'flip', 'direction', 'payload'), 'keyword'],
  [set('mark', 'unmark', 'pickup', 'drop', 'turn', 'move'), 'action'],
  [set('friend', 'foe', 'with', 'food', 'rock', 'marker', 'home', 'foemarker', 'foehome', 'friendwithfood', 'foewithfood'), 'sense'],
  [set('here', 'ahead', 'left', 'right', 'leftahead', 'rightahead'), 'arg'],
] as const;
const SCRIPT = /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|[A-Za-z_][A-Za-z0-9_]*|\d+|[{};:=,]/g;
const COLON_NEXT = /[ \t]*:/y;

function script(text: string, out: Token[]): void {
  let prev = '';
  for (const m of text.matchAll(SCRIPT)) {
    const t = m[0], at = m.index ?? 0, w = t.toLowerCase();
    if (t.startsWith('//') || t[0] === '#' || t.startsWith('/*')) { out.push({ start: at, end: at + t.length, kind: 'comment' }); continue; }
    let kind: Kind | undefined;
    if (/^\d/.test(t)) kind = 'number';
    else if (/^[{};:=,]$/.test(t)) kind = 'punct';
    else if (!SCRIPT_KEYWORDS.has(w) && prev === 'define') kind = 'label';
    else if (!SCRIPT_KEYWORDS.has(w) && prev === 'goto') kind = 'ref';
    else if (!SCRIPT_KEYWORDS.has(w)) { COLON_NEXT.lastIndex = at + t.length; kind = COLON_NEXT.test(text) ? 'label' : 'ref'; }
    else kind = kindOf(w, SCRIPT_WORDS);
    if (kind) out.push({ start: at, end: at + t.length, kind });
    prev = w;
  }
}

/** The tokens of a text, in order, never overlapping. `lang` defaults to what the text looks like. */
export function tokenize(text: string, lang: Lang = detectLang(text)): Token[] {
  const out: Token[] = [];
  if (lang === 'script') script(text, out);
  else if (lang === 'rules') lines(text, /[#;]/, rulesLine, out);
  else lines(text, /;/, asmLine, out);
  return out;
}

/** The text cut into runs, the coloured ones with their kind; the runs put together are the text itself. */
export function segments(text: string, tokens: readonly Token[] = tokenize(text)): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const t of tokens) {
    if (t.start > at) out.push({ text: text.slice(at, t.start) });
    out.push({ text: text.slice(t.start, t.end), kind: t.kind });
    at = t.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** Words the asm table knows, for the sync test: every mnemonic of the instruction set must be coloured. */
export const ASM_MNEMONICS: ReadonlySet<string> = ASM_OPS;
