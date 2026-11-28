// The Maps page's fairness test, for two colonies: the same brain in both colonies of the map, many games that differ only in the simulator's
// seed; does each colony win about half of them? The games are those of `cli/fairness.ts --world` (the result shows the command). Fairness is
// measured for two colonies for now (docs/MATCH.md); a map of more colonies is only checked for its structure, above.
import { fairness, fairnessCommand, fairnessHeader, fairnessLines } from '../src/fairness.ts';
import type { WorldSpec } from '../src/fairness.ts';
import { BatchError, Cancelled, runBatch } from './pool.ts';
import type { Batch, WorkerLike } from './pool.ts';
import { onProjectChange, readProject } from './project.ts';

const MAX_GAMES = 1000;
export const LENGTHS: [number, string][] = [[10000, '10,000 rounds (quick)'], [30000, '30,000 rounds'], [100000, '100,000 rounds (a match)']];
const defaultWorker = (): WorkerLike => new Worker(new URL('./batch-worker.js', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
const workers = (): number => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));

export interface MapState { /** the map as a world file */ text: string; /** hills found */ colonies: number; /** why the map cannot be played, if it cannot */ problem?: string }
export interface MapFairness { /** The map changed: stop a running test and drop its result. */ invalidate(): void }

export function mountMapFairness(host: HTMLElement, state: () => MapState, makeWorker: () => WorkerLike = defaultWorker): MapFairness {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
  const row = (...c: (Node | string)[]): HTMLDivElement => { const d = el('div', '', 'row'); d.append(...c); return d; };
  const brain = el('select'), games = el('input'), len = el('select');
  games.type = 'number'; games.min = '2'; games.max = String(MAX_GAMES); games.value = '40';
  for (const [v, t] of LENGTHS) len.add(new Option(t, String(v)));
  len.value = '30000';
  const run = el('button', 'Measure'), cancel = el('button', 'Cancel'), progress = el('span', '', 'note'), result = el('pre', '', 'note'), command = el('pre', '', 'note');
  cancel.hidden = true; result.style.whiteSpace = command.style.whiteSpace = 'pre-wrap';
  const label = (t: string, c: HTMLElement): HTMLLabelElement => { const l = el('label', `${t} `); l.append(c); return l; };
  host.append(el('div', 'The same brain in both colonies, many games on this map: does each colony win about half? It measures this map and this brain together; "no bias found" is not proof of fairness.', 'note'),
    row(label('Brain', brain), label('Games', games)), row(label('Length', len)), row(run, cancel, progress), result, command);

  const fill = (): void => {
    const p = readProject(), keep = brain.selectedIndex;
    brain.replaceChildren(...p.names.map((n) => new Option(`brain ${n}`, n)));
    if (keep > 0 && keep < p.names.length) brain.selectedIndex = keep;
  };
  fill(); onProjectChange(fill);

  let batch: Batch<{ food: number[] }> | undefined, gen = 0; // `gen` tells a result from an old map to go away
  const idle = (): void => { batch = undefined; run.disabled = false; cancel.hidden = true; };
  const invalidate = (): void => { gen++; batch?.cancel(); idle(); result.textContent = command.textContent = progress.textContent = ''; };

  run.onclick = async () => {
    const s = state(), n = Number(games.value);
    result.textContent = command.textContent = '';
    if (s.problem) { result.textContent = s.problem; return; }
    if (s.colonies !== 2) { result.textContent = `Fairness is measured for two colonies for now; this map has ${s.colonies}. The checks above say whether every colony has the same terrain.`; return; }
    if (!Number.isInteger(n) || n < 2 || n > MAX_GAMES) { result.textContent = `Games: a whole number from 2 to ${MAX_GAMES}.`; return; }
    const project = readProject(), x = Math.max(0, brain.selectedIndex), text = project.texts[x], name = project.names[x], rounds = Number(len.value), rules = project.rules;
    const spec: WorldSpec = { kind: 'map', mapText: s.text }, mine = ++gen, t0 = performance.now();
    progress.textContent = `0 / ${n} games`; run.disabled = true; cancel.hidden = false;
    const b = runBatch(makeWorker, workers(), { kind: 'fair', text, rules, rounds, world: spec }, Array.from({ length: n }, (_, k) => ({ seed: 1 + k })), (d) => { if (mine === gen) progress.textContent = `${d} / ${n} games`; });
    batch = b;
    try {
      const foods = (await b.done).map((o) => o.food);
      if (mine !== gen) return; // the map changed meanwhile
      result.textContent = [fairnessHeader(`brain ${name}`, spec, 'W.world', n, rounds, rules), ...fairnessLines(fairness(foods))].join('\n');
      command.textContent = `Reproduce (save brain ${name} as ${name}.brain and the map, Export .world, as W.world):\n` + fairnessCommand({ brain: `${name}.brain`, world: 'W.world', spec, games: n, from: 1, rounds, rules });
      progress.textContent = `${n} games in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) {
      if (mine !== gen) return;
      progress.textContent = ''; result.textContent = e instanceof Cancelled ? 'Cancelled.' : e instanceof BatchError && e.brain !== undefined ? `Brain ${name}: ${e.message}` : e instanceof Error ? e.message : String(e);
    } finally { if (mine === gen) idle(); }
  };
  cancel.onclick = () => batch?.cancel();
  return { invalidate };
}
