// Rulesets: every variant of the game rules is a named, validated bundle of flags. Classic is the ICFP 2004 task.
// A flag the simulator does not implement yet is rejected, never ignored; see docs/EXTENDING.md to add one.
import type { Rules } from './types.ts';

export const CLASSIC: Rules = Object.freeze({
  cap: 1, ext: false, scareThreshold: 0, dropOnBlocked: false, altOrder: false,
});
/** The post-v1 bundle: carry two, direction/payload sensing, scared at exactly 4 foes, a blocked carrier of two sheds one,
 * ants act in alternating order. (The number of colonies is not a flag: it is the number of hills of the world, 1 to 26.) */
export const TINYMINDS: Rules = Object.freeze({ cap: 2, ext: true, scareThreshold: 4, dropOnBlocked: true, altOrder: true });
/** One flag at a time, for tests and experiments. */
export const CAP2: Rules = Object.freeze({ ...CLASSIC, cap: 2 });
export const SCARE4: Rules = Object.freeze({ ...CLASSIC, scareThreshold: 4 });
export const DROPFAIL: Rules = Object.freeze({ ...CLASSIC, cap: 2, dropOnBlocked: true });
export const ALTORDER: Rules = Object.freeze({ ...CLASSIC, altOrder: true });
/** Names for menus. */
export const RULESET_NAMES: Record<string, string> = {
  classic: 'Classic (the contest rules)', tinyminds: 'Tinyminds (all flags)', cap2: 'Classic + carry two',
  dropfail: 'Carry two + shed on a blocked move', scare4: 'Classic + scared at 4 foes', altorder: 'Classic + alternating order',
};
/** `colonies` is the old name of Classic with up to 26 colonies, before the colony count left the rulesets: kept so that old share
 * links, replays and saved settings still open. It is Classic; menus list `RULESET_NAMES`, which leaves it out. */
export const RULESETS = { classic: CLASSIC, tinyminds: TINYMINDS, cap2: CAP2, scare4: SCARE4, dropfail: DROPFAIL, altorder: ALTORDER, colonies: CLASSIC } as const;
export type RulesId = keyof typeof RULESETS;
/** The name to show and store: the old `colonies` is Classic. */
export const canonicalRules = (id: RulesId): RulesId => (id === 'colonies' ? 'classic' : id);

/** Flag values the simulator cannot honour (all four former backlog flags are implemented; what is left is out of range).
 * Each flag plugs in at a VARIATION POINT in sim.ts. */
export function unsupported(r: Rules): string[] {
  const out: string[] = [];
  if (!Number.isInteger(r.cap) || r.cap < 1 || r.cap > 2) out.push('cap'); // 1 or 2: has_food is a byte and dropfail sheds from 2
  if (!Number.isInteger(r.scareThreshold) || r.scareThreshold < 0 || r.scareThreshold > 4) out.push('scareThreshold'); // 0 = off; 5 would be the kill
  return out;
}
