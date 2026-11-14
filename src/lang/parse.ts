// Rules language (reference.html, Easy authoring, levels 1-2): ordered "when ... -> ..." rules grouped into moods.
// Plain-English errors with line numbers; nothing here touches the simulator.
export class RulesError extends Error {}

export type Where = 'here' | 'ahead' | 'leftahead' | 'rightahead';
export interface Cond { not: boolean; /** assembly condition, e.g. "food" or "marker 2" */ sense: string; where: Where; text: string }
export type ActionKind =
  | 'move' | 'pickup' | 'drop' | 'turn' | 'turnaround' | 'turnrandom' | 'mark' | 'unmark' | 'switch'
  | 'step' | 'wander' | 'explore' | 'roam' | 'returnhome' | 'followtrail' | 'laytrail';
export interface Action { kind: ActionKind; arg?: string | number; text: string }
export interface Rule { id: number; mood: string; line: number; text: string; conds: Cond[]; actions: Action[]; otherwise: boolean }
export interface Mood { name: string; line: number; rules: Rule[] }
export interface Kits { trail: boolean; foodtrail: boolean }
export interface Ast { kits: Kits; moods: Mood[] }

/** Actions that end the rule's action list (they jump away or are routines that return to the mood). */
export const TERMINAL: ReadonlySet<ActionKind> = new Set(['switch', 'step', 'wander', 'explore', 'roam', 'returnhome', 'followtrail']);
/** Actions that can fail; a failed action continues with the next rule. */
export const FALLIBLE: ReadonlySet<ActionKind> = new Set(['move', 'pickup', 'step', 'returnhome', 'followtrail']);
/** Markers reserved by the trail kit (the code) and the food trail. */
export const KIT_MARKERS = { trail: [0, 1, 2], foodtrail: [3] } as const;

const WHERE_WORDS = ['here', 'ahead', 'leftahead', 'rightahead'];
const WHAT_WORDS = ['food', 'rock', 'foe', 'friend', 'home', 'marker', 'carrying'];
const ACTION_WORDS = ['move', 'pickup', 'drop', 'turn', 'mark', 'unmark', 'switch', 'step', 'wander', 'explore', 'roam', 'return', 'follow', 'lay'];

function fail(line: number, msg: string): never { throw new RulesError(`line ${line}: ${msg}`); }
const distance = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
};
const didYouMean = (word: string, options: string[]): string => {
  const best = options.map((o) => [o, distance(word, o)] as const).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= 2 ? ` (did you mean "${best[0]}"?)` : '';
};
const num = (word: string | undefined, lo: number, hi: number, what: string, line: number): number => {
  if (word === undefined || !/^\d+$/.test(word) || Number(word) < lo || Number(word) > hi) fail(line, `${what} must be a number from ${lo} to ${hi}`);
  return Number(word);
};

function parseCond(raw: string, line: number): Cond {
  const text = raw.trim();
  const words = text.toLowerCase().replace(/left[ -]ahead/g, 'leftahead').replace(/right[ -]ahead/g, 'rightahead').split(/\s+/).filter(Boolean);
  let not = false;
  if (words[0] === 'not') { not = true; words.shift(); }
  if (!words.length) fail(line, `empty condition near "${text}"`);
  if (words.join(' ') === 'carrying') return { not, sense: 'friendwithfood', where: 'here', text };
  const where = words.pop() as string;
  if (!WHERE_WORDS.includes(where)) {
    fail(line, `"${text}": say where to look at the end: here, ahead, left ahead or right ahead${didYouMean(where, WHERE_WORDS)}`);
  }
  const what = words.join(' ');
  let sense: string;
  if (['food', 'rock', 'foe', 'friend', 'home'].includes(what)) sense = what;
  else if (what === 'foe home') sense = 'foehome';
  else if (what === 'foe marker') sense = 'foemarker';
  else if (what === 'foe carrying') sense = 'foewithfood';
  else if (what === 'friend carrying') sense = 'friendwithfood';
  else if (words[0] === 'marker' && words.length === 2) sense = `marker ${num(words[1], 0, 5, 'a marker', line)}`;
  else fail(line, `unknown condition "${what || where}"${didYouMean(words[0] ?? '', WHAT_WORDS)}; try food, rock, foe, friend, home, foe home, marker N, carrying`);
  return { not, sense, where: where as Where, text };
}

function parseAction(raw: string, line: number): Action {
  const text = raw.trim();
  const w = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!w.length) fail(line, 'empty action (a stray comma?)');
  const one = (kind: ActionKind): Action => { if (w.length !== 1) fail(line, `"${text}": ${w[0]} takes no extra words`); return { kind, text }; };
  switch (w[0]) {
    case 'move': return one('move');
    case 'step': return one('step');
    case 'pickup': return one('pickup');
    case 'drop': return one('drop');
    case 'wander': return one('wander');
    case 'explore': return one('explore');
    case 'roam': return one('roam');
    case 'turn':
      if (w.length === 2 && (w[1] === 'left' || w[1] === 'right')) return { kind: 'turn', arg: w[1], text };
      if (w.length === 2 && w[1] === 'around') return { kind: 'turnaround', text };
      if (w.length === 2 && w[1] === 'random') return { kind: 'turnrandom', text };
      return fail(line, `"${text}": turn left, turn right, turn around or turn random`);
    case 'mark': case 'unmark':
      if (w.length !== 2) fail(line, `"${text}": ${w[0]} needs a marker number, e.g. ${w[0]} 4`);
      return { kind: w[0], arg: num(w[1], 0, 5, 'a marker', line), text };
    case 'switch':
      if (w.length !== 2) fail(line, `"${text}": switch needs a mood name, e.g. switch search`);
      return { kind: 'switch', arg: w[1], text };
    case 'return':
      if (w.length === 2 && w[1] === 'home') return { kind: 'returnhome', text };
      return fail(line, `"${text}": did you mean "return home"?`);
    case 'follow':
      if (w.length === 2 && w[1] === 'trail') return { kind: 'followtrail', text };
      return fail(line, `"${text}": did you mean "follow trail"?`);
    case 'lay':
      if (w.length === 2 && w[1] === 'trail') return { kind: 'laytrail', text };
      return fail(line, `"${text}": did you mean "lay trail"?`);
    default: return fail(line, `unknown action "${w[0]}"${didYouMean(w[0], ACTION_WORDS)}`);
  }
}

