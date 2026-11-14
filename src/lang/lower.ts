// Lowering: rules -> flat assembly (src/core/asm.ts). Every rule becomes
//   sense ... else <next rule>;  <actions> ;  goto <mood head>
// and a failed action continues with the next rule, as in reference.html. goto costs nothing, so the layout costs only
// the sensing and the actions. Kit actions (step, return home, ...) are routines expanded in place; they are stateless:
// each re-reads the code under the ant, so no program state is needed beyond the pc.
import type { Action, Ast, Kits, Rule } from './parse.ts';
import { TERMINAL } from './parse.ts';

export interface LineMeta { rule: number; part: 'test' | 'action' | 'glue' }

class Out {
  lines: string[] = [];
  meta: LineMeta[] = [];
  rule = -1;
  part: LineMeta['part'] = 'glue';
  private pending: string[] = [];
  private n = 0;
  uid(): string { return `k${this.n++}`; }
  label(l: string): void { this.pending.push(l); }
  push(line: string): void { this.lines.push(line); this.meta.push({ rule: this.rule, part: this.part }); }
  ins(text: string): void {
    const [first, ...extra] = this.pending;
    this.pending = [];
    for (const e of extra) this.push(`${e}: goto ${first}`); // further labels on the same instruction: free aliases
    this.push(first ? `${first}: ${text}` : `  ${text}`);
  }
  comment(text: string): void { this.push(`; ${text}`); }
}

const nx = (p: number): number => (p + 1) % 3, pv = (p: number): number => (p + 2) % 3;

/** Read the code under the ant: continue at leaf[k] if marker k is set, at `none` if the cell is uncoded. */
function sync(o: Out, leaf: string[], none: string): void {
  const s1 = o.uid(), s2 = o.uid();
  o.ins(`sense here marker 0 else ${s1}`); o.ins(`goto ${leaf[0]}`);
  o.label(s1); o.ins(`sense here marker 1 else ${s2}`); o.ins(`goto ${leaf[1]}`);
  o.label(s2); o.ins(`sense here marker 2 else ${none}`); o.ins(`goto ${leaf[2]}`);
}

/** step: read the code here (an uncoded start cell becomes code 0), move, and on arrival write code+1 if the cell is uncoded. */
function emitStep(o: Out, fail: string, head: string): void {
  const c = [o.uid(), o.uid(), o.uid()], none = o.uid();
  sync(o, c, none);
  o.label(none); o.ins('mark 0'); o.ins(`goto ${c[0]}`);
  for (let p = 0; p < 3; p++) {
    const w1 = o.uid(), w2 = o.uid(), w3 = o.uid();
    o.label(c[p]); o.ins(`move else ${fail}`);
    o.ins(`sense here marker 0 else ${w1}`); o.ins(`goto ${head}`);
    o.label(w1); o.ins(`sense here marker 1 else ${w2}`); o.ins(`goto ${head}`);
    o.label(w2); o.ins(`sense here marker 2 else ${w3}`); o.ins(`goto ${head}`);
    o.label(w3); o.ins(`mark ${nx(p)}`); o.ins(`goto ${head}`);
  }
}

/** A move that ends the rule; with the trail kit it also keeps the codes. */
function emitMove(o: Out, kits: Kits, fail: string, head: string): void {
  if (kits.trail) emitStep(o, fail, head);
  else { o.ins(`move else ${fail}`); o.ins(`goto ${head}`); }
}

function randomTurn(o: Out, done: string): void { // left or right, 50/50, then continue at `done`
  const tr = o.uid();
  o.ins(`flipzero 2 else ${tr}`); o.ins('turn left'); o.ins(`goto ${done}`);
  o.label(tr); o.ins('turn right');
}

/** return home: follow the trail codes one step toward the nest. Fails only when this cell has a code but no neighbour in sight
 * holds the previous one (the nest edge): the next rules decide. Blocked or lost, it retries or feels around itself. */
