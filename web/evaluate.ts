// The Arena's tools, on Workers (web/pool.ts): one brain against another on many worlds, both colours (head to head); a league of all the
// brains; a sweep of one slider of a generated brain; and one brain in every colony of a world (is the world fair?). The games are those
// of `cli/tourney.ts`, `cli/league.ts`, `cli/sweep.ts` and `cli/fairness.ts` (each result shows the command), so a number here can be
// reproduced and checked, and every game of a result can be watched (src/watch.ts, web/gameview.ts).
import { generateWorld } from '../src/core/gen.ts';
import { formatMap } from '../src/core/map.ts';
import { MATCH_ROUNDS, schedule } from '../src/core/match.ts';
import type { Game } from '../src/core/match.ts';
import type { RulesId } from '../src/core/rules.ts';
import { fairness, fairnessHeader, fairnessLines, fairnessCommand } from '../src/fairness.ts';
import type { WorldSpec } from '../src/fairness.ts';
import { describe, headToHead, reproCommand } from '../src/headtohead.ts';
import { leagueCommand, leagueHeader, leagueLines, leagueSummary, leagueTasks, rotation } from '../src/league.ts';
import type { LeagueGame, LeagueWorld } from '../src/league.ts';
import { parsePersonality } from '../src/lang/templates.ts';
import { leagueSweepCommand, leagueSweepHeader, leagueSweepLines, leagueSweepRows, sweepCommand, sweepHeader, sweepLines, sweepParams, sweepSummary, sweepTasks, sweepVariants } from '../src/sweep.ts';
import type { SweepParam } from '../src/sweep.ts';
import { watchFair, watchHead, watchLeague } from '../src/watch.ts';
import type { WatchSpec } from '../src/watch.ts';
import { BatchError, Cancelled, runBatch } from './pool.ts';
import type { Batch, WorkerLike } from './pool.ts';

