// What the workshop says about a brain's text while it is being edited, how rule firing and an ant's trace are shown, and
// where a program counter points back into the text.
import { brainFormat } from '../src/core/asm.ts';
import { CLASSIC } from '../src/core/rules.ts';
import { loadAnyBrain, looksLikeRules, looksLikeScript, ruleAt, scriptLineAt } from '../src/lang/index.ts';
import type { Compiled, ScriptCompiled } from '../src/lang/index.ts';
import type { Program, Rules } from '../src/core/types.ts';
import type { Fires, Trace } from './protocol.ts';

export interface RuleRef { id: number; mood: string; text: string; /** 1-based line of the rule in the editor text */ line: number }
export type BrainInfo =
  | {
    ok: true; kind: 'script' | 'rules' | 'asm' | 'ant'; summary: string; warnings: string[]; rules: RuleRef[];
    /** the text this info was made from, and its program (pc -> source line), so a pc can be pointed back at the text */
    text: string; program: Program; compiled?: Compiled; script?: ScriptCompiled;
  }
  | { ok: false; kind: 'script' | 'rules' | 'asm' | 'ant'; error: string };

export function describeBrain(text: string, rules: Rules = CLASSIC): BrainInfo {
  const kind = looksLikeScript(text) ? 'script' : looksLikeRules(text) ? 'rules' : brainFormat(text);
  try {
    const { program, compiled, script } = loadAnyBrain(text, rules);
    if (script) {
      return { ok: true, kind, text, program, script, rules: [], warnings: script.warnings,
        summary: `script: ${script.macros.length} macro${script.macros.length === 1 ? '' : 's'}, starts at "${script.entry}", ${script.instructions} instructions of 2000, ${program.n} states` };
    }
    if (compiled) {
      return { ok: true, kind, text, program, compiled, rules: compiled.rules.map((r) => ({ id: r.id, mood: r.mood, text: r.text, line: r.line })),
        warnings: compiled.warnings,
        summary: `rules: ${compiled.rules.length} rules in ${compiled.moods.length} mood${compiled.moods.length === 1 ? '' : 's'}, ${compiled.instructions} instructions of 2000, ${program.n} states` };
    }
    return { ok: true, kind, text, program, rules: [], warnings: [], summary: `${kind === 'asm' ? 'flat assembly' : 'official .ant'}: ${program.n} states` };
  } catch (e) {
    return { ok: false, kind, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The line a message points at ("line 3: ..."), or null. */
export const lineOfMessage = (msg: string): number | null => { const m = /^(?:warning: )?line (\d+):/.exec(msg); return m ? Number(m[1]) : null; };

export interface FireRow { label: string; test: number; act: number; /** rule id, or -1 for the glue row */ rule: number; line: number | null }

/** Shares (0..1) of all acting ant-rounds, one row per rule, plus a glue row when the kit routines' bookkeeping shows up. */
export function fireRows(rules: RuleRef[], f: Fires): FireRow[] {
  if (!f.total) return [];
  const rows: FireRow[] = rules.map((r, i) => ({ label: `${r.mood}: ${r.text}`, test: f.test[i] / f.total, act: f.act[i] / f.total, rule: r.id, line: r.line }));
  if (f.glue) rows.push({ label: '(glue)', test: 0, act: f.glue / f.total, rule: -1, line: null });
  return rows;
}

export interface Where { label: string; line: number | null; rule: number; part: 'test' | 'action' | 'glue' | '' }

/** What an ant at `pc` is about to run: for rules the rule and whether its test or its action; otherwise the source line. */
export function whereIs(info: BrainInfo, pc: number): Where {
  if (!info.ok) return { label: '(program has an error)', line: null, rule: -1, part: '' };
  if (info.compiled) {
    const m = ruleAt(info.compiled, pc);
    const r = info.rules.find((x) => x.id === m.rule);
    return r ? { label: `${r.mood}: ${r.text}`, line: r.line, rule: r.id, part: m.part } : { label: '(kit routine bookkeeping)', line: null, rule: -1, part: 'glue' };
  }
  const line = (info.script ? scriptLineAt(info.script, pc) : info.program.lines[pc]) || null;
  const src = line ? (info.text.split('\n')[line - 1] ?? '').replace(info.script ? /(\/\/|#).*$/ : /;.*$/, '').trim() : '';
  return { label: line ? `line ${line}: ${src}` : `state ${pc}`, line, rule: -1, part: '' };
}

export interface TraceRow extends Where { fromRound: number; toRound: number; count: number }

/** The newest `max` rows of a trace, newest first; consecutive rounds in the same rule part (or the same line) are one row. */
export function traceRows(info: BrainInfo, trace: Trace, max = 30): TraceRow[] {
  const rows: TraceRow[] = [];
  for (let i = 0; i < trace.length; i += 2) {
    const w = whereIs(info, trace[i + 1]), last = rows[rows.length - 1];
    const same = last && last.rule === w.rule && last.part === w.part && last.line === w.line && last.label === w.label;
    if (same) { last.toRound = trace[i]; last.count++; } else rows.push({ ...w, fromRound: trace[i], toRound: trace[i], count: 1 });
  }
  return rows.reverse().slice(0, max);
}
