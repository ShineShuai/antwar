// The project file: everything the workshop holds (the brains, the seed, the Rules, the map, the version histories) in one JSON file, to keep,
// to send, or to open on another machine. A share link carries one match; this carries the project. Pure: no DOM, no storage.
import { canonicalRules, RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { MAX_COLONIES } from '../src/core/types.ts';
import { clean, MAX_TEXT } from './versions.ts';
import type { Version } from './versions.ts';

export const PROJECT_FORMAT = 'antwar-project';
export const PROJECT_VERSION = 1;
/** The largest file read (characters), and the largest map text (the same as the saved project's). */
export const MAX_FILE = 8 << 20, MAX_MAP = 1 << 17, MAX_SEED = 0x3fffffff;
const KINDS = /^(|custom|mirror|fair\d+|\d+)$/;

/** `world.kind` is what the workshop's example-world picker calls the map ('' the contest generator's world of the seed, which has no `map`). */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT; version: typeof PROJECT_VERSION;
  seed: number; rules: RulesId;
  /** The world generator that made a map that is not stored (the contest world of a seed): another generator makes another map. */
  generator?: number;
  brains: string[];
  world: { kind: string; map: string };
  versions: Record<string, Version[]>;
}
export class ProjectFileError extends Error {}
const bad = (m: string): never => { throw new ProjectFileError(m); };

export interface ProjectState { brains: readonly string[]; seed: string | number; rules: string; worldKind: string; mapText: string; versions: Record<string, Version[]>; generator: number }

/** The file for the state of the workshop. Throws ProjectFileError for a state that could not be opened again. */
export function buildProjectFile(s: ProjectState): ProjectFile {
  const seed = Number(s.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED || String(s.seed).trim() === '') bad(`the seed must be a whole number from 0 to ${MAX_SEED}`);
  return validate({ format: PROJECT_FORMAT, version: PROJECT_VERSION, seed, rules: canonicalRules(s.rules as RulesId), ...(s.worldKind === '' ? { generator: s.generator } : {}),
    brains: [...s.brains], world: { kind: s.worldKind, map: s.mapText }, versions: s.versions });
}

/** The text of the file: JSON, two spaces (a brain's text is one string with \n in it). */
export const formatProjectFile = (f: ProjectFile): string => `${JSON.stringify(f, null, 2)}\n`;

/** Reads a project file. Unknown fields are ignored; anything wrong is a ProjectFileError that says what. */
export function parseProjectFile(text: string): ProjectFile {
  if (text.length > MAX_FILE) bad(`the file is over ${MAX_FILE >> 20} MiB`);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return bad('not JSON: this is not a project file'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('not a project file');
  const o = raw as Record<string, unknown>;
  if (o.format !== PROJECT_FORMAT) return bad('not an antwar project file');
  if (o.version !== PROJECT_VERSION) return bad(typeof o.version === 'number' && o.version > PROJECT_VERSION ? 'made by a newer version of antwar: update it to open this file' : 'unknown project file version');
  return validate(o);
}

function validate(o: Record<string, unknown>): ProjectFile {
  const { seed, rules, generator, brains, world, versions } = o;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) bad(`seed: a whole number from 0 to ${MAX_SEED}`);
  if (typeof rules !== 'string' || !Object.hasOwn(RULESETS, rules)) bad(`rules: one of ${Object.keys(RULESETS).join(', ')}`);
  if (!Array.isArray(brains) || brains.length < 2 || brains.length > MAX_COLONIES) bad(`brains: 2 to ${MAX_COLONIES} texts`);
  (brains as unknown[]).forEach((b, i) => { if (typeof b !== 'string') bad(`brain ${i + 1} is not text`); else if (b.length > MAX_TEXT) bad(`brain ${i + 1} is over ${MAX_TEXT} characters`); });
  const w = world as { kind?: unknown; map?: unknown } | null | undefined;
  if (typeof w?.kind !== 'string' || !KINDS.test(w.kind) || typeof w.map !== 'string') bad('world: a kind and a map text');
  const kind = (w as { kind: string }).kind, map = (w as { map: string }).map;
  if (map.length > MAX_MAP) bad(`the map is over ${MAX_MAP} characters`);
  if (kind === '' ? map !== '' : map === '') bad(kind === '' ? 'world: the contest generator has no map text' : `world: a "${kind}" world needs its map text`);
  if (generator !== undefined && (typeof generator !== 'number' || !Number.isInteger(generator))) bad('generator: a whole number');
  return {
    format: PROJECT_FORMAT, version: PROJECT_VERSION, seed: seed as number, rules: canonicalRules(rules as RulesId), ...(generator === undefined ? {} : { generator: generator as number }),
    brains: brains as string[], world: { kind, map }, versions: clean(versions ?? {}),
  };
}
