// Level 3: the structured script (reference.html: "High-level compiler grammar" and "Lowering rules"; docs/SCRIPT.md).
// Source -> AST -> flat assembly (src/core/asm.ts) with a map from every assembly line back to its script line.
// Macros are expanded at the call site, `repeat` is unrolled, `goto` costs nothing: only senses and actions cost a round.
import { AsmError, MAX_AUTHORED, MAX_FLIP, assemble } from '../core/asm.ts';
import { CLASSIC } from '../core/rules.ts';
import type { Program, Rules } from '../core/types.ts';
import { RulesError } from './parse.ts';

export class ScriptError extends RulesError {}
function fail(line: number, msg: string): never { throw new ScriptError(line ? `line ${line}: ${msg}` : msg); }

// ---------------------------------------------------------------- lexer
interface Tok { t: 'id' | 'int' | 'p'; v: string; line: number }

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let line = 1, i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; }
    else if (/\s/.test(c)) i++;
    else if (c === '#' || (c === '/' && src[i + 1] === '/')) while (i < src.length && src[i] !== '\n') i++;
    else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) fail(line, 'this comment is never closed (/* ... */)');
      line += (src.slice(i, end).match(/\n/g) ?? []).length;
      i = end + 2;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\w/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase(), line });
      i = j;
    } else if (/\d/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\d/.test(src[j])) j++;
      if (/[A-Za-z_]/.test(src[j] ?? '')) fail(line, `"${src.slice(i, j + 1)}" is not a number`);
      out.push({ t: 'int', v: src.slice(i, j), line });
      i = j;
    } else if ('{};:='.includes(c)) { out.push({ t: 'p', v: c, line }); i++; }
    else fail(line, `unexpected character "${c}"`);
  }
  return out;
}

// ---------------------------------------------------------------- AST
type Cont = { then?: Node; else?: Node };
type Node = { line: number } & (
  | { k: 'sense'; head: string; cont: Cont }
  | { k: 'mark' | 'unmark'; n: number }
  | { k: 'pickup' | 'move'; cont: Cont }
  | { k: 'drop' }
  | { k: 'turn'; dir: 'left' | 'right' }
  | { k: 'flip'; p: number; cont: Cont }
  | { k: 'direction' | 'payload'; n: number; cont: Cont }
  | { k: 'loop'; body: Node }
  | { k: 'exit' }
  | { k: 'choose'; cases: Node[] }
  | { k: 'repeat'; n: number; body: Node }
  | { k: 'nop' }
  | { k: 'goto'; label: string }
  | { k: 'block'; body: Node[] }
  | { k: 'call'; name: string; args: Node[][] }
  | { k: 'label'; name: string; body: Node }
);
export interface Macro { name: string; line: number; params: string[]; body: Node }

/** Words that cannot be macro, parameter or label names ("goto home" does not parse in the original either). */
export const KEYWORDS: ReadonlySet<string> = new Set([
  'define', 'sense', 'mark', 'unmark', 'pickup', 'drop', 'turn', 'move', 'flip', 'direction', 'payload', 'loop', 'exit', 'choose',
  'case', 'repeat', 'goto', 'then', 'else', 'left', 'right', 'here', 'ahead', 'friend', 'foe', 'with', 'food', 'rock', 'marker',
  'home', 'foemarker', 'foehome', 'friendwithfood', 'foewithfood', 'leftahead', 'rightahead',
]);
const MAX_DEPTH = 8, MAX_REPEAT = 1000, MAX_CHOOSE = 64;

const distance = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const didYouMean = (w: string, options: Iterable<string>): string => {
  const best = [...options].map((o) => [o, distance(w, o)] as const).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= 2 ? ` (did you mean "${best[0]}"?)` : '';
};

