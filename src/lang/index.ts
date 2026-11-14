// Rules compiler: source text -> flat assembly -> IR, with a source map (pc -> rule) and plain-English lint.
import { AsmError, assemble } from '../core/asm.ts';
import { CLASSIC } from '../core/rules.ts';
import type { Program, Rules } from '../core/types.ts';
import { lower } from './lower.ts';
import type { LineMeta } from './lower.ts';
import { RulesError, parseRules } from './parse.ts';
import type { Ast } from './parse.ts';

export { RulesError } from './parse.ts';
export type { LineMeta } from './lower.ts';

export interface RuleInfo { id: number; mood: string; line: number; text: string }
export interface Compiled {
  asm: string; program: Program; rules: RuleInfo[]; meta: LineMeta[]; warnings: string[];
  /** instruction lines of the flat assembly (the authoring limit counts these) */
  instructions: number; moods: string[];
}

export function compileRules(source: string, rules: Rules = CLASSIC): Compiled {
  const ast = parseRules(source);
  const { lines, meta } = lower(ast);
  const asm = `${lines.join('\n')}\n`;
  let program: Program;
  try {
    program = assemble(asm, rules);
  } catch (e) {
    if (!(e instanceof AsmError)) throw e;
    if (/goto cycle/.test(e.message)) throw new RulesError('some moods switch to each other without ever acting; give one of them a rule that does something');
    if (/more than/.test(e.message)) throw new RulesError(`the program is too big (${e.message}); use fewer kit actions or fewer moods`);
    throw new RulesError(`internal: the compiler produced bad assembly (${e.message})`);
  }
  const all = ast.moods.flatMap((m) => m.rules);
  return {
    asm, program, meta, warnings: lint(ast), moods: ast.moods.map((m) => m.name),
    rules: all.map((r) => ({ id: r.id, mood: r.mood, line: r.line, text: r.text })),
    instructions: lines.filter((l) => !l.trimStart().startsWith(';')).length,
  };
}

/** Which rule (and whether its test or its action) an ant at `pc` is executing; rule -1 = glue. */
export function ruleAt(c: Compiled, pc: number): LineMeta {
  return c.meta[c.program.lines[pc] - 1] ?? { rule: -1, part: 'glue' };
}

const FAILABLE = new Set(['move', 'pickup', 'step', 'returnhome', 'followtrail']);

/** Plain-English warnings: shadowed rules, unreachable moods, never grabs / never drops, scent written but never read. */
export function lint(ast: Ast): string[] {
  const out: string[] = [];
  const rules = ast.moods.flatMap((m) => m.rules);
  const targets = new Set(rules.flatMap((r) => r.actions.filter((a) => a.kind === 'switch').map((a) => a.arg as string)));
  ast.moods.forEach((m, i) => {
    if (i > 0 && !targets.has(m.name)) out.push(`line ${m.line}: mood "${m.name}" is never entered: no rule switches to it`);
    if (ast.moods.length > 1 && !m.rules.some((r) => r.actions.some((a) => a.kind === 'switch'))) {
      out.push(`line ${m.line}: mood "${m.name}" never switches to another mood, so an ant that enters it stays there`);
    }
    m.rules.forEach((r, j) => {
      const next = m.rules[j + 1];
      if (next && !r.conds.length && !r.actions.some((a) => FAILABLE.has(a.kind))) {
        out.push(`line ${next.line}: this rule can never run: the rule above it (line ${r.line}) always fires and cannot fail`);
      }
    });
    if (m.rules.some((r) => r.actions.some((a) => a.kind === 'returnhome')) && !m.rules.some((r) => r.conds.some((c) => c.sense === 'home'))) {
      out.push(`line ${m.line}: mood "${m.name}" returns home but never checks for the nest; add: when home here -> drop`);
    }
  });
  if (!rules.some((r) => r.actions.some((a) => a.kind === 'pickup'))) out.push('this program never picks up food');
  if (!rules.some((r) => r.actions.some((a) => a.kind === 'drop'))) out.push('this program never drops food, so nothing is ever delivered');
  const written = new Set<number>(), read = new Set<number>();
  for (const r of rules) {
    r.actions.forEach((a) => { if (a.kind === 'mark') written.add(a.arg as number); });
    r.conds.forEach((c) => { const k = /^marker (\d)$/.exec(c.sense); if (k) read.add(Number(k[1])); });
  }
  for (const k of written) if (!read.has(k)) out.push(`marker ${k} is written but no rule ever reads it`);
  for (const k of read) if (!written.has(k) && !(ast.kits.trail && k <= 2) && !(ast.kits.foodtrail && k === 3)) out.push(`marker ${k} is read but no rule ever writes it`);
  return out;
}
