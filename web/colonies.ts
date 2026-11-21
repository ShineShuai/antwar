// More than two colonies in the workshop: labels, colours, the status line, the ruleset a map needs, bundled example worlds.
// Pure functions (no DOM): test/colonies.test.ts.
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { DARK, LIGHT } from './viewer.ts';
import type { Palette } from './viewer.ts';

export const MAX_COLONIES = 26;
export const letter = (c: number): string => String.fromCharCode(65 + c);
const NAMES = ['red', 'blue', 'green', 'amber', 'violet', 'teal', 'pink', 'brown'];
export const colonyName = (c: number): string => NAMES[c] ?? `colony ${letter(c)}`;
const HUES = [0, 220, 140, 40, 280, 175, 325, 25];
const hueOf = (c: number): number => HUES[c] ?? (c * 47) % 360;

/** Colonies a map has: the highest hill letter, and never fewer than two (the workshop always shows A and B). */
export function colonyCount(hill: ArrayLike<number>): number {
  let n = 2;
  for (let i = 0; i < hill.length; i++) if (hill[i] + 1 > n) n = hill[i] + 1;
  return n;
}

/** The ruleset to play n colonies under: the chosen one when it allows that many, else the plain many-colonies ruleset. */
export const rulesFor = (id: RulesId, n: number): RulesId => (n <= RULESETS[id].maxColonies ? id : 'colonies');

/** Exactly n brain texts: the ones given, then `fill` for each missing one. */
export const padBrains = (brains: readonly string[], n: number, fill: string): string[] => Array.from({ length: n }, (_, c) => brains[c] ?? fill);

/** The contest palette for A and B, and one distinct hue for each colony after them. */
export function paletteFor(n: number, dark: boolean): Palette {
  const base = dark ? DARK : LIGHT;
  const hill = [...base.hill], ant = [...base.ant], mark = [...base.mark];
  for (let c = 2; c < n; c++) {
    const h = hueOf(c);
    hill.push(dark ? `hsl(${h} 55% 25%)` : `hsl(${h} 90% 88%)`);
    ant.push(dark ? `hsl(${h} 80% 62%)` : `hsl(${h} 70% 40%)`);
    mark.push(dark ? `hsl(${h} 80% 78%)` : `hsl(${h} 70% 22%)`);
  }
  return { ...base, hill, ant, mark };
}

/** The line under the board. Two colonies keep the contest wording; more have no ranking rule, so it says who has the most food. */
export function statusLine(cycle: number, score: readonly number[], alive: readonly number[], match: number): string {
  let t = `Round ${cycle} | ${score.map((s, c) => `${letter(c)} ${s} (${alive[c]} ants)`).join(' | ')}`;
  if (cycle < match) return t;
  if (score.length === 2) return `${t} | ${score[0] === score[1] ? 'draw' : score[0] > score[1] ? 'A wins' : 'B wins'}`;
  const top = Math.max(...score), lead = score.flatMap((s, c) => (s === top ? [letter(c)] : []));
  t += lead.length === 1 ? ` | most food: ${lead[0]}` : ` | tied for most food: ${lead.join(', ')}`;
  return t;
}

/** A world for 2 to 26 colonies, as `.world` text: rock border, one hill per colony on a ring, food between the hills, a clump of
 * rock between each pair, and food in the middle. The colonies start alike (hills of 23 to 27 cells), but the ring is drawn on hexes,
 * so it is similar, not exactly symmetric: not a fair-match generator (`generateFairWorld`, src/core/gen.ts, is; docs/MATCH.md). */
export function exampleWorld(n: number): string {
  if (!Number.isInteger(n) || n < 2 || n > MAX_COLONIES) throw new RangeError(`colonies must be 2 to ${MAX_COLONIES}`);
  const S = Math.min(198, 28 + 4 * n + (n > 8 ? 4 * n : 0)), cx = (S - 1) / 2, cy = (S - 1) / 2, R = S * 0.32;
  const cells: string[] = Array.from({ length: S * S }, () => '.');
  const at = (x: number, y: number): number => y * S + x;
  const near = (x: number, y: number, px: number, py: number, r: number): boolean => {
    // pointy-top hexes with odd rows shifted right: convert to plane coordinates before measuring a distance
    const ax = x + (y & 1 ? 0.5 : 0), ay = y * 0.866, bx = px + (Math.round(py) & 1 ? 0.5 : 0), by = py * 0.866;
    return (ax - bx) ** 2 + (ay - by) ** 2 <= r * r;
  };
  const put = (px: number, py: number, r: number, ch: string, only?: string): void => {
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) if (near(x, y, px, py, r) && (only === undefined || cells[at(x, y)] === only)) cells[at(x, y)] = ch;
  };
  for (let c = 0; c < n; c++) {
    const a = (2 * Math.PI * c) / n - Math.PI / 2, b = a + Math.PI / n;
    put(cx + R * Math.cos(a), cy + R * Math.sin(a) / 0.866, 2.6, String.fromCharCode(97 + c));
    put(cx + 0.55 * R * Math.cos(b), cy + 0.55 * R * Math.sin(b) / 0.866, 1.2, '#');
    put(cx + 1.15 * R * Math.cos(b), cy + 1.15 * R * Math.sin(b) / 0.866, 1.6, '5', '.');
    put(cx + 0.45 * R * Math.cos(a), cy + 0.45 * R * Math.sin(a) / 0.866, 1.4, '3', '.');
  }
  put(cx, cy, 2.2, '9', '.');
  for (let i = 0; i < S; i++) { cells[at(i, 0)] = cells[at(i, S - 1)] = cells[at(0, i)] = cells[at(S - 1, i)] = '#'; }
  const rows = Array.from({ length: S }, (_, y) => (y & 1 ? ' ' : '') + cells.slice(y * S, y * S + S).join(' '));
  return `${S}\n${S}\n${rows.join('\n')}\n`;
}