export interface EvalContext {
  /** The editors, in colony order: their names (letters) and texts. */
  brains(): { names: string[]; texts: string[] };
  rules(): RulesId;
  /** The map in the workshop: what the example-world picker says it is ('' contest generator, 'mirror', 'fairN', a number of colonies for
   * a ring example, 'custom' for a file or a link), its text when it is not the generator's, and the seed box. */
  world(): { kind: string; mapText: string; seed: number };
  /** Show a game of a result ("Watch"); without it the results have no game tables. */
  watch?(spec: WatchSpec): void;
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
  // ---- one slider swept against a reference brain
  const swBrain = select([]), swParam = select([]), swVs = select([]);
  const swWorlds = select([['mirror', 'mirrored worlds (same terrain for both)'], ['contest', 'contest generator (lopsided map by map)']]);
  const swMode = select([['ref', 'one reference brain (head to head)'], ['league', 'all the other brains (a league, one colony each)']]);
  const swLWorld = select([['gen', 'a new world per seed (mirrored for 2 brains, fair for more)'], ['map', 'this map, other simulator seeds']]);
  const lblVs = labelled('against ', swVs), lblWorlds = labelled('Worlds ', swWorlds), lblLWorld = labelled('Worlds ', swLWorld);
  const swSeeds = num(20, 1, MAX_WORLDS), swFrom = num(1, 0, MAX_SEED), swLen = roundsBox(30000);
  const wRun = el('button', 'Run'), wCancel = el('button', 'Cancel');
  const wProgress = el('span', '', 'note'), wResult = el('pre', '', 'evalout'), wCommand = el('pre', '', 'evalout');
  cancel.hidden = fCancel.hidden = lCancel.hidden = wCancel.hidden = copyMap.hidden = true;
  type Tab = 'head' | 'league' | 'sweep' | 'fair';
  const gamesBox: Record<Tab, HTMLDivElement> = { head: el('div'), league: el('div'), sweep: el('div'), fair: el('div') };
  const section = (...kids: HTMLElement[]): HTMLDivElement => { const d = el('div', '', 'evalsec'); d.append(...kids); return d; };
  const sections: Record<Tab, HTMLDivElement> = {
    head: section(el('div', 'One brain against another on many worlds, once per colour (cli/tourney.ts).', 'note'),
      row(labelled('Brain ', selX), labelled('against ', selY)), row(labelled('Worlds ', worlds)),
      row(labelled('How many ', seeds), labelled('from seed ', from), labelled('Length ', rounds)), row(run, cancel, progress), result, command, gamesBox.head),
    league: section(el('div', 'All the brains in one league: every world once per rotation, so each brain takes each hill once (cli/league.ts).', 'note'),
      row(labelled('Worlds ', lMode)), row(labelled('How many ', lSeeds), labelled('from seed ', lFrom), labelled('Length ', lRounds)),
      row(lRun, lCancel, lProgress), lResult, lCommand, gamesBox.league),
    sweep: section(el('div', 'One slider of a generated brain at every level, each against a reference brain, or in a league with all the other brains (cli/sweep.ts). In a league the colonies are the editors: the best level can depend on the number of colonies.', 'note'),
      row(labelled('Brain ', swBrain), labelled('slider ', swParam)), row(labelled('Against ', swMode), lblVs), row(lblWorlds, lblLWorld),
      row(labelled('How many ', swSeeds), labelled('from seed ', swFrom), labelled('Length ', swLen)), row(wRun, wCancel, wProgress), wResult, wCommand, gamesBox.sweep),
    fair: section(el('div', 'One brain in every colony of the map: does each colony win about 1 game in n? It measures a map and a brain together; "no bias found" is not proof of fairness. Fairness is measured for two colonies for now; for more it is a rough check (docs/MATCH.md, cli/fairness.ts).', 'note'),
      row(labelled('Brain ', fBrain), labelled('Worlds ', fMode)),
      row(labelled('Games ', fGames), labelled('from seed ', fFrom), labelled('Length ', fRounds)), row(fRun, fCancel, fProgress), fResult, fCommand, gamesBox.fair),
  };
  const TABS: [Tab, string][] = [['head', 'Head to head'], ['league', 'League'], ['sweep', 'Sweep'], ['fair', 'Fairness']];
  const tabBar = el('div', '', 'evaltabs'), tabButtons = new Map<Tab, HTMLButtonElement>();
  const showTab = (id: Tab): void => {
    for (const [t, d] of Object.entries(sections)) { d.hidden = t !== id; tabButtons.get(t as Tab)?.classList.toggle('on', t === id); }
  };
  for (const [id, label] of TABS) {
    const b = el('button', label); b.onclick = () => { showTab(id); history.replaceState(null, '', `#${id}`); }; tabButtons.set(id, b); tabBar.append(b);
  }
  const fromHash = (): void => { const h = location.hash.slice(1); showTab(Object.hasOwn(sections, h) ? (h as Tab) : 'head'); };
  addEventListener('hashchange', fromHash);
  host.append(row(labelled(`Workers (of ${cores()} core${cores() === 1 ? '' : 's'}) `, workersIn)), tabBar, ...Object.values(sections), row(copyMap));
  fromHash();

  interface GameRow { label: string; detail: string; watch: () => WatchSpec }
  const MAX_ROWS = 400;
  /** The games of a result, one per line, each with a Watch button that shows it in the game viewer. */
  function showGames(box: HTMLElement, rows: GameRow[]): void {
    box.replaceChildren();
    if (!ctx.watch || rows.length === 0) return;
    const details = el('details'), table = el('table', '', 'games'), wrap = el('div', '', 'gameswrap');
    details.open = true; details.append(el('summary', `Games (${rows.length}${rows.length > MAX_ROWS ? `, the first ${MAX_ROWS} listed` : ''}): click Watch to see one`));
    for (const r of rows.slice(0, MAX_ROWS)) {
      const tr = el('tr'), go = el('button', 'Watch'), td = el('td');
      go.onclick = () => { try { ctx.watch?.(r.watch()); } catch (e) { go.textContent = e instanceof Error ? e.message : String(e); } };
      td.append(go); tr.append(el('td', r.label), el('td', r.detail), td); table.append(tr);
    }
    wrap.append(table); details.append(wrap); box.append(details);
  }

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
  const busy = (which: 'head' | 'fair' | 'league' | 'sweep' | null): void => {
    run.disabled = fRun.disabled = lRun.disabled = wRun.disabled = which !== null;
    cancel.hidden = which !== 'head'; fCancel.hidden = which !== 'fair'; lCancel.hidden = which !== 'league'; wCancel.hidden = which !== 'sweep';
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
    result.textContent = ''; command.textContent = ''; gamesBox.head.replaceChildren(); progress.textContent = `0 / ${tasks.length} games`;
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
      showGames(gamesBox.head, games.map((g) => ({ label: `world ${g.seed}, ${shown[0]} ${g.swap ? 'second' : 'first'}`, detail: `${shown[0]} ${g.food[0]} : ${g.food[1]} ${shown[1]}`,
        watch: () => watchHead(g, { texts: [texts[x], texts[y]], names: shown, rules, rounds: len, symmetric }) })));
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
    fResult.textContent = ''; fCommand.textContent = ''; gamesBox.fair.replaceChildren(); copyMap.hidden = true;
    if (!spec) { fResult.textContent = 'This map is one fixed world (a ring example or a loaded file): pick "this map". "A new world per game" needs the contest, mirrored or fair worlds.'; return; }
    mapShown = w.mapText; mapNote = fProgress;
    const tasks = Array.from({ length: n }, (_, k) => ({ seed: first + k })), t0 = performance.now(), ftext = ctx.brains().texts[x], fname = names[x];
    fProgress.textContent = `0 / ${n} games`;
    const b = runBatch(ctx.makeWorker ?? defaultWorker, size(), { kind: 'fair', text: ftext, rules, rounds: len, world: spec }, tasks,
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
      showGames(gamesBox.fair, tasks.map((t, i) => ({ label: `seed ${t.seed}`, detail: outs[i].food.map((f, c) => `${String.fromCharCode(65 + c)} ${f}`).join(', '),
        watch: () => watchFair(t.seed, { text: ftext, name: fname, rules, rounds: len, world: spec }) })));
    } catch (e) {
      fProgress.textContent = ''; fResult.textContent = failure(e, () => names[x]);
    } finally { batch = undefined; busy(null); }
  };
  fCancel.onclick = () => batch?.cancel();

