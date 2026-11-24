// The project shared by the pages (Workshop, Arena, ...): the workshop's saved state in localStorage is the project: the brains of the
// colonies in order, the seed, the Rules and the map. Pages read it with `readProject`; only the workshop (and later the map designer) writes it.
import { LEVELS, SETTLE_DEFAULT, TEMPLATE_NAMES, parsePersonality } from '../src/lang/templates.ts';
import { canonicalRules, RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { STARTER } from './default-ant.ts';

export const PROJECT_KEY = 'tinyminds.workshop.v1';
const MAX_COLONIES = 26, MAX_MAP_TEXT = 1 << 17;

/** What the map is, as the workshop's example-world picker lists it: '' the contest generator's world of the seed (no text), 'custom' a file or
 * a link, 'mirror' and 'fairN' the seed-driven generators, a number a ring example. `mapText` is the map (empty for the contest generator). */
export interface ProjectWorld { kind: string; mapText: string }
export interface Project { texts: string[]; names: string[]; seed: number; rules: RulesId; world: ProjectWorld }

const KINDS = /^(|custom|mirror|fair\d+|\d+)$/;
const letter = (c: number): string => String.fromCharCode(65 + c);

/** The saved project, with defaults for whatever is missing or damaged (two starter brains, seed 12345, Classic, the contest generator). */
export function readProject(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Project {
  let s: Record<string, unknown> | null = null;
  try { s = JSON.parse(storage?.getItem(PROJECT_KEY) ?? 'null') as Record<string, unknown> | null; } catch { s = null; }
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const more = Array.isArray(s?.more) ? (s.more as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, MAX_COLONIES - 2) : [];
  const texts = [str(s?.a) ?? STARTER, str(s?.b) ?? STARTER, ...more];
  const seed = Number(str(s?.seed));
  const rules = str(s?.rules) !== undefined && Object.hasOwn(RULESETS, s?.rules as string) ? canonicalRules(s?.rules as RulesId) : 'classic';
  const w = s?.world as { kind?: unknown; text?: unknown } | undefined;
  const world: ProjectWorld = typeof w?.kind === 'string' && KINDS.test(w.kind) && typeof w.text === 'string' && w.text.length <= MAX_MAP_TEXT ? { kind: w.kind, mapText: w.text } : { kind: '', mapText: '' };
  return { texts, names: texts.map((_, c) => letter(c)), seed: Number.isInteger(seed) && str(s?.seed) !== '' ? seed : 12345, rules, world };
}

/** Calls `cb` when another page of this browser saved the project. Returns the function that stops listening. */
export function onProjectChange(cb: () => void): () => void {
  const h = (e: StorageEvent): void => { if (e.key === PROJECT_KEY || e.key === null) cb(); };
  addEventListener('storage', h);
  return () => removeEventListener('storage', h);
}

/** One line about a brain: the generator's template and sliders, or the first line of its text. */
export function brainSummary(text: string): string {
  const p = parsePersonality(text);
  if (p) {
    const bits = [`curiosity ${LEVELS.curiosity[p.curiosity]}`, `boldness ${LEVELS.boldness[p.boldness]}`];
    if (p.template === 'trail' || p.template === 'raider' || p.template === 'keeper') bits.push(`sociability ${LEVELS.sociability[p.sociability]}`);
    if (p.template === 'keeper') bits.push(`settling ${LEVELS.settling[p.settling ?? SETTLE_DEFAULT]}`); // (the default level is not written in the text)
    return `${TEMPLATE_NAMES[p.template]}: ${bits.join(', ')}`;
  }
  const first = text.split('\n').find((l) => l.trim() !== '') ?? '(empty)';
  return `hand-written: ${first.trim().slice(0, 70)}`;
}

/** What the project's map is, in words. */
export function worldLabel(p: Project): string {
  const k = p.world.kind;
  if (k === '') return `the contest world of seed ${p.seed}`;
  if (k === 'mirror') return `a mirrored world (seed ${p.seed})`;
  if (k === 'custom') return 'a custom map (a file or a link)';
  if (/^fair\d+$/.test(k)) return `a fair world for ${k.slice(4)} colonies (seed ${p.seed})`;
  return `a ring example with ${k} colonies`;
}
