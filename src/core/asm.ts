// Program loader: flat assembly (.asm, labels) and the official ICFP .ant format -> IR.
// IR = parallel typed arrays; every instruction has a success target `t` and an else target `e`.
import type { Instr, Program, Rules } from './types.ts';
import { COND, FLAT_BY_NAME, OP } from './isa.ts';
export { COND, OP };
const SENSE_DIR: Record<string, number> = { here: 0, ahead: 1, leftahead: 2, rightahead: 3 };
/** Program size caps: authored assembly vs imported official .ant files. */
export const MAX_AUTHORED = 2000;
export const MAX_IMPORTED = 10000;
export const MAX_FLIP = 16384; // x is 14 bit: larger p would not give chance 1/p

export class AsmError extends Error {}
const fail = (line: number, msg: string): never => {
  throw new AsmError(line ? `line ${line}: ${msg}` : msg);
};
const int = (s: string | undefined, lo: number, hi: number, what: string, line: number): number => {
  const v = Number(s);
  if (!/^\d+$/.test(s ?? '') || v < lo || v > hi) fail(line, `${what} must be ${lo}..${hi}`);
  return v;
};
const senseDir = (s: string, line: number): number => {
  if (!Object.hasOwn(SENSE_DIR, s)) fail(line, `bad sense direction "${s}"`);
  return SENSE_DIR[s];
};

/** @param {{op:number,a?:number,b?:number,t?:number,e?:number}[]} list */
export function makeProgram(list: Instr[]): Program {
  const n = list.length;
  const P: Program = {
    n, op: new Uint8Array(n), a: new Int32Array(n), b: new Int32Array(n),
    t: new Uint16Array(n), e: new Uint16Array(n), lines: new Int32Array(n),
  };
  list.forEach((I: Instr, i: number) => {
    P.op[i] = I.op; P.a[i] = I.a ?? 0; P.b[i] = I.b ?? 0; P.t[i] = I.t ?? 0; P.e[i] = I.e ?? 0; P.lines[i] = I.line ?? 0;
  });
  return P;
}

/** Condition tokens -> {mask, count}; `marker k` takes two tokens. */
function parseConds(tok: string[], line: number): { mask: number; count: number } {
  let mask = 0, count = 0;
  for (let j = 0; j < tok.length; j++, count++) {
    const c = tok[j];
    if (!Object.hasOwn(COND, c)) fail(line, `unknown condition "${c}"`);
    mask |= 1 << (c === 'marker' ? COND.marker + int(tok[++j], 0, 5, 'marker', line) : COND[c]);
  }
  return { mask, count };
}

/** Flat assembly: `name:` labels, `else <label|n>`, comments after `;`, success falls through.
 * `goto` is a compile-time edge, as in every earlier ICFP 2004 toolchain: it costs no round, is resolved here,
 * and does not exist in the IR. A cycle made only of gotos is rejected. */
export function assemble(text: string, rules: Rules): Program {
  const labels = new Map<string, number>(), src: { l: string; line: number }[] = [];
  text.split(/\r?\n/).forEach((raw: string, i: number) => {
    let l = raw.split(';')[0].trim().toLowerCase();
    const m = /^([a-z_][a-z0-9_]*):\s*(.*)$/.exec(l);
    if (m) {
      if (labels.has(m[1])) fail(i + 1, `duplicate label ${m[1]}`);
      if (FLAT_BY_NAME.has(m[1]) || m[1] === 'else') fail(i + 1, `label "${m[1]}" is a reserved word`);
      labels.set(m[1], src.length);
      l = m[2];
    }
    if (l) src.push({ l, line: i + 1 });
  });
  const n = src.length;
  if (!n) fail(0, 'empty program');
  if (n > MAX_AUTHORED) fail(0, `more than ${MAX_AUTHORED} instructions`);
  const target = (s: string, line: number): number => {
    if (labels.has(s)) {
      const at = labels.get(s) as number;
      if (at >= n) fail(line, `label ${s} has no instruction`);
      return at;
    }
    return int(s, 0, n - 1, 'jump target', line);
  };
  const list = src.map(({ l, line }, pc): Instr => {
    const k = l.split(/\s+/), o = k[0], e = k.indexOf('else'), I: Instr = { op: -1, t: pc + 1, e: 0, line };
    const info = FLAT_BY_NAME.get(o);
    if (!info) return fail(line, `unknown op "${o}"`);
    if (info.ext && !rules.ext) fail(line, `${o} is not in this ruleset`);
    if (info.hasElse) {
      if (e < 0 || e !== k.length - 2) fail(line, 'expected "else <target>" at the end');
      I.e = target(k[e + 1], line);
    } else if (e >= 0 || k.length !== info.arity) fail(line, `wrong arguments for ${o}`);
    switch (o) {
      case 'sense': case 'senseany': case 'senseall': {
        const { mask, count } = parseConds(k.slice(2, e), line);
        // senseall with no conditions is always true, senseany with none always false (spec, Instructions tab)
        if (o === 'sense' && count !== 1) fail(line, `${o}: wrong number of conditions`);
        Object.assign(I, { op: info.op, a: senseDir(k[1], line), b: mask });
        break;
      }
      case 'mark': case 'unmark': Object.assign(I, { op: info.op, a: int(k[1], 0, 5, 'marker', line) }); break;
      case 'turn':
        if (k[1] !== 'left' && k[1] !== 'right') fail(line, 'turn left|right');
        Object.assign(I, { op: info.op, a: k[1] === 'right' ? 1 : 0 });
        break;
      case 'flipzero': Object.assign(I, { op: info.op, a: int(k[1], 1, MAX_FLIP, 'flipzero p', line) }); break;
      case 'goto': Object.assign(I, { op: info.op, t: target(k[1], line) }); break;
      case 'direction': Object.assign(I, { op: info.op, a: int(k[1], 0, 5, 'direction', line) }); break;
      case 'payload': Object.assign(I, { op: info.op, a: int(k[1], 0, rules.cap, 'payload', line) }); break;
      default: I.op = info.op; // move, pickup, drop
    }
    return I;
  });
  list.forEach((I, pc) => {
    if ((I.t as number) >= n) fail(src[pc].line, 'falls off the end of the program; finish with goto');
  });
  // Resolve gotos: every edge points at the first real instruction it reaches.
  const final = (from: number): number => {
    const seen = new Set<number>();
    let at = from;
    while (list[at].op === OP.GOTO) {
      if (seen.has(at)) fail(src[at].line, 'goto cycle: these gotos never reach an instruction');
      seen.add(at);
      at = list[at].t as number;
    }
    return at;
  };
  const keep = list.map((_, i) => i).filter((i) => list[i].op !== OP.GOTO);
  const entry = final(0), lead = entry === 0 ? 0 : 1; // program starts at index 0: copy the entry target there
  const index = new Map(keep.map((old, k) => [old, k + lead]));
  const usesElse = (op: number): boolean => ![OP.MARK, OP.UNMARK, OP.DROP, OP.TURN].includes(op);
  const remap = (old: number): Instr => {
    const I = list[old];
    return { ...I, t: index.get(final(I.t as number)), e: usesElse(I.op) ? index.get(final(I.e as number)) : 0 };
  };
  const out = keep.map(remap);
  if (lead) out.unshift(remap(entry));
  return makeProgram(out);
}

