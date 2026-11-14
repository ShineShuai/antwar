// What the workshop says about a brain's text while it is being edited, and how rule firing is shown.
import { brainFormat } from '../src/core/asm.ts';
import { CLASSIC } from '../src/core/rules.ts';
import { loadAnyBrain, looksLikeRules } from '../src/lang/index.ts';
import type { Rules } from '../src/core/types.ts';
import type { Fires } from './protocol.ts';

export type BrainInfo =
  | { ok: true; kind: 'rules' | 'asm' | 'ant'; summary: string; warnings: string[]; rules: { mood: string; text: string }[] }
  | { ok: false; kind: 'rules' | 'asm' | 'ant'; error: string };

export function describeBrain(text: string, rules: Rules = CLASSIC): BrainInfo {
  const kind = looksLikeRules(text) ? 'rules' : brainFormat(text);
  try {
    const { program, compiled } = loadAnyBrain(text, rules);
    if (compiled) {
      return { ok: true, kind, rules: compiled.rules.map((r) => ({ mood: r.mood, text: r.text })), warnings: compiled.warnings,
        summary: `rules: ${compiled.rules.length} rules in ${compiled.moods.length} mood${compiled.moods.length === 1 ? '' : 's'}, ${compiled.instructions} instructions of 2000, ${program.n} states` };
    }
    return { ok: true, kind, rules: [], warnings: [], summary: `${kind === 'asm' ? 'flat assembly' : 'official .ant'}: ${program.n} states` };
  } catch (e) {
    return { ok: false, kind, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface FireRow { label: string; test: number; act: number }

/** Shares (0..1) of all acting ant-rounds, one row per rule, plus a glue row when the kit routines' bookkeeping shows up. */
export function fireRows(rules: { mood: string; text: string }[], f: Fires): FireRow[] {
  if (!f.total) return [];
  const rows = rules.map((r, i) => ({ label: `${r.mood}: ${r.text}`, test: f.test[i] / f.total, act: f.act[i] / f.total }));
  if (f.glue) rows.push({ label: '(glue)', test: 0, act: f.glue / f.total });
  return rows;
}
