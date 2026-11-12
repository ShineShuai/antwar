// Shared types. Cell and AntId are both numbers at runtime; the brands make tsc reject mixing them.
export type Cell = number & { readonly __cell: unique symbol };
export type Dir = number & { readonly __dir: unique symbol };
export type AntId = number & { readonly __ant: unique symbol };

export interface Rules {
  /** Food an ant can carry (Classic 1). */
  readonly cap: number;
  /** direction / payload / senseany / senseall instructions allowed (Classic: no). */
  readonly ext: boolean;
  /** Enemy neighbours at which an ant drops its food and survives; 0 = no scare rule (Classic). */
  readonly scareThreshold: number;
  /** A blocked move with two packets drops one on the current cell (Classic: no). */
  readonly dropOnBlocked: boolean;
  /** Most colonies a match may have (Classic 2). */
  readonly maxColonies: number;
  /** Alternate which colony acts first each round (Classic: ascending id). */
  readonly altOrder: boolean;
}

export interface Instr { op: number; a?: number; b?: number; t?: number; e?: number; /** source line, for source maps */ line?: number }

/** Program IR: every instruction has a success target `t` and an else target `e`. */
export interface Program {
  readonly n: number;
  readonly op: Uint8Array;
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly t: Uint16Array;
  readonly e: Uint16Array;
  /** Source line of each instruction (assembly line or .ant state line + 1), for explain-why. */
  readonly lines: Int32Array;
}

export interface WorldMap {
  W: number;
  H: number;
  rock: Uint8Array;
  food: Uint16Array;
  /** Colony owning the cell as anthill, or -1. */
  hill: Int8Array;
}

/** Ints per living ant in Frame.ants: [id, cell, colony, dir, carried, state]. */
export const ANT_STRIDE = 6;

/** Render data for one round. */
export interface Frame {
  cycle: number;
  food: Uint16Array;
  /** Scent bitmasks, colony * cells + cell; bit k = marker k. */
  marks: Uint8Array;
  ants: Int32Array;
  score: number[];
  alive: number[];
}