// ---------------------------------------------------------------- parser
function parseScript(src: string): Macro[] {
  const toks = lex(src);
  let i = 0;
  const peek = (k = 0): Tok | undefined => toks[i + k];
  const lastLine = (): number => toks[Math.min(i, toks.length) - 1]?.line ?? 1;
  const here = (): number => peek()?.line ?? lastLine();
  const is = (v: string, k = 0): boolean => { const t = peek(k); return !!t && t.t !== 'int' && t.v === v; };
  const eat = (v: string): boolean => { if (is(v)) { i++; return true; } return false; };
  const describe = (t: Tok | undefined): string => (t ? `"${t.v}"` : 'the end of the program');
  const expect = (v: string, after: string): void => {
    if (!eat(v)) fail(peek() ? here() : lastLine(), `expected "${v}" ${after}, found ${describe(peek())}`);
  };
  const int = (lo: number, hi: number, what: string): number => {
    const t = peek();
    if (!t || t.t !== 'int' || Number(t.v) < lo || Number(t.v) > hi) fail(here(), `${what} must be a number from ${lo} to ${hi}, found ${describe(t)}`);
    i++;
    return Number((toks[i - 1]).v);
  };
  const name = (what: string): string => {
    const t = peek();
    if (!t || t.t !== 'id') return fail(here(), `expected ${what}, found ${describe(t)}`);
    if (KEYWORDS.has(t.v)) fail(t.line, `"${t.v}" is a reserved word and cannot be ${what}`);
    i++;
    return t.v;
  };

  const dirOf = (): string => {
    if (eat('here')) return 'here';
    if (eat('ahead')) return 'ahead';
    if (eat('leftahead')) return 'leftahead';
    if (eat('rightahead')) return 'rightahead';
    if (eat('left') || eat('right')) {
      const side = toks[i - 1].v;
      expect('ahead', `after "${side}"`);
      return `${side}ahead`;
    }
    return fail(here(), `expected here, ahead, left ahead or right ahead, found ${describe(peek())}`);
  };
  const condOf = (): string => {
    if (eat('friend')) return eat('with') ? (expect('food', 'after "with"'), 'friendwithfood') : 'friend';
    if (eat('foe')) {
      if (eat('with')) return (expect('food', 'after "with"'), 'foewithfood');
      if (eat('marker')) return 'foemarker';
      if (eat('home')) return 'foehome';
      return 'foe';
    }
    for (const w of ['friendwithfood', 'foewithfood', 'foemarker', 'foehome', 'food', 'rock', 'home']) if (eat(w)) return w;
    if (eat('marker')) return `marker ${int(0, 5, 'a marker')}`;
    return fail(here(), `expected a condition (friend, foe, food, rock, home, marker N, friend with food, foe with food, foe marker, foe home), found ${describe(peek())}`);
  };

  const cont = (what: string): Cont => {
    const c: Cont = {};
    if (eat('then')) { c.then = instr(); if (eat('else')) c.else = instr(); }
    else if (eat('else')) c.else = instr();
    else if (!eat(';')) fail(peek() ? here() : lastLine(), `expected "then", "else" or ";" after ${what}, found ${describe(peek())}`);
    return c;
  };
  const semi = (what: string): void => expect(';', `after ${what}`);

  const block = (): Node[] => {
    expect('{', 'to open a block');
    const body: Node[] = [];
    while (!is('}')) {
      if (!peek()) fail(lastLine(), 'a block is never closed: expected "}"');
      body.push(instr());
    }
    i++;
    return body;
  };

  function instr(): Node {
    const t = peek();
    if (!t) return fail(lastLine(), 'expected an instruction, found the end of the program');
    const line = t.line;
    if (t.t === 'int') return fail(line, `expected an instruction, found the number ${t.v}`);
    if (t.t === 'p') {
      if (eat(';')) return { line, k: 'nop' };
      if (is('{')) return { line, k: 'block', body: block() };
      return fail(line, `expected an instruction, found "${t.v}"`);
    }
    switch (t.v) {
      case 'sense': {
        i++;
        const d = dirOf(), c = condOf();
        return { line, k: 'sense', head: `sense ${d} ${c}`, cont: cont(`"sense ${d} ${c}"`) };
      }
      case 'mark': case 'unmark': {
        i++;
        const n = int(0, 5, 'a marker');
        semi(`"${t.v} ${n}"`);
        return { line, k: t.v as 'mark' | 'unmark', n };
      }
      case 'pickup': case 'move': i++; return { line, k: t.v as 'pickup' | 'move', cont: cont(`"${t.v}"`) };
      case 'drop': i++; semi('"drop"'); return { line, k: 'drop' };
      case 'turn': {
        i++;
        const dir = eat('left') ? 'left' : eat('right') ? 'right' : fail(here(), `expected left or right after "turn", found ${describe(peek())}`);
        semi(`"turn ${dir}"`);
        return { line, k: 'turn', dir };
      }
      case 'flip': { i++; const p = int(1, MAX_FLIP, 'flip'); return { line, k: 'flip', p, cont: cont(`"flip ${p}"`) }; }
      case 'direction': case 'payload': {
        i++;
        const n = int(0, t.v === 'direction' ? 5 : 2, t.v);
        return { line, k: t.v as 'direction' | 'payload', n, cont: cont(`"${t.v} ${n}"`) };
      }
      case 'loop': i++; return { line, k: 'loop', body: instr() };
      case 'exit': i++; semi('"exit"'); return { line, k: 'exit' };
      case 'repeat': { i++; const n = int(0, MAX_REPEAT, 'repeat'); return { line, k: 'repeat', n, body: instr() }; }
      case 'goto': { i++; const label = name('a label'); semi(`"goto ${label}"`); return { line, k: 'goto', label }; }
      case 'choose': {
        i++;
        expect('{', 'after "choose"');
        const cases: Node[] = [];
        while (!is('}')) {
          if (!peek()) fail(lastLine(), '"choose" is never closed: expected "}"');
          if (is(';')) fail(here(), 'unexpected ";" in a choose: a case holds exactly one instruction (a macro call needs no ";"; use { ... } for several)');
          if (!is('case')) fail(here(), `expected "case:" in a choose, found ${describe(peek())}`);
          i++;
          expect(':', 'after "case"');
          cases.push(instr());
        }
        i++;
        if (!cases.length) fail(line, '"choose" needs at least one "case:"');
        if (cases.length > MAX_CHOOSE) fail(line, `"choose" has ${cases.length} cases; at most ${MAX_CHOOSE} (the chance is exact to 0.4% up to there)`);
        return { line, k: 'choose', cases };
      }
      default: {
        if (KEYWORDS.has(t.v)) return fail(line, is(':', 1) ? `"${t.v}" is a reserved word and cannot be a label` : `"${t.v}" cannot start an instruction here`);
        i++;
        if (is(':')) { i++; return { line, k: 'label', name: t.v, body: instr() }; }
        const args: Node[][] = [];
        while (is('{')) args.push(block());
        return { line, k: 'call', name: t.v, args };
      }
    }
  }

  const macros: Macro[] = [];
  while (peek()) {
    const line = here();
    if (!eat('define')) fail(line, `expected "define" at the top level, found ${describe(peek())}`);
    const mname = name('a macro name');
    if (macros.some((m) => m.name === mname)) fail(line, `macro "${mname}" is defined twice`);
    const params: string[] = [];
    while (peek()?.t === 'id' && !KEYWORDS.has(peek()?.v ?? '')) {
      const p = name('a parameter name');
      if (params.includes(p)) fail(line, `parameter "${p}" is used twice in "${mname}"`);
      params.push(p);
    }
    if (params.length || is('=')) expect('=', `after the parameters of "${mname}"`);
    macros.push({ name: mname, line, params, body: instr() });
  }
  if (!macros.length) fail(0, 'a script needs at least one "define"');
  return macros;
}

