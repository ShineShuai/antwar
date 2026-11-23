// A sweep of one Level 0 slider: the brain written at each level of the slider, each played against one reference brain on the same worlds,
// both colours. The by-hand sweeps of docs/STEALING.md as a table with intervals. The games are those of `cli/tourney.ts` (variant, reference).
import type { Game, Task } from './core/match.ts';
import { headToHead } from './headtohead.ts';
import type { HeadToHead } from './headtohead.ts';
import { LEVELS, SETTLE, SETTLE_DEFAULT, parsePersonality, personality, usesSociability } from './lang/templates.ts';
import type { Personality } from './lang/templates.ts';
import type { RulesId } from './core/rules.ts';

export type SweepParam = 'curiosity' | 'boldness' | 'sociability' | 'settling';

/** The sliders this personality has: sociability is idle for a forager and a guard, settling is the Keeper's alone. */
export function sweepParams(p: Personality): SweepParam[] {
  return (['curiosity', 'boldness', 'sociability', 'settling'] as const).filter((n) => (n === 'sociability' ? usesSociability(p.template) : n === 'settling' ? p.template === 'keeper' : true));
}

const levelOf = (p: Personality, param: SweepParam): number => (param === 'settling' ? p.settling ?? SETTLE_DEFAULT : p[param]);

export interface Variant {
  value: number;
  label: string;
  /** The level the brain already has (the control of the sweep). */
  base: boolean;
  /** The brain's text at this level. */
  text: string;
}

/** The brain at every level of one slider; `text` must be what the Level 0 generator wrote (not edited by hand). */
export function sweepVariants(text: string, param: SweepParam): Variant[] {
  const p = parsePersonality(text);
  if (!p) throw new RangeError('the brain is not a generated personality (a template with sliders, not edited by hand)');
  if (!sweepParams(p).includes(param)) throw new RangeError(`a ${p.template} has no ${param} slider`);
  return LEVELS[param].map((name, value) => ({
    value, base: value === levelOf(p, param), text: personality({ ...p, [param]: value }),
    label: name + (param === 'settling' ? ` (1 in ${SETTLE[value]})` : ''),
  }));
}

/** Every game of a sweep of `variants` brains against the reference (entry `variants`), on the given world seeds: variant, seed, colour. */
export function sweepTasks(variants: number, seeds: readonly number[]): Task[] {
  const out: Task[] = [];
  for (let a = 0; a < variants; a++) for (const seed of seeds) for (const swap of [false, true]) out.push({ a, b: variants, seed, swap });
  return out;
}

/** One row per variant: its games against the reference, as a head-to-head of the variant (a) against the reference (b). */
export function sweepSummary(variants: number, games: readonly Game[]): HeadToHead[] {
  return Array.from({ length: variants }, (_, i) => headToHead(games.filter((g) => g.a === i).map((g) => ({ ...g, a: 0, b: 1 }))));
}

/** The table, for the variants and what they played: `+` marks a variant whose 95% interval of the score is above 50%, `-` below, `*` the level the brain has. */
export function sweepLines(param: SweepParam, variants: readonly Variant[], rows: readonly HeadToHead[]): string[] {
  const pct = (x: number): string => (100 * x).toFixed(1), w = Math.max(5, ...variants.map((v) => v.label.length));
  const out = [`  ${param.padEnd(w)}  score%  [95% interval]     W   D   L   food +/-`];
  variants.forEach((v, i) => {
    const h = rows[i], [lo, hi] = h.interval, mark = h.leader === 'a' ? '+' : h.leader === 'b' ? '-' : ' ';
    out.push(`${mark}${v.base ? '*' : ' '}${v.label.padEnd(w)}  ${pct(h.share).padStart(5)}  [${pct(lo).padStart(5)}, ${pct(hi).padStart(5)}]  ${String(h.a.wins).padStart(3)} ${String(h.a.draws).padStart(3)} ${String(h.a.losses).padStart(3)}  ${((h.a.margin >= 0 ? '+' : '') + h.a.margin).padStart(8)}`);
  });
  out.push('', '* the level the brain has; + / -: the 95% interval of the score is above / below 50% (the two games of a world are not independent: approximate).');
  return out;
}

export const sweepHeader = (brain: string, param: SweepParam, reference: string, worlds: number, rounds: number, rules: RulesId, symmetric: boolean, games: number): string =>
  `${brain}, ${param} swept against ${reference}: ${worlds} ${symmetric ? 'mirrored' : 'contest'} worlds, both colours, ${rounds} rounds, rules ${rules}; ${games} games`;

/** The `cli/sweep.ts` command that plays the same games. */
export const sweepCommand = (o: { brain: string; reference: string; param: SweepParam; seeds: number; from: number; rounds: number; rules: RulesId; symmetric: boolean }): string =>
  `node cli/sweep.ts ${o.brain} --vs ${o.reference} --param ${o.param} --seeds ${o.seeds} --from ${o.from} --rounds ${o.rounds} --rules ${o.rules}${o.symmetric ? ' --symmetric' : ''}`;
