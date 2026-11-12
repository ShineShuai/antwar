// Messages between the page and the simulation Worker.
import type { Frame } from '../src/core/types.ts';

export type Request =
  | { type: 'init'; seed: number; mapText?: string; rules?: 'classic'; brains: string[] }
  | { type: 'run'; n: number }
  | { type: 'frame' };

export type Reply =
  | { type: 'ready'; W: number; H: number; rock: Uint8Array; hill: Int8Array }
  | ({ type: 'frame'; hash: number } & Frame)
  | { type: 'error'; message: string };