function emitReturnHome(o: Out, kits: Kits, next: string, head: string): void {
  const c = [o.uid(), o.uid(), o.uid()], none = o.uid();
  sync(o, c, none);
  // no code under us (lost): feel around with a random step, then look again (never fails)
  const r1 = o.uid(), go = o.uid();
  o.label(none); o.ins(`flipzero 3 else ${r1}`); o.ins('turn left'); o.ins(`goto ${go}`);
  o.label(r1); o.ins(`flipzero 2 else ${go}`); o.ins('turn right');
  o.label(go); o.ins(`move else ${head}`); o.ins(`goto ${head}`);
  for (let p = 0; p < 3; p++) {
    const t = pv(p), L = o.uid(), R = o.uid(), M = o.uid(), TL = o.uid(), TR = o.uid(), B = o.uid(), S2 = o.uid(), S3 = o.uid();
    o.label(c[p]); o.ins(`sense ahead marker ${t} else ${L}`); o.ins(`goto ${M}`);
    o.label(L); o.ins(`sense leftahead marker ${t} else ${R}`);
    o.ins(`sense rightahead marker ${t} else ${TL}`); o.ins(`flipzero 2 else ${TR}`);
    o.label(TL); o.ins('turn left'); o.ins(`goto ${M}`);
    o.label(TR); o.ins('turn right'); o.ins(`goto ${M}`);
    o.label(R); o.ins(`sense rightahead marker ${t} else ${next}`); o.ins('turn right');
    o.label(M); o.ins(`move else ${B}`);
    if (kits.foodtrail) o.ins('mark 3');
    o.ins(`goto ${head}`);
    o.label(B); o.ins(`flipzero 4 else ${head}`); // blocked: retry next round, but 1 time in 4 sidestep (breaks jams)
    o.ins(`flipzero 2 else ${S2}`); o.ins('turn left'); o.ins(`goto ${S3}`);
    o.label(S2); o.ins('turn right');
    o.label(S3); o.ins(`move else ${head}`); o.ins(`goto ${head}`);
  }
}

function emitFollowTrail(o: Out, next: string, head: string): void {
  const c = [o.uid(), o.uid(), o.uid()], none = o.uid(), MT = o.uid(), Y = o.uid(), YM = o.uid();
  sync(o, c, none);
  for (let p = 0; p < 3; p++) {
    const TL = o.uid(), TR = o.uid(), E = o.uid(), J = o.uid();
    o.label(c[p]); o.ins(`sense here marker 3 else ${J}`);
    o.ins(`sense ahead marker 3 else ${TL}`); o.ins(`sense ahead marker ${nx(p)} else ${TL}`); o.ins(`goto ${MT}`);
    o.label(TL); o.ins(`sense leftahead marker 3 else ${TR}`); o.ins(`sense leftahead marker ${nx(p)} else ${TR}`); o.ins('turn left'); o.ins(`goto ${MT}`);
    o.label(TR); o.ins(`sense rightahead marker 3 else ${E}`); o.ins(`sense rightahead marker ${nx(p)} else ${E}`); o.ins('turn right'); o.ins(`goto ${MT}`);
    o.label(E); o.ins(`flipzero 4 else ${next}`); o.ins('unmark 3'); o.ins(`goto ${next}`); // trail end: eat it 1 time in 4
    o.label(J); o.ins(`sense ahead marker 3 else ${next}`); o.ins(`sense ahead marker ${nx(p)} else ${next}`); o.ins(`goto ${MT}`);
  }
  o.label(none); o.ins(`sense ahead marker 3 else ${next}`); o.ins(`goto ${MT}`); // not on a code: join any trail cell ahead
  o.label(MT); o.ins(`move else ${Y}`); o.ins(`goto ${head}`);
  o.label(Y); randomTurn(o, YM); // blocked on the lane: step off it, so a carrier coming the other way can pass
  o.label(YM); o.ins(`move else ${head}`); o.ins(`goto ${head}`);
}