const ARROW = /\s*(?:->|→)\s*|\s+(?:do|then)\s+/;

export function parseRules(source: string): Ast {
  const kits: Kits = { trail: false, foodtrail: false };
  const moods: Mood[] = [];
  let cur: Mood | null = null, nextId = 0;
  source.split('\n').forEach((rawLine, i) => {
    const line = i + 1;
    const text = rawLine.replace(/#.*$/, '').trim();
    if (!text) return;
    const lower = text.toLowerCase();
    const head = lower.split(/\s+/)[0];
    if (head === 'kit') {
      const name = lower.split(/\s+/)[1];
      if (name === 'trail') kits.trail = true;
      else if (name === 'foodtrail') kits.foodtrail = true;
      else fail(line, `unknown kit "${name ?? ''}"; the kits are: trail, foodtrail`);
      return;
    }
    if (head === 'mood') {
      const name = lower.split(/\s+/)[1];
      if (!name || lower.split(/\s+/).length !== 2 || !/^[a-z][a-z0-9_]*$/.test(name)) fail(line, 'a mood line looks like: mood search');
      if (moods.some((m) => m.name === name)) fail(line, `mood "${name}" is defined twice`);
      cur = { name, line, rules: [] };
      moods.push(cur);
      return;
    }
    if (!['when', 'always', 'otherwise'].includes(head)) {
      fail(line, `a line must start with when, always, otherwise, mood or kit, not "${head}"${didYouMean(head, ['when', 'always', 'otherwise', 'mood', 'kit'])}`);
    }
    if (!cur) { cur = { name: 'main', line, rules: [] }; moods.push(cur); }
    if (cur.rules.at(-1)?.otherwise) fail(line, `the rules after "otherwise" in mood "${cur.name}" can never run: put "otherwise" last`);
    const rest = text.slice(head.length).trim();
    let condText = '', actionText: string;
    if (head === 'when') {
      const parts = rest.split(ARROW);
      if (parts.length !== 2 || !parts[0] || !parts[1]) fail(line, 'a rule looks like: when food ahead -> step');
      [condText, actionText] = parts;
    } else {
      actionText = rest.replace(/^(?:->|→|do|then)\s*/i, '');
      if (!actionText) fail(line, `"${head}" needs actions, e.g. ${head} -> wander`);
    }
    const conds = head === 'when' ? condText.split(/\s+and\s+/i).map((c) => parseCond(c, line)) : [];
    const actions = actionText.split(',').map((a) => parseAction(a, line));
    cur.rules.push({ id: nextId++, mood: cur.name, line, text, conds, actions, otherwise: head === 'otherwise' });
  });
  const ast: Ast = { kits, moods };
  validate(ast);
  return ast;
}

function validate({ kits, moods }: Ast): void {
  if (!moods.length) fail(1, 'no rules found; start with something like: always -> wander');
  if (kits.foodtrail && !kits.trail) fail(1, 'kit foodtrail needs kit trail (it follows the trail codes)');
  const names = new Set(moods.map((m) => m.name));
  const reserved = new Set<number>([...(kits.trail ? KIT_MARKERS.trail : []), ...(kits.foodtrail ? KIT_MARKERS.foodtrail : [])]);
  for (const m of moods) {
    if (!m.rules.length) fail(m.line, `mood "${m.name}" has no rules`);
    for (const r of m.rules) {
      for (const c of r.conds) {
        const k = /^marker (\d)$/.exec(c.sense);
        if (k && reserved.has(Number(k[1]))) fail(r.line, `marker ${k[1]} is used by the trail kit; use another marker`);
      }
      r.actions.forEach((a, i) => {
        if (TERMINAL.has(a.kind) && i < r.actions.length - 1) fail(r.line, `"${a.text}" must be the last action of a rule (it ends the rule)`);
        if (a.kind === 'switch' && !names.has(a.arg as string)) fail(r.line, `there is no mood called "${a.arg}"${didYouMean(a.arg as string, [...names])}`);
        if ((a.kind === 'mark' || a.kind === 'unmark') && reserved.has(a.arg as number)) fail(r.line, `marker ${a.arg} is used by the trail kit; use another marker`);
        if ((a.kind === 'returnhome' || a.kind === 'roam') && !kits.trail) fail(r.line, `"${a.text}" needs "kit trail" at the top of the program`);
        if (a.kind === 'followtrail' && !kits.foodtrail) fail(r.line, '"follow trail" needs "kit foodtrail" at the top of the program');
        if (a.kind === 'laytrail' && !kits.foodtrail) fail(r.line, '"lay trail" needs "kit foodtrail" at the top of the program');
      });
    }
  }
}
