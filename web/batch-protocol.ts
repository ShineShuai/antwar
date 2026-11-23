// Messages between the page and a batch Worker, which plays games (head to head, in the Evaluate panel).
import type { Outcome, Task } from '../src/core/match.ts';
import type { RulesId } from '../src/core/rules.ts';

/** What every game of a batch shares: the brains (by index, as `Task.a` and `Task.b` use them), the rules, the length, the kind of world. */
export interface BatchSetup { texts: string[]; rules: RulesId; rounds: number; symmetric: boolean }
export type BatchRequest = ({ type: 'init' } & BatchSetup) | { type: 'play'; i: number; task: Task };
export type BatchReply =
  | { type: 'ready' }
  | { type: 'played'; i: number; out: Outcome }
  /** `brain`: the index of the brain that does not compile, when it is one. */
  | { type: 'error'; message: string; brain?: number };