/** Official ICFP 2004 .ant: one state per line, explicit targets (Sense dir st1 st2 cond). */
export function parseIcfp(text: string, rules: Rules): Program {
  const lines = text.split(/\r?\n/);
  while (lines.length && !(lines.at(-1) ?? '').trim()) lines.pop();
  const n = lines.length;
  if (!n) fail(0, 'empty program');
  if (n > MAX_IMPORTED) fail(0, `more than ${MAX_IMPORTED} states`);
  const st = (s: string, line: number): number => int(s, 0, n - 1, 'state', line);
  const list = lines.map((raw: string, i: number): Instr => {
    const line = i + 1, k = raw.split(';')[0].trim().toLowerCase().split(/\s+/);
    const need = (len: number) => k.length === len || fail(line, `${k[0]}: expected ${len - 1} arguments`);
    switch (k[0]) {
      case 'sense': {
        const { mask, count } = parseConds(k.slice(4), line);
        need(k[4] === 'marker' ? 6 : 5);
        if (count !== 1) fail(line, 'sense takes one condition');
        return { op: OP.SENSE, a: senseDir(k[1], line), b: mask, t: st(k[2], line), e: st(k[3], line) };
      }
      case 'mark': case 'unmark':
        need(3);
        return { op: k[0] === 'mark' ? OP.MARK : OP.UNMARK, a: int(k[1], 0, 5, 'marker', line), t: st(k[2], line) };
      case 'pickup': need(3); return { op: OP.PICKUP, t: st(k[1], line), e: st(k[2], line) };
      case 'drop': need(2); return { op: OP.DROP, t: st(k[1], line) };
      case 'move': need(3); return { op: OP.MOVE, t: st(k[1], line), e: st(k[2], line) };
      case 'turn':
        need(3);
        if (k[1] !== 'left' && k[1] !== 'right') fail(line, 'turn left|right');
        return { op: OP.TURN, a: k[1] === 'right' ? 1 : 0, t: st(k[2], line) };
      case 'flip':
        need(4);
        return { op: OP.FLIP, a: int(k[1], 1, 2 ** 31 - 1, 'flip p', line), t: st(k[2], line), e: st(k[3], line) };
      default: return fail(line, k[0] ? `unknown instruction "${k[0]}"` : 'empty state');
    }
  });
  list.forEach((I, i) => { I.line = i + 1; });
  return makeProgram(list);
}

/** Flat .asm has `else`, labels or goto; official .ant has none. */
export function brainFormat(text: string): 'asm' | 'ant' {
  const code = text.replace(/;.*$/gm, '');
  const flat = /\belse\b/i.test(code) || /^\s*[a-z_]\w*:/im.test(code) || /^\s*(goto|senseany|senseall|flipzero)\b/im.test(code);
  return flat ? 'asm' : 'ant';
}

/** Pick the loader by content. */
export function loadBrain(text: string, rules: Rules): Program {
  return (brainFormat(text) === 'asm' ? assemble : parseIcfp)(text, rules);
}
