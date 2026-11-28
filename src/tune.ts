// Automatic tuning of a generated brain (docs/TUNING.md): a hill climb over the Level 0 personality (the sliders, the Keeper's settling
// dose, optionally the role mix). Each step plays the brain and every brain one move away against one reference on the same fresh
// worlds, both colours, and takes the move whose paired gain over the brain is clear (z). The climb is a pure function of the scores
// `evaluate` returns, so a run can be cut at any time and resumed from a cache of the evaluations (cli/tune.ts).
import type { Game } from './core/match.ts';
import { headToHead } from './headtohead.ts';
import type { HeadToHead } from './headtohead.ts';
import { LEVELS, SETTLE_DEFAULT, parsePersonality, personality, usesMix } from './lang/templates.ts';
import type { Personality, RoleMix } from './lang/templates.ts';
import { sweepParams } from './sweep.ts';
import type { SweepParam } from './sweep.ts';

/** What a step climbs: the relative nest-food margin of a game, (own - foe) / (own + foe) in -1..1 (fine: small gains show), or the
 * ranking points, 2 for a win and 1 for a draw, as a share of the most (coarse: it is what is finally wanted). */
export type Objective = 'margin' | 'points';
export const OBJECTIVES: readonly Objective[] = ['margin', 'points'];
/** Percentage points the role mix moves in one step. */
export const MIX_STEP = 10;
const ROLES = ['worker', 'scout', 'guard'] as const;

export interface Move { label: string; text: string }

const levelOf = (p: Personality, param: SweepParam): number => (param === 'settling' ? p.settling ?? SETTLE_DEFAULT : p[param]);
const mixLabel = (m: RoleMix): string => `${m.worker}/${m.scout}/${m.guard}`;

/** The brains one move away from `text` (which must be what the personality generator wrote): each slider one level up or down, a Keeper
 * that follows the colonies tries every level of settling, and with `mix` a trail-layer or raider moves MIX_STEP points from one role to another. */
export function neighbors(text: string, mix = false): Move[] {
  const p = parsePersonality(text);
  if (!p) throw new RangeError('the brain is not a generated personality (a template with sliders, not edited by hand)');
  const out: Move[] = [];
  const add = (label: string, q: Personality): void => {
    try { const t = personality(q); if (t !== text) out.push({ label, text: t }); } catch { /* a value the controls cannot make */ }
  };
  for (const param of sweepParams(p)) {
    const cur = levelOf(p, param), names = LEVELS[param], follows = param === 'settling' && p.colonies !== undefined; // (a dose that follows the colonies is no level)
    const from = follows ? `${p.colonies}+ colonies` : names[cur];
    for (const v of follows ? names.map((_, k) => k) : [cur - 1, cur + 1]) {
      if (v < 0 || v >= names.length) continue;
      const { colonies: _c, ...free } = p; // a chosen level replaces the dose that follows the colonies
      const q: Personality = param === 'settling' ? { ...free, settling: v } : { ...p, [param]: v };
      if (q.settling === SETTLE_DEFAULT) delete q.settling; // (the default level is not written in the text)
      add(`${param} ${from} -> ${names[v]}`, q);
    }
  }
  if (mix && usesMix(p.template)) {
    const m = p.mix ?? { worker: 100, scout: 0, guard: 0 };
    for (const from of ROLES) for (const to of ROLES) {
      if (from === to || m[from] < MIX_STEP) continue;
      const q = { ...m, [from]: m[from] - MIX_STEP, [to]: m[to] + MIX_STEP };
      add(`mix ${mixLabel(m)} -> ${mixLabel(q)}`, { ...p, mix: q });
    }
  }
  return out;
}

// ---------- scores
/** One score per world for `brain` (entry `a`) against the reference, from its games (both colours): the mean of the objective over them. */
export function worldScores(games: readonly Game[], objective: Objective): number[] {
  const bySeed = new Map<number, number[]>();
  for (const g of games) {
    const [mine, theirs] = g.food, v = objective === 'points' ? (mine > theirs ? 1 : mine === theirs ? 0.5 : 0) : mine + theirs === 0 ? 0 : (mine - theirs) / (mine + theirs);
    bySeed.set(g.seed, [...(bySeed.get(g.seed) ?? []), v]);
  }
  return [...bySeed.entries()].sort((x, y) => x[0] - y[0]).map(([, vs]) => vs.reduce((a, x) => a + x, 0) / vs.length);
}