function emitAction(o: Out, a: Action, kits: Kits, next: string, head: string, moodHead: (m: string) => string): void {
  switch (a.kind) {
    case 'move': o.ins(`move else ${next}`); break;
    case 'pickup': o.ins(`pickup else ${next}`); break;
    case 'drop': o.ins('drop'); break;
    case 'mark': o.ins(`mark ${a.arg}`); break;
    case 'unmark': o.ins(`unmark ${a.arg}`); break;
    case 'laytrail': o.ins('mark 3'); break;
    case 'turn': o.ins(`turn ${a.arg}`); break;
    case 'turnaround': for (let i = 0; i < 3; i++) o.ins('turn left'); break;
    case 'turnrandom': { // uniform: 0..5 left turns (4 and 5 as two and one right turns)
      const done = o.uid(), t = [o.uid(), o.uid(), o.uid(), o.uid(), o.uid()];
      o.ins(`flipzero 6 else ${t[0]}`); o.ins(`goto ${done}`);
      o.label(t[0]); o.ins(`flipzero 5 else ${t[1]}`); o.ins('turn left'); o.ins(`goto ${done}`);
      o.label(t[1]); o.ins(`flipzero 4 else ${t[2]}`); o.ins('turn left'); o.ins('turn left'); o.ins(`goto ${done}`);
      o.label(t[2]); o.ins(`flipzero 3 else ${t[3]}`); for (let i = 0; i < 3; i++) o.ins('turn left'); o.ins(`goto ${done}`);
      o.label(t[3]); o.ins(`flipzero 2 else ${t[4]}`); o.ins('turn right'); o.ins('turn right'); o.ins(`goto ${done}`);
      o.label(t[4]); o.ins('turn right');
      o.label(done);
      break;
    }
    case 'switch': o.ins(`goto ${moodHead(a.arg as string)}`); break;
    case 'step': emitMove(o, kits, next, head); break;
    case 'explore': { // persistent random walk: turn 1 step in 5 (flipzero falls through with chance 1/5), else straight on
      const go = o.uid(), blocked = o.uid();
      o.ins(`flipzero 5 else ${go}`); randomTurn(o, go);
      o.label(go); emitMove(o, kits, blocked, head);
      o.label(blocked); randomTurn(o, head); o.ins(`goto ${head}`);
      break;
    }
    case 'wander': { // the reference's skill: 1/3 left, 1/3 right, 1/3 step
      const w1 = o.uid(), w2 = o.uid();
      o.ins(`flipzero 3 else ${w1}`); o.ins('turn left'); o.ins(`goto ${head}`);
      o.label(w1); o.ins(`flipzero 2 else ${w2}`); o.ins('turn right'); o.ins(`goto ${head}`);
      o.label(w2); emitMove(o, kits, head, head);
      break;
    }
    case 'roam': { // random step without touching any code (a carrier feeling for the trail)
      const r1 = o.uid(), go = o.uid();
      o.ins(`flipzero 3 else ${r1}`); o.ins('turn left'); o.ins(`goto ${go}`);
      o.label(r1); o.ins(`flipzero 2 else ${go}`); o.ins('turn right');
      o.label(go); o.ins(`move else ${head}`); o.ins(`goto ${head}`);
      break;
    }
    case 'returnhome': emitReturnHome(o, kits, next, head); break;
    case 'followtrail': emitFollowTrail(o, next, head); break;
  }
}

export function lower(ast: Ast): { lines: string[]; meta: LineMeta[] } {
  const o = new Out();
  const moodHead = (m: string): string => `m_${m}`;
  for (const mood of ast.moods) {
    o.comment(`mood ${mood.name}`);
    o.rule = -1; o.part = 'glue';
    o.label(moodHead(mood.name));
    mood.rules.forEach((r: Rule, i) => {
      const next = i + 1 < mood.rules.length ? `r_${mood.name}_${i + 1}` : `end_${mood.name}`;
      o.rule = r.id; o.part = 'test';
      o.comment(r.text);
      o.label(`r_${mood.name}_${i}`);
      for (const c of r.conds) {
        if (!c.not) o.ins(`sense ${c.where} ${c.sense} else ${next}`);
        else { const ok = o.uid(); o.ins(`sense ${c.where} ${c.sense} else ${ok}`); o.ins(`goto ${next}`); o.label(ok); }
      }
      o.part = 'action';
      for (const a of r.actions) emitAction(o, a, ast.kits, next, moodHead(mood.name), moodHead);
      if (!TERMINAL.has(r.actions[r.actions.length - 1].kind)) o.ins(`goto ${moodHead(mood.name)}`);
    });
    o.rule = -1; o.part = 'glue';
    o.label(`end_${mood.name}`); o.ins(`goto ${moodHead(mood.name)}`);
  }
  return { lines: o.lines, meta: o.meta };
}