/** The first word of the text (after blank lines and comments) is "define": that is a script, not rules, assembly or .ant. */
export function looksLikeScript(text: string): boolean {
  const t = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|#.*$/gm, ' ').trimStart();
  return /^define(\s|$)/i.test(t);
}

// ---------------------------------------------------------------- lowering
interface Scope { labels: Map<string, string> }
interface Env { scope: Scope; params: ReadonlyMap<string, { body: Node[]; env: Env }>; loop: { end: string; used: boolean } | null; stack: readonly string[] }

class Out {
  lines: string[] = [];
  lineOf: number[] = [];
  via = '';
  /** instruction lines (label-only lines are not instructions) */
  count = 0;
  private pending: string[] = [];
  private n = 0;
  uid(): string { return `g${this.n++}`; }
  label(l: string): void { this.pending.push(l); }
  ins(text: string, line: number): void {
    if (this.count >= MAX_AUTHORED) fail(line, `the program is too big: more than ${MAX_AUTHORED} flat instructions after expanding macros and repeat${this.via}`);
    for (const l of this.pending) { this.lines.push(`${l}:`); this.lineOf.push(line); } // label-only lines bind to the next instruction
    this.pending = [];
    this.lines.push(`  ${text}`);
    this.lineOf.push(line);
    this.count++;
  }
}

