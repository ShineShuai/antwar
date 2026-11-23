// The Evaluate panel: one brain of the workshop against another on many worlds, both colours, on Workers (web/pool.ts).
// The games are those of `cli/tourney.ts` (the panel shows the command), so a number here can be reproduced and checked.
import { MATCH_ROUNDS, schedule } from '../src/core/match.ts';
import type { Game } from '../src/core/match.ts';
import type { RulesId } from '../src/core/rules.ts';
import { describe, headToHead, reproCommand } from '../src/headtohead.ts';
import { BatchError, Cancelled, runBatch } from './pool.ts';
import type { Batch, WorkerLike } from './pool.ts';

export interface EvalContext {
  /** The editors, in colony order: their names (letters) and texts. */
  brains(): { names: string[]; texts: string[] };
  rules(): RulesId;
  /** The Workers; the page uses the module Worker of web/batch-worker.ts. */
  makeWorker?: () => WorkerLike;
}

const MAX_WORLDS = 200;
const defaultWorker = (): WorkerLike => new Worker(new URL('./batch-worker.js', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
/** One core is left to the page. */
const poolSize = (): number => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));

export function mountEvaluate(host: HTMLElement, ctx: EvalContext): { refresh(): void } {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e;
  };
  const labelled = (text: string, control: HTMLElement): HTMLLabelElement => { const l = el('label', text); l.append(control); return l; };
  const select = (opts: [string, string][]): HTMLSelectElement => {
    const s = el('select'); for (const [v, t] of opts) s.add(new Option(t, v)); return s;
  };
  const num = (value: number, min: number, max: number): HTMLInputElement => {
    const i = el('input'); i.type = 'number'; i.min = String(min); i.max = String(max); i.value = String(value); i.style.width = '5.5em'; return i;
  };
  const selX = select([]), selY = select([]);
  const worlds = select([['mirror', 'mirrored worlds (same terrain for both)'], ['contest', 'contest generator (lopsided map by map)']]);
  const seeds = num(20, 1, MAX_WORLDS), from = num(1, 0, 0x3fffffff);
  const rounds = select([[String(10000), '10,000 rounds (quick)'], [String(30000), '30,000 rounds'], [String(MATCH_ROUNDS), '100,000 rounds (a match)']]);
  rounds.value = String(MATCH_ROUNDS);
  const run = el('button', 'Run'), cancel = el('button', 'Cancel');
  cancel.hidden = true;
  const progress = el('span', '', 'note'), result = el('pre', '', 'evalout'), command = el('pre', '', 'evalout');
  const row = (...c: HTMLElement[]): HTMLDivElement => { const r = el('div', '', 'row'); r.append(...c); return r; };
  host.append(row(labelled('Brain ', selX), labelled('against ', selY)), row(labelled('Worlds ', worlds)),
    row(labelled('How many ', seeds), labelled('from seed ', from), labelled('Length ', rounds)), row(run, cancel, progress), result, command);

  let names: string[] = [], batch: Batch | undefined;
  function refresh(): void {
    const now = ctx.brains().names;
    if (now.length === names.length && now.every((n, i) => n === names[i])) return;
    const x = selX.selectedIndex, y = selY.selectedIndex;
    names = now;
    for (const s of [selX, selY]) { s.length = 0; names.forEach((n, i) => s.add(new Option(n, String(i)))); }
    selX.selectedIndex = x >= 0 && x < names.length ? x : 0;
    selY.selectedIndex = y >= 0 && y < names.length ? y : Math.min(1, names.length - 1);
  }
  const busy = (on: boolean): void => { run.disabled = on; cancel.hidden = !on; };
  const int = (i: HTMLInputElement, lo: number, hi: number): number | undefined => {
    const v = Number(i.value); return Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
  };

  run.onclick = async () => {
    refresh();
    const n = int(seeds, 1, MAX_WORLDS), first = int(from, 0, 0x3fffffff);
    if (n === undefined || first === undefined) { result.textContent = `How many: a whole number from 1 to ${MAX_WORLDS}; from seed: a whole number from 0.`; return; }
    const { texts } = ctx.brains(), x = selX.selectedIndex, y = selY.selectedIndex, len = Number(rounds.value), symmetric = worlds.value === 'mirror';
    const shown: [string, string] = x === y ? [`${names[x]} (1st)`, `${names[y]} (2nd)`] : [names[x], names[y]];
    const tasks = schedule(2, Array.from({ length: n }, (_, k) => first + k)), rules = ctx.rules();
    result.textContent = ''; command.textContent = ''; progress.textContent = `0 / ${tasks.length} games`;
    const t0 = performance.now();
    batch = runBatch(ctx.makeWorker ?? defaultWorker, poolSize(), { texts: [texts[x], texts[y]], rules, rounds: len, symmetric }, tasks,
      (done) => { progress.textContent = `${done} / ${tasks.length} games`; });
    busy(true);
    try {
      const outs = await batch.done, games: Game[] = tasks.map((t, i) => ({ ...t, ...outs[i] }));
      result.textContent = describe(headToHead(games), shown).join('\n');
      command.textContent = `Reproduce (save the two editors as ${names[x]}.brain and ${names[y]}.brain):\n` +
        reproCommand({ files: [`${names[x]}.brain`, `${names[y]}.brain`], seeds: n, from: first, rounds: len, rules, symmetric });
      progress.textContent = `${tasks.length} games in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) {
      progress.textContent = '';
      result.textContent = e instanceof Cancelled ? 'Cancelled.'
        : e instanceof BatchError && e.brain !== undefined ? `Brain ${names[e.brain === 0 ? x : y]}: ${e.message}` : e instanceof Error ? e.message : String(e);
    } finally { batch = undefined; busy(false); }
  };
  cancel.onclick = () => batch?.cancel();
  refresh();
  return { refresh };
}
