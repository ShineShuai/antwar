// Messages between the page and the simulation Worker.
import type { Frame } from '../src/core/types.ts';

/** Cumulative ant-rounds spent in each rule's test (the senses) and action, by rule id, since the last init. */
export interface Fires { test: number[]; act: number[]; glue: number; total: number }

/** The tracked ant's recent acting rounds: [round, pc] pairs, oldest first (flat). */
export type Trace = number[];

export type Request =
  | { type: 'init'; seed: number; mapText?: string; rules?: 'classic'; brains: string[] }
  | { type: 'track'; /** ant id from the frame, or null to stop */ ant: number | null }
  | { type: 'run'; n: number; /** count which rule each acting ant is in (rules brains only; slower) */ explain?: boolean }
  | { type: 'frame' };

export type Reply =
  | { type: 'ready'; W: number; H: number; rock: Uint8Array; hill: Int8Array }
  | ({ type: 'frame'; hash: number; /** per colony; null for brains that are not rules */ fires: (Fires | null)[]; /** pairs of the tracked ant, empty when none */ trace: Trace } & Frame)
  | { type: 'error'; message: string };