/** Every label written in these nodes (arguments of macro calls included, macro bodies not: those are their own scopes). */
function labelsIn(nodes: readonly Node[], out: string[] = [], inRepeat = false): string[] {
  for (const n of nodes) {
    switch (n.k) {
      case 'label':
        if (inRepeat) fail(n.line, `label "${n.name}" is inside "repeat": the body is copied, so the label would exist several times`);
        if (out.includes(n.name)) fail(n.line, `label "${n.name}" is defined twice in this scope (labels belong to the define they are written in)`);
        out.push(n.name);
        labelsIn([n.body], out, inRepeat);
        break;
      case 'sense': case 'pickup': case 'move': case 'flip': case 'direction': case 'payload':
        labelsIn([n.cont.then, n.cont.else].filter((x): x is Node => !!x), out, inRepeat);
        break;
      case 'loop': labelsIn([n.body], out, inRepeat); break;
      case 'repeat': labelsIn([n.body], out, inRepeat || n.n > 1); break;
      case 'choose': labelsIn(n.cases, out, inRepeat); break;
      case 'block': labelsIn(n.body, out, inRepeat); break;
      case 'call': n.args.forEach((a) => labelsIn(a, out, inRepeat)); break;
      default: break;
    }
  }
  return out;
}

class Compiler {
  o = new Out();
  readonly warns = new Set<string>();
  readonly used = new Set<string>();
  private readonly byName: Map<string, Macro>;
  private scopes = 0;
  private emittedLabels = new Set<string>();
  private lastLoopExits = true;
  constructor(macros: readonly Macro[]) { this.byName = new Map(macros.map((m) => [m.name, m])); }

  private warn(line: number, msg: string): void { this.warns.add(`line ${line}: ${msg}`); }

  scopeFor(nodes: readonly Node[]): Scope {
    const id = this.scopes++;
    return { labels: new Map(labelsIn(nodes).map((l) => [l, `s${id}_${l}`])) };
  }

  /** Expand one macro as the program: its body, then back to its start (zero cost). */
  program(m: Macro): void {
    this.used.add(m.name);
    const env: Env = { scope: this.scopeFor([m.body]), params: new Map(), loop: null, stack: [m.name] };
    this.o.label('start');
    this.emit(m.body, env);
    this.o.ins('goto start', m.line);
  }

  /** A macro nobody calls still has to be valid: expand it into a scratch buffer with empty blocks for its parameters. */
  check(m: Macro): void {
    const keep = this.o, params = new Map<string, { body: Node[]; env: Env }>();
    const env: Env = { scope: this.scopeFor([m.body]), params, loop: null, stack: [m.name] };
    for (const p of m.params) params.set(p, { body: [], env });
    this.o = new Out();
    try { this.emit(m.body, env); } finally { this.o = keep; }
  }

  private seq(nodes: readonly Node[], env: Env): void {
    nodes.forEach((n, i) => {
      this.emit(n, env);
      const next = nodes[i + 1];
      if (n.k === 'loop' && !this.lastLoopExits && next && next.k !== 'label') this.warn(next.line, 'this can never run: the loop above has no "exit"');
    });
  }

