// Messages between the page and a batch Worker, which plays games for the Evaluate panel: two brains on many worlds ('head'), or one brain
// in every colony of a world ('fair').
import type { Outcome, Task } from '../src/core/match.ts';
import type { RulesId } from '../src/core/rules.ts';
import type { WorldSpec } from '../src/fairness.ts';

/** What every game of a batch shares. 'head': the brains (by index, as `Task.a` and `Task.b` use them), the rules, the length, the kind of world. */
export type BatchSetup =
  | { kind: 'head'; texts: string[]; rules: RulesId; rounds: number; symmetric: boolean }
  | { kind: 'fair'; text: string; rules: RulesId; rounds: number; world: WorldSpec };
/** A fairness game is its seed: the world (unless fixed) and the simulator RNG both come from it. */
export interface FairTask { seed: number }
/** The nest food of each colony. */
export interface FairOut { food: number[] }
export type BatchRequest = { type: 'init'; setup: BatchSetup } | { type: 'play'; i: number; task: Task | FairTask };
export type BatchReply =
  | { type: 'ready' }
  | { type: 'played'; i: number; out: Outcome | FairOut }
  /** `brain`: the index of the brain that does not compile, when it is one. */
  | { type: 'error'; message: string; brain?: number };
