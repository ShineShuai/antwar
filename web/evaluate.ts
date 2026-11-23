// The Evaluate panel, on Workers (web/pool.ts): one brain of the workshop against another on many worlds, both colours; one brain in
// every colony of a world (is the world fair?); and a league of all the editors. The games are those of `cli/tourney.ts`,
// `cli/fairness.ts` and `cli/league.ts` (the panel shows the command), so a number here can be reproduced and checked. A fourth part
// charts one game over time (`cli/series.ts`): the match of the viewer; and a fifth sweeps one slider of a generated brain (`cli/sweep.ts`).
import { generateWorld } from '../src/core/gen.ts';
import { formatMap } from '../src/core/map.ts';
import { MATCH_ROUNDS, schedule } from '../src/core/match.ts';
import type { Game } from '../src/core/match.ts';
import type { RulesId } from '../src/core/rules.ts';
import { fairness, fairnessHeader, fairnessLines, fairnessCommand } from '../src/fairness.ts';
import type { WorldSpec } from '../src/fairness.ts';
import { describe, headToHead, reproCommand } from '../src/headtohead.ts';
import { leagueCommand, leagueHeader, leagueLines, leagueSummary, leagueTasks } from '../src/league.ts';
import type { LeagueGame, LeagueWorld } from '../src/league.ts';
import { parsePersonality } from '../src/lang/templates.ts';
import { seriesCommand } from '../src/series.ts';
import type { Series } from '../src/series.ts';
import { sweepCommand, sweepHeader, sweepLines, sweepParams, sweepSummary, sweepTasks, sweepVariants } from '../src/sweep.ts';
import type { SweepParam } from '../src/sweep.ts';
import { drawChart } from './chart.ts';
import { paletteFor } from './colonies.ts';
import { BatchError, Cancelled, runBatch } from './pool.ts';
import type { Batch, WorkerLike } from './pool.ts';

export interface EvalContext {
  /** The editors, in colony order: their names (letters) and texts. */
  brains(): { names: string[]; texts: string[] };
  rules(): RulesId;
  /** The map in the workshop: what the example-world picker says it is ('' contest generator, 'mirror', 'fairN', a number of colonies for
   * a ring example, 'custom' for a file or a link), its text when it is not the generator's, and the seed box. */
  world(): { kind: string; mapText: string; seed: number };
  /** The Workers; the page uses the module Worker of web/batch-worker.ts. */
  makeWorker?: () => WorkerLike;
}