  private cond(n: Node, head: string, c: Cont, env: Env): void {
    const o = this.o, end = o.uid(), els = o.uid();
    if (!c.then && !c.else) {
      o.ins(`${head} else ${end}`, n.line);
      o.label(end);
      if (n.k === 'sense' || n.k === 'flip' || n.k === 'direction' || n.k === 'payload') this.warn(n.line, 'this has no "then" and no "else", so it only spends a round; add one, or remove it');
    } else if (c.then && !c.else) {
      o.ins(`${head} else ${end}`, n.line);
      this.emit(c.then, env);
      o.label(end);
    } else if (!c.then && c.else) {
      o.ins(`${head} else ${els}`, n.line);
      o.ins(`goto ${end}`, n.line);
      o.label(els);
      this.emit(c.else, env);
      o.label(end);
    } else {
      o.ins(`${head} else ${els}`, n.line);
      this.emit(c.then as Node, env);
      o.ins(`goto ${end}`, n.line);
      o.label(els);
      this.emit(c.else as Node, env);
      o.label(end);
    }
  }

  emit(n: Node, env: Env): void {
    const o = this.o;
    switch (n.k) {
      case 'nop': return;
      case 'block': this.seq(n.body, env); return;
      case 'sense': this.cond(n, n.head, n.cont, env); return;
      case 'move': case 'pickup': this.cond(n, n.k, n.cont, env); return;
      case 'direction': case 'payload': this.cond(n, `${n.k} ${n.n}`, n.cont, env); return;
      case 'flip':
        if (n.p > 64) this.warn(n.line, `flip ${n.p}: the chance is only about 1 in ${n.p} (exact for powers of two; see the RNG tab); "choose" and rules keep to 64`);
        this.cond(n, `flipzero ${n.p}`, n.cont, env);
        return;
      case 'mark': case 'unmark': o.ins(`${n.k} ${n.n}`, n.line); return;
      case 'drop': o.ins('drop', n.line); return;
      case 'turn': o.ins(`turn ${n.dir}`, n.line); return;
      case 'loop': {
        const top = o.uid(), ctx = { end: o.uid(), used: false };
        o.label(top);
        this.emit(n.body, { ...env, loop: ctx });
        o.ins(`goto ${top}`, n.line);
        if (ctx.used) o.label(ctx.end);
        this.lastLoopExits = ctx.used;
        return;
      }
      case 'exit':
        if (!env.loop) fail(n.line, '"exit" leaves the loop around it, but there is no loop here (macros start outside any loop)');
        env.loop.used = true;
        o.ins(`goto ${env.loop.end}`, n.line);
        return;
      case 'repeat':
        for (let k = 0; k < n.n; k++) this.emit(n.body, env);
        return;
      case 'choose': {
        const end = o.uid(), k = n.cases.length, next = n.cases.map(() => o.uid());
        n.cases.forEach((c, i) => {
          if (i > 0) o.label(next[i]);
          if (i < k - 1) o.ins(`flipzero ${k - i} else ${next[i + 1]}`, n.line);
          this.emit(c, env);
          if (i < k - 1) o.ins(`goto ${end}`, n.line);
        });
        o.label(end);
        return;
      }
      case 'label': {
        const asm = env.scope.labels.get(n.name) as string;
        if (this.emittedLabels.has(asm)) fail(n.line, `label "${n.name}" would exist twice: a block that contains it is used more than once by its macro`);
        this.emittedLabels.add(asm);
        o.label(asm);
        this.emit(n.body, env);
        return;
      }
      case 'goto': {
        const target = env.scope.labels.get(n.label);
        if (!target) fail(n.line, `no label "${n.label}" here${didYouMean(n.label, env.scope.labels.keys())} (labels belong to the define they are written in)`);
        o.ins(`goto ${target}`, n.line);
        return;
      }
      case 'call': this.call(n, env); return;
    }
  }