  lRun.onclick = async () => {
    refresh();
    const nWorlds = int(lSeeds, 1, MAX_WORLDS), first = int(lFrom, 0, MAX_SEED);
    if (nWorlds === undefined || first === undefined) { lResult.textContent = `How many: a whole number from 1 to ${MAX_WORLDS}; from seed: a whole number from 0.`; return; }
    const w = ctx.world(), n = names.length, len = Number(lRounds.value), rules = ctx.rules(), lTexts = ctx.brains().texts, lNames = names.slice();
    const world: LeagueWorld = lMode.value === 'map' ? { kind: 'map', mapText: mapTextOf(w) } : { kind: 'gen' };
    const seedList = Array.from({ length: nWorlds }, (_, k) => first + k), tasks = leagueTasks(n, seedList), t0 = performance.now();
    lResult.textContent = ''; lCommand.textContent = ''; gamesBox.league.replaceChildren(); copyMap.hidden = true; mapShown = world.kind === 'map' ? world.mapText : ''; mapNote = lProgress;
    lProgress.textContent = `0 / ${tasks.length} games`;
    const b = runBatch(ctx.makeWorker ?? defaultWorker, size(), { kind: 'league', texts: lTexts, rules, rounds: len, world }, tasks,
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
      showGames(gamesBox.league, games.map((g) => ({ label: `world ${g.seed}, rotation ${g.rot}`, detail: rotation(n, g.rot).map((e, h) => `${lNames[e]} ${g.food[h]}`).join(', '),
        watch: () => watchLeague(g, { texts: lTexts, names: lNames, rules, rounds: len, world }) })));
    } catch (e) {
      lProgress.textContent = ''; lResult.textContent = failure(e, (i) => names[i]);
    } finally { batch = undefined; busy(null); }
  };
  lCancel.onclick = () => batch?.cancel();