const MAX_WORLDS = 200, MAX_GAMES = 5000, MAX_SEED = 0x3fffffff;
const defaultWorker = (): WorkerLike => new Worker(new URL('./batch-worker.js', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
const cores = (): number => Math.max(1, navigator.hardwareConcurrency || 2);
/** The default number of Workers: one core is left to the page (up to 8). The panel lets you take them all. */
const defaultWorkers = (): number => Math.max(1, Math.min(8, cores() - 1));

/** The worlds of a fairness run for the workshop's map: `thisMap` fixes it (only the simulator seed varies), else every game has its own
 * world of the same kind. A ring example or a loaded file is one map and cannot be generated again. */
export function worldSpec(w: { kind: string; mapText: string; seed: number }, thisMap: boolean): WorldSpec | undefined {
  const base: WorldSpec | undefined = w.kind === '' ? { kind: 'contest' } : w.kind === 'mirror' ? { kind: 'mirror' }
    : /^fair\d+$/.test(w.kind) ? { kind: 'fair', colonies: Number(w.kind.slice(4)) } : undefined;
  if (base) return thisMap ? { ...base, mapSeed: w.seed } : base;
  return thisMap ? { kind: 'map', mapText: w.mapText } : undefined;
}

/** The workshop's map as text: the contest generator's world of the seed when the box holds no text. */
export const mapTextOf = (w: { kind: string; mapText: string; seed: number }): string => (w.kind === '' ? formatMap(generateWorld(w.seed)) : w.mapText);

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
  const roundsBox = (def: number): HTMLSelectElement => {
    const s = select([[String(10000), '10,000 rounds (quick)'], [String(30000), '30,000 rounds'], [String(MATCH_ROUNDS), '100,000 rounds (a match)']]);
    s.value = String(def); return s;
  };
  const row = (...c: HTMLElement[]): HTMLDivElement => { const r = el('div', '', 'row'); r.append(...c); return r; };
  const int = (i: HTMLInputElement, lo: number, hi: number): number | undefined => {
    const v = Number(i.value); return Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
  };

  const workersIn = num(defaultWorkers(), 1, cores());
  const size = (): number => int(workersIn, 1, cores()) ?? defaultWorkers();
  // ---- two brains on many worlds
  const selX = select([]), selY = select([]);
  const worlds = select([['mirror', 'mirrored worlds (same terrain for both)'], ['contest', 'contest generator (lopsided map by map)']]);
  const seeds = num(20, 1, MAX_WORLDS), from = num(1, 0, MAX_SEED), rounds = roundsBox(MATCH_ROUNDS);
  const run = el('button', 'Run'), cancel = el('button', 'Cancel');
  const progress = el('span', '', 'note'), result = el('pre', '', 'evalout'), command = el('pre', '', 'evalout');
  // ---- one brain in every colony
  const fBrain = select([]), fMode = select([['map', 'this map, other simulator seeds (tests the map)'], ['gen', 'a new world per game (tests the generator)']]);
  const fGames = num(200, 1, MAX_GAMES), fFrom = num(1, 0, MAX_SEED), fRounds = roundsBox(30000);
  const fRun = el('button', 'Run'), fCancel = el('button', 'Cancel'), copyMap = el('button', 'Copy map text');
  const fProgress = el('span', '', 'note'), fResult = el('pre', '', 'evalout'), fCommand = el('pre', '', 'evalout');
  // ---- a league of all the editors
  const lMode = select([['map', 'this map, other simulator seeds'], ['gen', 'a new world per seed (mirrored for 2 brains, fair for more)']]);
  const lSeeds = num(20, 1, MAX_WORLDS), lFrom = num(1, 0, MAX_SEED), lRounds = roundsBox(30000);
  const lRun = el('button', 'Run'), lCancel = el('button', 'Cancel');
  const lProgress = el('span', '', 'note'), lResult = el('pre', '', 'evalout'), lCommand = el('pre', '', 'evalout');
  // ---- one game over time
  const sLen = roundsBox(MATCH_ROUNDS), sShow = select([['food', 'nest food'], ['alive', 'ants alive']]);
  const sRun = el('button', 'Run'), sCancel = el('button', 'Cancel');
  const sProgress = el('span', '', 'note'), sChart = el('div'), sLegend = el('div', '', 'note'), sCommand = el('pre', '', 'evalout');
  // ---- one slider swept against a reference brain
  const swBrain = select([]), swParam = select([]), swVs = select([]);
  const swWorlds = select([['mirror', 'mirrored worlds (same terrain for both)'], ['contest', 'contest generator (lopsided map by map)']]);
  const swSeeds = num(20, 1, MAX_WORLDS), swFrom = num(1, 0, MAX_SEED), swLen = roundsBox(30000);
  const wRun = el('button', 'Run'), wCancel = el('button', 'Cancel');
  const wProgress = el('span', '', 'note'), wResult = el('pre', '', 'evalout'), wCommand = el('pre', '', 'evalout');
  cancel.hidden = fCancel.hidden = lCancel.hidden = sCancel.hidden = wCancel.hidden = copyMap.hidden = true;
  host.append(
    row(labelled(`Workers (of ${cores()} core${cores() === 1 ? '' : 's'}) `, workersIn)),
    el('div', 'Two brains on many worlds', 'evalhead'),
    row(labelled('Brain ', selX), labelled('against ', selY)), row(labelled('Worlds ', worlds)),
    row(labelled('How many ', seeds), labelled('from seed ', from), labelled('Length ', rounds)), row(run, cancel, progress), result, command,
    el('div', 'One brain in every colony: is the world fair?', 'evalhead'),
    row(labelled('Brain ', fBrain), labelled('Worlds ', fMode)),
    row(labelled('Games ', fGames), labelled('from seed ', fFrom), labelled('Length ', fRounds)), row(fRun, fCancel, fProgress), fResult, fCommand,
    el('div', 'League of all the editors', 'evalhead'),
    row(labelled('Worlds ', lMode)), row(labelled('How many ', lSeeds), labelled('from seed ', lFrom), labelled('Length ', lRounds)),
    row(lRun, lCancel, lProgress), lResult, lCommand,
    el('div', 'Food over time: the match in the viewer', 'evalhead'),
    row(labelled('Length ', sLen), labelled('Show ', sShow)), row(sRun, sCancel, sProgress), sChart, sLegend, sCommand,
    el('div', 'Sweep a slider against a reference brain', 'evalhead'),
    row(labelled('Brain ', swBrain), labelled('slider ', swParam), labelled('against ', swVs)), row(labelled('Worlds ', swWorlds)),
    row(labelled('How many ', swSeeds), labelled('from seed ', swFrom), labelled('Length ', swLen)), row(wRun, wCancel, wProgress), wResult, wCommand, row(copyMap));

  let names: string[] = [], batch: Batch<unknown> | undefined;
  function refresh(): void {
    const now = ctx.brains().names;
    if (now.length === names.length && now.every((n, i) => n === names[i])) return;
    const x = selX.selectedIndex, y = selY.selectedIndex, f = fBrain.selectedIndex, sb = swBrain.selectedIndex, sv = swVs.selectedIndex;
    names = now;
    for (const s of [selX, selY, fBrain, swBrain, swVs]) { s.length = 0; names.forEach((n, i) => s.add(new Option(n, String(i)))); }
    selX.selectedIndex = x >= 0 && x < names.length ? x : 0;
    selY.selectedIndex = y >= 0 && y < names.length ? y : Math.min(1, names.length - 1);
    fBrain.selectedIndex = f >= 0 && f < names.length ? f : 0;
    swBrain.selectedIndex = sb >= 0 && sb < names.length ? sb : 0;
    swVs.selectedIndex = sv >= 0 && sv < names.length ? sv : Math.min(1, names.length - 1);
    fillParams();
  }
  /** The sliders of the chosen brain, when its text is a generated personality. */
  function fillParams(): void {
    const p = parsePersonality(ctx.brains().texts[swBrain.selectedIndex] ?? ''), params = p ? sweepParams(p) : [], keep = swParam.value;
    swParam.length = 0;
    for (const name of params) swParam.add(new Option(name, name));
    if (params.length === 0) swParam.add(new Option('(not a generated personality)', ''));
    swParam.disabled = params.length === 0;
    if (params.includes(keep as SweepParam)) swParam.value = keep;
  }
  const busy = (which: 'head' | 'fair' | 'league' | 'series' | 'sweep' | null): void => {
    run.disabled = fRun.disabled = lRun.disabled = sRun.disabled = wRun.disabled = which !== null;
    cancel.hidden = which !== 'head'; fCancel.hidden = which !== 'fair'; lCancel.hidden = which !== 'league'; sCancel.hidden = which !== 'series'; wCancel.hidden = which !== 'sweep';
  };
  const failure = (e: unknown, brain: (i: number) => string): string => e instanceof Cancelled ? 'Cancelled.'
    : e instanceof BatchError && e.brain !== undefined ? `Brain ${brain(e.brain)}: ${e.message}` : e instanceof Error ? e.message : String(e);

  run.onclick = async () => {
    refresh();
    const n = int(seeds, 1, MAX_WORLDS), first = int(from, 0, MAX_SEED);
    if (n === undefined || first === undefined) { result.textContent = `How many: a whole number from 1 to ${MAX_WORLDS}; from seed: a whole number from 0.`; return; }
    const { texts } = ctx.brains(), x = selX.selectedIndex, y = selY.selectedIndex, len = Number(rounds.value), symmetric = worlds.value === 'mirror';
    const shown: [string, string] = x === y ? [`${names[x]} (1st)`, `${names[y]} (2nd)`] : [names[x], names[y]];
    const tasks = schedule(2, Array.from({ length: n }, (_, k) => first + k)), rules = ctx.rules();
    result.textContent = ''; command.textContent = ''; progress.textContent = `0 / ${tasks.length} games`;
    const t0 = performance.now();
    const b = runBatch(ctx.makeWorker ?? defaultWorker, size(), { kind: 'head', texts: [texts[x], texts[y]], rules, rounds: len, symmetric }, tasks,
      (done) => { progress.textContent = `${done} / ${tasks.length} games`; });
    batch = b;
    busy('head');
    try {
      const outs = await b.done, games: Game[] = tasks.map((t, i) => ({ ...t, ...outs[i] }));
      result.textContent = describe(headToHead(games), shown).join('\n');
      command.textContent = `Reproduce (save the two editors as ${names[x]}.brain and ${names[y]}.brain):\n` +
        reproCommand({ files: [`${names[x]}.brain`, `${names[y]}.brain`], seeds: n, from: first, rounds: len, rules, symmetric });
      progress.textContent = `${tasks.length} games in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) {
      progress.textContent = ''; result.textContent = failure(e, (i) => names[i === 0 ? x : y]);
    } finally { batch = undefined; busy(null); }
  };
  cancel.onclick = () => batch?.cancel();

  let mapShown = '', mapNote = fProgress; // the map text of the last run that needs a file, and where to say it was copied
  copyMap.onclick = async () => {
    try { await navigator.clipboard.writeText(mapShown); mapNote.textContent = 'Map text copied.'; } catch { mapNote.textContent = 'Could not copy the map text.'; }
  };
  fRun.onclick = async () => {
    refresh();
    const n = int(fGames, 1, MAX_GAMES), first = int(fFrom, 0, MAX_SEED);
    if (n === undefined || first === undefined) { fResult.textContent = `Games: a whole number from 1 to ${MAX_GAMES}; from seed: a whole number from 0.`; return; }
    const w = ctx.world(), spec = worldSpec(w, fMode.value === 'map'), x = fBrain.selectedIndex, len = Number(fRounds.value), rules = ctx.rules();
    fResult.textContent = ''; fCommand.textContent = ''; copyMap.hidden = true;
    if (!spec) { fResult.textContent = 'This map is one fixed world (a ring example or a loaded file): pick "this map". "A new world per game" needs the contest, mirrored or fair worlds.'; return; }
    mapShown = w.mapText; mapNote = fProgress;
    const tasks = Array.from({ length: n }, (_, k) => ({ seed: first + k })), t0 = performance.now();
    fProgress.textContent = `0 / ${n} games`;
    const b = runBatch(ctx.makeWorker ?? defaultWorker, size(), { kind: 'fair', text: ctx.brains().texts[x], rules, rounds: len, world: spec }, tasks,
      (done) => { fProgress.textContent = `${done} / ${n} games`; });
    batch = b;
    busy('fair');
    try {
      const outs = await b.done, result = fairness(outs.map((o) => o.food)), file = 'W.world';
      fResult.textContent = [fairnessHeader(names[x], spec, file, n, len, rules), ...fairnessLines(result)].join('\n');
      fCommand.textContent = `Reproduce (save editor ${names[x]} as ${names[x]}.brain${spec.kind === 'map' ? ' and the map as W.world' : ''}):\n` +
        fairnessCommand({ brain: `${names[x]}.brain`, world: file, spec, games: n, from: first, rounds: len, rules: ctx.rules() });
      copyMap.hidden = spec.kind !== 'map';
      fProgress.textContent = `${n} games in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) {
      fProgress.textContent = ''; fResult.textContent = failure(e, () => names[x]);
    } finally { batch = undefined; busy(null); }
  };
  fCancel.onclick = () => batch?.cancel();

  lRun.onclick = async () => {
    refresh();
    const nWorlds = int(lSeeds, 1, MAX_WORLDS), first = int(lFrom, 0, MAX_SEED);
    if (nWorlds === undefined || first === undefined) { lResult.textContent = `How many: a whole number from 1 to ${MAX_WORLDS}; from seed: a whole number from 0.`; return; }
    const w = ctx.world(), n = names.length, len = Number(lRounds.value), rules = ctx.rules();
    const world: LeagueWorld = lMode.value === 'map' ? { kind: 'map', mapText: mapTextOf(w) } : { kind: 'gen' };
    const seedList = Array.from({ length: nWorlds }, (_, k) => first + k), tasks = leagueTasks(n, seedList), t0 = performance.now();
    lResult.textContent = ''; lCommand.textContent = ''; copyMap.hidden = true; mapShown = world.kind === 'map' ? world.mapText : ''; mapNote = lProgress;
    lProgress.textContent = `0 / ${tasks.length} games`;
    const b = runBatch(ctx.makeWorker ?? defaultWorker, size(), { kind: 'league', texts: ctx.brains().texts, rules, rounds: len, world }, tasks,
      (done) => { lProgress.textContent = `${done} / ${tasks.length} games`; });
    batch = b;
    busy('league');
    try {
      const outs = await b.done, games: LeagueGame[] = tasks.map((t, i) => ({ ...t, food: outs[i].food }));
      const file = 'W.world', label = world.kind === 'map' ? file : n === 2 ? 'point-mirror worlds' : `fair worlds for ${n} colonies`;
      lResult.textContent = [leagueHeader(n, seedList, label, len, rules, games.length), ...leagueLines(names, leagueSummary(n, games, seedList))].join('\n');
      lCommand.textContent = `Reproduce (save the editors as ${names.map((x) => `${x}.brain`).join(', ')}${world.kind === 'map' ? ' and the map as W.world' : ''}):\n` +
        leagueCommand({ files: names.map((x) => `${x}.brain`), seeds: nWorlds, from: first, rounds: len, rules, world, worldFile: file });
      copyMap.hidden = world.kind !== 'map';
      lProgress.textContent = `${tasks.length} games in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) {
      lProgress.textContent = ''; lResult.textContent = failure(e, (i) => names[i]);
    } finally { batch = undefined; busy(null); }
  };
  lCancel.onclick = () => batch?.cancel();

  let shown: { series: Series; n: number } | undefined;
  /** The chart of the last series: nest food or ants alive, a line per colony in the viewer's colours. */
  function drawSeries(): void {
    sChart.replaceChildren(); sLegend.textContent = '';
    if (!shown) return;
    const { series, n } = shown, rows = sShow.value === 'food' ? series.food : series.alive;
    const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches, colors = paletteFor(n, dark).ant;
    const lines = names.slice(0, n).map((label, c) => ({ label, color: colors[c], y: rows.map((r) => r[c]) }));
    sChart.append(drawChart({ x: series.at, lines }));
    lines.forEach((l, c) => {
      const chip = el('span', '\u25a0 ' + l.label + ' ' + l.y[l.y.length - 1] + (c < n - 1 ? '   ' : '')); chip.style.color = l.color; sLegend.append(chip);
    });
    sLegend.append(el('span', `   (round ${series.rounds})`));
  }
  sShow.onchange = drawSeries;
  sRun.onclick = async () => {
    refresh();
    const w = ctx.world(), { texts } = ctx.brains(), n = texts.length, len = Number(sLen.value), rules = ctx.rules();
    const every = Math.max(1, Math.floor(len / 200)), mapText = w.kind === '' ? undefined : w.mapText, seed = w.seed, t0 = performance.now();
    sCommand.textContent = ''; shown = undefined; drawSeries(); copyMap.hidden = true; mapShown = mapText ?? ''; mapNote = sProgress;
    sProgress.textContent = 'playing…';
    const b = runBatch(ctx.makeWorker ?? defaultWorker, 1, { kind: 'series', texts, rules, rounds: len, every, mapText }, [{ seed }]);
    batch = b;
    busy('series');
    try {
      shown = { series: (await b.done)[0].series, n };
      drawSeries();
      const files = names.map((x) => `${x}.brain`);
      sCommand.textContent = `Reproduce (save the editors as ${files.join(', ')}${mapText ? ' and the map as W.world' : ''}):\n` +
        seriesCommand({ files, seed, job: { rules, rounds: len, every, mapText }, worldFile: 'W.world' });
      copyMap.hidden = !mapText;
      sProgress.textContent = `${len} rounds in ${((performance.now() - t0) / 1000).toFixed(1)} s, seed ${seed}`;
    } catch (e) {
      sProgress.textContent = ''; sChart.textContent = failure(e, (i) => names[i]);
    } finally { batch = undefined; busy(null); }
  };
  sCancel.onclick = () => batch?.cancel();

  swBrain.onchange = fillParams;
  swParam.onfocus = fillParams; // (the text may have changed since)
  wRun.onclick = async () => {
    refresh(); fillParams();
    const n = int(swSeeds, 1, MAX_WORLDS), first = int(swFrom, 0, MAX_SEED), param = swParam.value as SweepParam;
    if (n === undefined || first === undefined) { wResult.textContent = `How many: a whole number from 1 to ${MAX_WORLDS}; from seed: a whole number from 0.`; return; }
    const { texts } = ctx.brains(), x = swBrain.selectedIndex, y = swVs.selectedIndex, len = Number(swLen.value), symmetric = swWorlds.value === 'mirror', rules = ctx.rules();
    wResult.textContent = ''; wCommand.textContent = '';
    let variants: ReturnType<typeof sweepVariants>;
    try { variants = sweepVariants(texts[x], param); } catch (e) { wResult.textContent = `Brain ${names[x]}: ${e instanceof Error ? e.message : String(e)}`; return; }
    const seedList = Array.from({ length: n }, (_, k) => first + k), tasks = sweepTasks(variants.length, seedList), t0 = performance.now();
    wProgress.textContent = `0 / ${tasks.length} games`;
    const b = runBatch(ctx.makeWorker ?? defaultWorker, size(), { kind: 'head', texts: [...variants.map((v) => v.text), texts[y]], rules, rounds: len, symmetric }, tasks,
      (done) => { wProgress.textContent = `${done} / ${tasks.length} games`; });
    batch = b;
    busy('sweep');
    try {
      const outs = await b.done, games: Game[] = tasks.map((t, i) => ({ ...t, ...outs[i] }));
      wResult.textContent = [sweepHeader(names[x], param, names[y], n, len, rules, symmetric, games.length), ...sweepLines(param, variants, sweepSummary(variants.length, games))].join('\n');
      wCommand.textContent = `Reproduce (save editors ${names[x]} and ${names[y]} as ${names[x]}.brain and ${names[y]}.brain):\n` +
        sweepCommand({ brain: `${names[x]}.brain`, reference: `${names[y]}.brain`, param, seeds: n, from: first, rounds: len, rules, symmetric });
      wProgress.textContent = `${tasks.length} games in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) {
      wProgress.textContent = ''; wResult.textContent = failure(e, (i) => (i === variants.length ? names[y] : names[x]));
    } finally { batch = undefined; busy(null); }
  };
  wCancel.onclick = () => batch?.cancel();
  refresh();
  return { refresh };
}
