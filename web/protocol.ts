// Messages between the page and the simulation Worker.
import type { Frame } from '../src/core/types.ts';

/** Cumulative ant-rounds spent in each rule's test (the senses) and action, by rule id, since the last init. */
export interface Fires { test: number[]; act: number[]; glue: number; total: number }

export type Request =
  | { type: 'init'; seed: number; mapText?: string; rules?: 'classic'; brains: string[] }
  | { type: 'run'; n: number; /** count which rule each acting ant is in (rules brains only; slower) */ explain?: boolean }
  | { type: 'frame' };

export type Reply =
  | { type: 'ready'; W: number; H: number; rock: Uint8Array; hill: Int8Array }
  | ({ type: 'frame'; hash: number; /** per colony; null for brains that are not rules */ fires: (Fires | null)[] } & Frame)
  | { type: 'error'; message: string };