  private call(n: Node & { k: 'call' }, env: Env): void {
    const p = env.params.get(n.name);
    if (p) {
      if (n.args.length) fail(n.line, `"${n.name}" is a block given to this macro; it takes no blocks itself`);
      this.seq(p.body, p.env);
      return;
    }
    const m = this.byName.get(n.name);
    if (!m) {
      fail(n.line, `unknown macro or instruction "${n.name}"${didYouMean(n.name, [...KEYWORDS, ...this.byName.keys(), ...env.params.keys()])}`);
      return;
    }
    if (n.args.length !== m.params.length) {
      const hint = m.params.length === 0 && n.args.length === 1 ? '; to run a block after it, put a ";" between them' : '';
      fail(n.line, `macro "${m.name}" takes ${m.params.length} block${m.params.length === 1 ? '' : 's'}, but ${n.args.length} given${hint}`);
    }
    if (env.stack.includes(m.name)) fail(n.line, `macro "${m.name}" calls itself (${[...env.stack.slice(env.stack.indexOf(m.name)), m.name].join(' -> ')}); there is no recursion`);
    if (env.stack.length >= MAX_DEPTH) fail(n.line, `macros are nested more than ${MAX_DEPTH} deep (${[...env.stack, m.name].join(' -> ')})`);
    this.used.add(m.name);
    const inner: Env = {
      scope: this.scopeFor([m.body]),
      params: new Map(m.params.map((pn, i) => [pn, { body: n.args[i], env }])),
      loop: null, stack: [...env.stack, m.name],
    };
    const via = this.o.via;
    this.o.via = ` (inside ${inner.stack.join(' -> ')})`;
    try { this.emit(m.body, inner); } finally { this.o.via = via; }
  }
}

// ---------------------------------------------------------------- public
export interface ScriptCompiled {
  asm: string; program: Program; warnings: string[];
  /** script line of each assembly line (index = assembly line - 1) */
  lineOf: number[];
  /** assembly lines, gotos included: the 2,000 limit counts these */
  instructions: number; macros: string[]; entry: string;
}

export function compileScript(source: string, rules: Rules = CLASSIC): ScriptCompiled {
  const macros = parseScript(source);
  const entry = macros.find((m) => m.name === 'main') ?? macros[macros.length - 1];
  if (entry.params.length) fail(entry.line, `the program starts at "${entry.name}" (the macro "main", or else the last define), and it takes blocks; give it none`);
  const c = new Compiler(macros);
  c.program(entry);
  for (const m of macros) if (!c.used.has(m.name)) { c.check(m); c.warns.add(`line ${m.line}: macro "${m.name}" is never used`); }
  const lines = c.o.lines, lineOf = c.o.lineOf, asm = `${lines.join('\n')}\n`;
  let program: Program;
  try {
    program = assemble(asm, rules);
  } catch (e) {
    if (!(e instanceof AsmError)) throw e;
    const m = /^line (\d+): (.*)$/.exec(e.message), at = m ? lineOf[Number(m[1]) - 1] ?? 0 : 0, msg = m ? m[2] : e.message;
    if (/goto cycle/.test(msg)) fail(at, 'this can go round forever without acting: nothing in it senses, moves, marks or flips (an empty "loop"?)');
    if (/more than/.test(msg)) fail(0, `the program is too big: ${msg} after expanding macros and repeat`);
    if (/not in this ruleset|must be/.test(msg)) fail(at, msg);
    return fail(0, `internal: the compiler produced bad assembly (${e.message})`);
  }
  const warnings = [...c.warns];
  const ops = lines.map((l) => l.trim());
  if (!ops.some((l) => l.startsWith('pickup'))) warnings.push('this program never picks up food');
  if (!ops.some((l) => l === 'drop')) warnings.push('this program never drops food, so nothing is ever delivered');
  const written = new Set<number>(), read = new Set<number>();
  for (const l of ops) {
    const w = /^mark (\d)$/.exec(l), r = /marker (\d) else/.exec(l);
    if (w) written.add(Number(w[1]));
    if (r) read.add(Number(r[1]));
  }
  for (const k of written) if (!read.has(k)) warnings.push(`marker ${k} is written but nothing ever reads it`);
  for (const k of read) if (!written.has(k)) warnings.push(`marker ${k} is read but nothing ever writes it`);
  return { asm, program, warnings, lineOf, instructions: c.o.count, macros: macros.map((m) => m.name), entry: entry.name };
}

/** The script line an ant at `pc` is executing (0 when unknown). */
export const scriptLineAt = (c: ScriptCompiled, pc: number): number => c.lineOf[c.program.lines[pc] - 1] ?? 0;
