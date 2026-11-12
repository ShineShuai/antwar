// Rulesets: every variant of the game rules is a named, validated bundle of flags. Classic is the ICFP 2004 task.
// A flag the simulator does not implement yet is rejected, never ignored; see docs/EXTENDING.md to add one.
import type { Rules } from './types.ts';

export const CLASSIC: Rules = Object.freeze({
  cap: 1, ext: false, scareThreshold: 0, dropOnBlocked: false, maxColonies: 2, altOrder: false,
});
/** Post-v1 backlog, not exposed by the clients: carry two + direction/payload sensing. */
export const TINYMINDS: Rules = Object.freeze({ ...CLASSIC, cap: 2, ext: true });
export const RULESETS = { classic: CLASSIC, tinyminds: TINYMINDS } as const;
export type RulesId = keyof typeof RULESETS;

/** Flags a ruleset sets that the simulator cannot honour yet. Each one plugs in at a VARIATION POINT in sim.ts. */
export function unsupported(r: Rules): string[] {
  const out: string[] = [];
  if (r.scareThreshold !== 0) out.push('scareThreshold');
  if (r.dropOnBlocked) out.push('dropOnBlocked');
  if (r.maxColonies !== 2) out.push('maxColonies');
  if (r.altOrder) out.push('altOrder');
  return out;
}
