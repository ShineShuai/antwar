// "Chart this match": nest food (or ants alive) of every colony over time for the match the workshop shows (`cli/series.ts` gives the same
// numbers). One game shows how it went, not how a brain does: the Arena measures that.
import { MATCH_ROUNDS } from '../src/core/match.ts';
import type { RulesId } from '../src/core/rules.ts';
import { seriesCommand } from '../src/series.ts';
import type { Series } from '../src/series.ts';
import { drawChart } from './chart.ts';
import { paletteFor } from './colonies.ts';
import { BatchError, Cancelled, runBatch } from './pool.ts';
import type { WorkerLike } from './pool.ts';

export interface MatchChartContext {
  /** The editors in colony order: names (letters) and texts. */
  brains(): { names: string[]; texts: string[] };
  rules(): RulesId;
  /** The map of the workshop: its kind ('' = the contest generator's world of the seed), its text, the seed box. */
  world(): { kind: string; mapText: string; seed: number };
  makeWorker?: () => WorkerLike;
}

const defaultWorker = (): WorkerLike => new Worker(new URL('./batch-worker.js', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export function mountMatchChart(host: HTMLElement, ctx: MatchChartContext): void {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e;
  };
  const labelled = (text: string, control: HTMLElement): HTMLLabelElement => { const l = el('label', text); l.append(control); return l; };
  const select = (opts: [string, string][]): HTMLSelectElement => { const s = el('select'); for (const [v, t] of opts) s.add(new Option(t, v)); return s; };
  const len = select([['10000', '10,000 rounds (quick)'], ['30000', '30,000 rounds'], [String(MATCH_ROUNDS), '100,000 rounds (a match)']]), show = select([['food', 'nest food'], ['alive', 'ants alive']]);
  len.value = String(MATCH_ROUNDS);
  const run = el('button', 'Chart'), cancel = el('button', 'Cancel'), copy = el('button', 'Copy map text');
  const progress = el('span', '', 'note'), chart = el('div'), legend = el('div', '', 'note'), command = el('pre', '', 'evalout');
  cancel.hidden = copy.hidden = true;
  const row = (...c: HTMLElement[]): HTMLDivElement => { const r = el('div', '', 'row'); r.append(...c); return r; };
  host.append(row(labelled('Length ', len), labelled('Show ', show)), row(run, cancel, progress), chart, legend, command, row(copy));

  let shown: { series: Series; names: string[] } | undefined, mapText = '', batch: { cancel(): void } | undefined;
  const draw = (): void => {
    chart.replaceChildren(); legend.textContent = '';
    if (!shown) return;
    const { series, names } = shown, rows = show.value === 'food' ? series.food : series.alive;
    const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches, colors = paletteFor(names.length, dark).ant;
    const lines = names.map((label, c) => ({ label, color: colors[c], y: rows.map((r) => r[c]) }));
    chart.append(drawChart({ x: series.at, lines }));
    lines.forEach((l, c) => {
      const chip = el('span', `\u25a0 ${l.label} ${l.y[l.y.length - 1]}${c < lines.length - 1 ? '   ' : ''}`); chip.style.color = l.color; legend.append(chip);
    });
    legend.append(el('span', `   (round ${series.rounds})`));
  };
  show.onchange = draw;
  copy.onclick = async () => { try { await navigator.clipboard.writeText(mapText); progress.textContent = 'Map text copied.'; } catch { progress.textContent = 'Could not copy the map text.'; } };
  run.onclick = async () => {
    const w = ctx.world(), { names, texts } = ctx.brains(), rounds = Number(len.value), rules = ctx.rules();
    const every = Math.max(1, Math.floor(rounds / 200)), text = w.kind === '' ? undefined : w.mapText, t0 = performance.now();
    command.textContent = ''; shown = undefined; draw(); copy.hidden = true; mapText = text ?? '';
    progress.textContent = 'playing…'; run.disabled = true; cancel.hidden = false;
    const b = runBatch(ctx.makeWorker ?? defaultWorker, 1, { kind: 'series', texts, rules, rounds, every, mapText: text }, [{ seed: w.seed }]);
    batch = b;
    try {
      shown = { series: (await b.done)[0].series, names }; draw();
      const files = names.map((x) => `${x}.brain`);
      command.textContent = `Reproduce (save the editors as ${files.join(', ')}${text ? ' and the map as W.world' : ''}):\n` +
        seriesCommand({ files, seed: w.seed, job: { rules, rounds, every, mapText: text }, worldFile: 'W.world' });
      copy.hidden = !text;
      progress.textContent = `${rounds} rounds in ${((performance.now() - t0) / 1000).toFixed(1)} s, seed ${w.seed}`;
    } catch (e) {
      progress.textContent = '';
      chart.textContent = e instanceof Cancelled ? 'Cancelled.' : e instanceof BatchError && e.brain !== undefined ? `Brain ${names[e.brain]}: ${e.message}` : e instanceof Error ? e.message : String(e);
    } finally { batch = undefined; run.disabled = false; cancel.hidden = true; }
  };
  cancel.onclick = () => batch?.cancel();
}
