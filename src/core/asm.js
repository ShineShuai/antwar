// Program loader: flat assembly (.asm, labels) and the official ICFP .ant format -> IR.
// IR = parallel typed arrays; every instruction has a success target `t` and an else target `e`.
export const OP = {
  SENSE: 0, SENSEANY: 1, MARK: 2, UNMARK: 3, MOVE: 4, PICKUP: 5,
  DROP: 6, TURN: 7, FLIP: 8, GOTO: 9, DIRECTION: 10, PAYLOAD: 11,
};
/** Condition ids; marker k is 6 + k. */
export const COND = {
  friend: 0, foe: 1, friendwithfood: 2, foewithfood: 3, food: 4, rock: 5,
  marker: 6, foemarker: 12, home: 13, foehome: 14,
};
const SENSE_DIR = { here: 0, ahead: 1, leftahead: 2, rightahead: 3 };
export const MAX_FLIP = 16384; // x is 14 bit: larger p would not give chance 1/p

export class AsmError extends Error {}
const fail = (line, msg) => {
  throw new AsmError(line ? `line ${line}: ${msg}` : msg);
};
const int = (s, lo, hi, what, line) => {
  if (!/^\d+$/.test(s ?? '') || +s < lo || +s > hi) fail(line, `${what} must be ${lo}..${hi}`);
  return +s;
};
const senseDir = (s, line) => {
  if (!Object.hasOwn(SENSE_DIR, s)) fail(line, `bad sense direction "${s}"`);
  return SENSE_DIR[s];
};

/** @param {{op:number,a?:number,b?:number,t?:number,e?:number}[]} list */
export function makeProgram(list) {
  const n = list.length;
  const P = {
    n, op: new Uint8Array(n), a: new Int32Array(n), b: new Int32Array(n),
    t: new Uint16Array(n), e: new Uint16Array(n),
  };
  list.forEach((I, i) => {
    P.op[i] = I.op; P.a[i] = I.a ?? 0; P.b[i] = I.b ?? 0; P.t[i] = I.t ?? 0; P.e[i] = I.e ?? 0;
  });
  return P;
}

/** Condition tokens -> {mask, count}; `marker k` takes two tokens. */
function parseConds(tok, line) {
  let mask = 0, count = 0;
  for (let j = 0; j < tok.length; j++, count++) {
    const c = tok[j];
    if (!Object.hasOwn(COND, c)) fail(line, `unknown condition "${c}"`);
    mask |= 1 << (c === 'marker' ? COND.marker + int(tok[++j], 0, 5, 'marker', line) : COND[c]);
  }
  return { mask, count };
}

const NEEDS_ELSE = new Set(
  ['sense', 'senseany', 'senseall', 'move', 'pickup', 'flipzero', 'direction', 'payload']);
const EXT_OPS = new Set(['senseany', 'senseall', 'direction', 'payload']);
const ARITY = { mark: 2, unmark: 2, turn: 2, goto: 2, drop: 1 };

/** Flat assembly: `name:` labels, `else <label|n>`, comments after `;`, success falls through. */
export function assemble(text, rules) {
  const labels = new Map(), src = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    let l = raw.split(';')[0].trim().toLowerCase();
    const m = /^([a-z_][a-z0-9_]*):\s*(.*)$/.exec(l);
    if (m) {
      if (labels.has(m[1])) fail(i + 1, `duplicate label ${m[1]}`);
      labels.set(m[1], src.length);
      l = m[2];
    }
    if (l) src.push({ l, line: i + 1 });
  });
  const n = src.length;
  if (!n) fail(0, 'empty program');
  if (n > rules.maxInstr) fail(0, `more than ${rules.maxInstr} instructions`);
  const target = (s, line) => {
    if (labels.has(s)) {
      if (labels.get(s) >= n) fail(line, `label ${s} has no instruction`);
      return labels.get(s);
    }
    return int(s, 0, n - 1, 'jump target', line);
  };
  const list = src.map(({ l, line }, pc) => {
    const k = l.split(/\s+/), o = k[0], e = k.indexOf('else'), I = { t: pc + 1, e: 0 };
    if (!(NEEDS_ELSE.has(o) || o in ARITY)) fail(line, `unknown op "${o}"`);
    if (EXT_OPS.has(o) && !rules.ext) fail(line, `${o} is not in this ruleset`);
    if (NEEDS_ELSE.has(o)) {
      if (e < 0 || e !== k.length - 2) fail(line, 'expected "else <target>" at the end');
      I.e = target(k[e + 1], line);
    } else if (e >= 0 || k.length !== ARITY[o]) fail(line, `wrong arguments for ${o}`);
    switch (o) {
      case 'sense': case 'senseany': case 'senseall': {
        const { mask, count } = parseConds(k.slice(2, e), line);
        if (!count || (o === 'sense' && count !== 1)) fail(line, `${o}: wrong number of conditions`);
        Object.assign(I, { op: o === 'senseany' ? OP.SENSEANY : OP.SENSE, a: senseDir(k[1], line), b: mask });
        break;
      }
      case 'mark': case 'unmark':
        Object.assign(I, { op: o === 'mark' ? OP.MARK : OP.UNMARK, a: int(k[1], 0, 5, 'marker', line) });
        break;
      case 'turn':
        if (k[1] !== 'left' && k[1] !== 'right') fail(line, 'turn left|right');
        Object.assign(I, { op: OP.TURN, a: k[1] === 'right' ? 1 : 0 });
        break;
      case 'flipzero': Object.assign(I, { op: OP.FLIP, a: int(k[1], 1, MAX_FLIP, 'flipzero p', line) }); break;
      case 'goto': Object.assign(I, { op: OP.GOTO, t: target(k[1], line) }); break;
      case 'direction': Object.assign(I, { op: OP.DIRECTION, a: int(k[1], 0, 5, 'direction', line) }); break;
      case 'payload': Object.assign(I, { op: OP.PAYLOAD, a: int(k[1], 0, rules.cap, 'payload', line) }); break;
      case 'move': I.op = OP.MOVE; break;
      case 'pickup': I.op = OP.PICKUP; break;
      case 'drop': I.op = OP.DROP; break;
    }
    return I;
  });
  list.forEach((I, pc) => {
    if (I.t >= n) fail(src[pc].line, 'falls off the end of the program; finish with goto');
  });
  return makeProgram(list);
}

/** Official ICFP 2004 .ant: one state per line, explicit targets (Sense dir st1 st2 cond). */
export function parseIcfp(text, rules) {
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const n = lines.length;
  if (!n) fail(0, 'empty program');
  if (n > rules.maxInstr) fail(0, `more than ${rules.maxInstr} states`);
  const st = (s, line) => int(s, 0, n - 1, 'state', line);
  const list = lines.map((raw, i) => {
    const line = i + 1, k = raw.split(';')[0].trim().toLowerCase().split(/\s+/);
    const need = (len) => k.length === len || fail(line, `${k[0]}: expected ${len - 1} arguments`);
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
  return makeProgram(list);
}