  const syncSweepMode = (): void => { const league = swMode.value === 'league'; lblVs.hidden = lblWorlds.hidden = league; lblLWorld.hidden = !league; };
  swMode.onchange = syncSweepMode; syncSweepMode();
  swBrain.onchange = fillParams;
  swParam.onfocus = fillParams; // (the text may have changed since)
  /** The levels of the slider, each in a league with all the other editors (one colony each): one batch of the league's games per level. */
  async function leagueSweep(variants: ReturnType<typeof sweepVariants>, x: number, texts: string[], nWorlds: number, first: number, len: number, rules: RulesId): Promise<void> {
    const others = names.map((_, i) => i).filter((i) => i !== x), nL = others.length + 1, nm = names.slice();
    if (others.length < 1) { wResult.textContent = 'A league needs at least two brains: there is only one editor.'; return; }
    const refTexts = others.map((i) => texts[i]), refNames = others.map((i) => nm[i]), w = ctx.world();
    const world: LeagueWorld = swLWorld.value === 'map' ? { kind: 'map', mapText: mapTextOf(w) } : { kind: 'gen' };
    const seedList = Array.from({ length: nWorlds }, (_, k) => first + k), tasks = leagueTasks(nL, seedList), total = tasks.length * variants.length, t0 = performance.now();
    copyMap.hidden = true; mapShown = world.kind === 'map' ? world.mapText : ''; mapNote = wProgress;
    wProgress.textContent = `0 / ${total} games`;
    busy('sweep');
    const all: LeagueGame[][] = [];
    try {
      for (const v of variants) {
        const base = all.length * tasks.length;
        const b = runBatch(ctx.makeWorker ?? defaultWorker, size(), { kind: 'league', texts: [v.text, ...refTexts], rules, rounds: len, world }, tasks, (d) => { wProgress.textContent = `${base + d} / ${total} games`; });
        batch = b;
        const outs = await b.done;
        all.push(tasks.map((t, i) => ({ ...t, food: outs[i].food })));
      }
      const label = world.kind === 'map' ? 'W.world' : nL === 2 ? 'point-mirror worlds' : `fair worlds for ${nL} colonies`, param = swParam.value as SweepParam;
      wResult.textContent = [leagueSweepHeader(nm[x], param, refNames, nWorlds, label, len, rules, total), ...leagueSweepLines(param, leagueSweepRows(variants, all, seedList, nL), nL, refNames)].join('\n');
      const files = [nm[x], ...refNames].map((l) => `${l}.brain`);
      wCommand.textContent = `Reproduce (save the editors as ${files.join(', ')}${world.kind === 'map' ? ' and the map as W.world' : ''}; ${nm[x]} first):\n` +
        leagueSweepCommand({ brain: files[0], refs: files.slice(1), param, seeds: nWorlds, from: first, rounds: len, rules, world, worldFile: 'W.world' });
      copyMap.hidden = world.kind !== 'map';
      wProgress.textContent = `${total} games in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      showGames(gamesBox.sweep, variants.flatMap((v, vi) => all[vi].map((g) => {
        const entryNames = [`${nm[x]} ${v.label}`, ...refNames];
        return { label: `${v.label}, world ${g.seed}, rotation ${g.rot}`, detail: rotation(nL, g.rot).map((e, h) => `${entryNames[e]} ${g.food[h]}`).join(', '),
          watch: () => watchLeague(g, { texts: [v.text, ...refTexts], names: entryNames, rules, rounds: len, world }) };
      })));
    } catch (e) {
      wProgress.textContent = ''; wResult.textContent = failure(e, (i) => (i === 0 ? nm[x] : refNames[i - 1]));
    } finally { batch = undefined; busy(null); }
  }
  wRun.onclick = async () => {
    refresh(); fillParams();
    const n = int(swSeeds, 1, MAX_WORLDS), first = int(swFrom, 0, MAX_SEED), param = swParam.value as SweepParam;
    if (n === undefined || first === undefined) { wResult.textContent = `How many: a whole number from 1 to ${MAX_WORLDS}; from seed: a whole number from 0.`; return; }
    const { texts } = ctx.brains(), x = swBrain.selectedIndex, y = swVs.selectedIndex, len = Number(swLen.value), symmetric = swWorlds.value === 'mirror', rules = ctx.rules();
    wResult.textContent = ''; wCommand.textContent = ''; gamesBox.sweep.replaceChildren();
    let variants: ReturnType<typeof sweepVariants>;
    try { variants = sweepVariants(texts[x], param); } catch (e) { wResult.textContent = `Brain ${names[x]}: ${e instanceof Error ? e.message : String(e)}`; return; }
    if (swMode.value === 'league') { await leagueSweep(variants, x, texts, n, first, len, rules); return; }
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
      const setupTexts = [...variants.map((v) => v.text), texts[y]], setupNames = [...variants.map((v) => `${names[x]} ${v.label}`), names[y]];
      showGames(gamesBox.sweep, games.map((g) => ({ label: `${variants[g.a].label}, world ${g.seed}, ${g.swap ? 'second' : 'first'}`, detail: `${g.food[0]} : ${g.food[1]} against ${names[y]}`,
        watch: () => watchHead(g, { texts: setupTexts, names: setupNames, rules, rounds: len, symmetric }) })));
    } catch (e) {
      wProgress.textContent = ''; wResult.textContent = failure(e, (i) => (i === variants.length ? names[y] : names[x]));
    } finally { batch = undefined; busy(null); }
  };
  wCancel.onclick = () => batch?.cancel();
  refresh();
  return { refresh };
}