export interface PairedDiff { n: number; mean: number; se: number; z: number }
/** The mean of a - b over the worlds, its standard error and z. Both lists are of the same worlds, so the richness of a world drops out. */
export function pairedDiff(a: readonly number[], b: readonly number[]): PairedDiff {
  const n = a.length;
  if (n < 2 || b.length !== n) throw new RangeError('a paired difference needs the same 2 or more worlds on both sides');
  const d = a.map((x, i) => x - b[i]), mean = d.reduce((s, x) => s + x, 0) / n, se = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) / n);
  return { n, mean, se, z: se > 0 ? mean / se : mean > 0 ? Infinity : mean < 0 ? -Infinity : 0 };
}
export const meanOf = (xs: readonly number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;

// ---------- the climb
export interface TuneConfig {
  /** Worlds per step, and the first world seed: step k plays the worlds from + k * seeds ... (fresh worlds each step: no step fits the last one's luck). */
  seeds: number; from: number;
  maxSteps: number;
  /** A move is taken when its gain over the brain has z of at least this (several moves are tried: 2 is a few percent by luck, 1.5 is not enough). */
  z: number;
  mix: boolean;
}
export interface Candidate { move: Move; scores: number[]; diff: PairedDiff }
export interface StepRecord {
  step: number; seeds: number[];
  brain: { text: string; scores: number[]; mean: number };
  candidates: Candidate[];
  /** The move taken, if any. */
  taken?: Candidate;
}
export interface Climb { steps: StepRecord[]; best: string; path: Move[]; stopped: 'optimum' | 'max-steps' }
/** Plays `text` against the reference on these worlds and gives one score per world, in the order of `seeds`. */
export type Evaluate = (text: string, seeds: readonly number[]) => Promise<number[]>;

export async function climb(start: string, evaluate: Evaluate, cfg: TuneConfig, onStep?: (s: StepRecord) => void): Promise<Climb> {
  const steps: StepRecord[] = [], path: Move[] = [], seen = new Set([start]);
  let best = start;
  for (let step = 0; step < cfg.maxSteps; step++) {
    const seeds = Array.from({ length: cfg.seeds }, (_, i) => cfg.from + step * cfg.seeds + i);
    const scores = await evaluate(best, seeds), candidates: Candidate[] = [];
    for (const move of neighbors(best, cfg.mix)) {
      if (seen.has(move.text)) continue;
      const s = await evaluate(move.text, seeds);
      candidates.push({ move, scores: s, diff: pairedDiff(s, scores) });
    }
    const taken = candidates.filter((c) => c.diff.mean > 0 && c.diff.z >= cfg.z).sort((a, b) => b.diff.mean - a.diff.mean)[0];
    const rec: StepRecord = { step, seeds, brain: { text: best, scores, mean: meanOf(scores) }, candidates, ...(taken ? { taken } : {}) };
    steps.push(rec); onStep?.(rec);
    if (!taken) return { steps, best, path, stopped: 'optimum' };
    best = taken.move.text; path.push(taken.move); seen.add(best);
  }
  return { steps, best, path, stopped: 'max-steps' };
}

// ---------- reports
const sgn = (x: number, d = 3): string => (x >= 0 ? '+' : '-') + Math.abs(x).toFixed(d);
export const tuneHeader = (brain: string, vs: string, o: { objective: Objective; seeds: number; rounds: number; rules: string; symmetric: boolean; z: number; maxSteps: number }): string =>
  `${brain} tuned against ${vs}: ${o.seeds} fresh ${o.symmetric ? 'mirrored' : 'contest'} worlds a step, both colours, ${o.rounds} rounds, rules ${o.rules}; climbing ${o.objective}, a move needs z >= ${o.z}, at most ${o.maxSteps} steps`;

/** One step: the brain's score, every move's paired gain over it, and the move taken. */
export function stepLines(r: StepRecord): string[] {
  const w = Math.max(10, ...r.candidates.map((c) => c.move.label.length));
  const out = [`step ${r.step + 1} (worlds ${r.seeds[0]}..${r.seeds[r.seeds.length - 1]}): brain scores ${sgn(r.brain.mean)}`, `  ${'move'.padEnd(w)}  score    gain    +-95%   z`];
  for (const c of r.candidates) {
    out.push(`${c === r.taken ? '>' : ' '} ${c.move.label.padEnd(w)}  ${sgn(meanOf(c.scores))}  ${sgn(c.diff.mean)}  ${(1.96 * c.diff.se).toFixed(3)}  ${Number.isFinite(c.diff.z) ? c.diff.z.toFixed(2) : String(c.diff.z)}`);
  }
  out.push(r.taken ? `  taken: ${r.taken.move.label}` : r.candidates.length ? '  no move has a clear gain: the brain is at a (local) optimum at this noise level' : '  no move to try');
  return out;
}

/** The confirmation on worlds no step saw: the tuned brain and the start, each against the reference. */
export interface Confirmation { start: HeadToHead; tuned: HeadToHead; margin: PairedDiff; points: PairedDiff }
export function confirm(startGames: readonly Game[], tunedGames: readonly Game[]): Confirmation {
  const gain = (o: Objective): PairedDiff => pairedDiff(worldScores(tunedGames, o), worldScores(startGames, o));
  return { start: headToHead(startGames), tuned: headToHead(tunedGames), margin: gain('margin'), points: gain('points') };
}
export function confirmLines(c: Confirmation, vs: string, worlds: number): string[] {
  const pct = (x: number): string => (100 * x).toFixed(1), row = (name: string, h: HeadToHead): string =>
    `  ${name.padEnd(6)} ${pct(h.share).padStart(5)}%  [${pct(h.interval[0]).padStart(5)}, ${pct(h.interval[1]).padStart(5)}]  ${h.a.wins}-${h.a.draws}-${h.a.losses}  food ${h.a.margin >= 0 ? '+' : ''}${h.a.margin}`;
  const z = (d: PairedDiff): string => `${sgn(d.mean)} +-${(1.96 * d.se).toFixed(3)} (z ${Number.isFinite(d.z) ? d.z.toFixed(2) : d.z})`;
  return [`confirmation: ${worlds} fresh worlds, both colours, each brain against ${vs}`, '         score   [95% interval]   W-D-L', row('start', c.start), row('tuned', c.tuned),
    `  paired gain of the tuned brain over the start: margin ${z(c.margin)}, points share ${z(c.points)}`,
    c.points.z >= 1.96 ? 'The tuned brain scores clearly higher on worlds the climb never saw.'
      : c.points.z <= -1.96 || c.margin.z <= -1.96 ? 'The tuned brain does clearly WORSE on fresh worlds: the climb fitted luck.'
        : c.margin.z >= 1.96 ? 'The nest food margin is clearly higher on fresh worlds; wins and draws are coarse and not yet clearly more: the gain looks real, play more worlds to see it in the score.'
          : 'No clear difference on fresh worlds: the gains the climb saw may be luck; play more worlds before keeping the change.'];
}
