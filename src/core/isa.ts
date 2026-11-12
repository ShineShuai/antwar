// The instruction set in one place: opcodes, condition ids and the flat-assembly table.
// To add an instruction: add an opcode and a FLAT_OPS row here, parse its arguments in asm.ts, execute it in
// sim.ts and testlib/ref.py, then add micro-tests (see docs/EXTENDING.md).
export const OP = {
  SENSE: 0, SENSEANY: 1, MARK: 2, UNMARK: 3, MOVE: 4, PICKUP: 5,
  DROP: 6, TURN: 7, FLIP: 8, GOTO: 9, DIRECTION: 10, PAYLOAD: 11,
};
/** Condition ids; marker k is 6 + k. */
export const COND: Record<string, number> = {
  friend: 0, foe: 1, friendwithfood: 2, foewithfood: 3, food: 4, rock: 5,
  marker: 6, foemarker: 12, home: 13, foehome: 14,
};

export interface FlatOp {
  name: string;
  op: number;
  /** Written `... else <target>`; success falls through to the next instruction. */
  hasElse: boolean;
  /** Token count (name included) when there is no else part. */
  arity: number;
  /** Only allowed when the ruleset enables extended sensing. */
  ext: boolean;
}
export const FLAT_OPS: readonly FlatOp[] = [
  { name: 'sense', op: OP.SENSE, hasElse: true, arity: 0, ext: false },
  { name: 'senseany', op: OP.SENSEANY, hasElse: true, arity: 0, ext: true },
  { name: 'senseall', op: OP.SENSE, hasElse: true, arity: 0, ext: true },
  { name: 'mark', op: OP.MARK, hasElse: false, arity: 2, ext: false },
  { name: 'unmark', op: OP.UNMARK, hasElse: false, arity: 2, ext: false },
  { name: 'move', op: OP.MOVE, hasElse: true, arity: 0, ext: false },
  { name: 'pickup', op: OP.PICKUP, hasElse: true, arity: 0, ext: false },
  { name: 'drop', op: OP.DROP, hasElse: false, arity: 1, ext: false },
  { name: 'turn', op: OP.TURN, hasElse: false, arity: 2, ext: false },
  { name: 'flipzero', op: OP.FLIP, hasElse: true, arity: 0, ext: false },
  { name: 'goto', op: OP.GOTO, hasElse: false, arity: 2, ext: false },
  { name: 'direction', op: OP.DIRECTION, hasElse: true, arity: 0, ext: true },
  { name: 'payload', op: OP.PAYLOAD, hasElse: true, arity: 0, ext: true },
];
export const FLAT_BY_NAME: ReadonlyMap<string, FlatOp> = new Map(FLAT_OPS.map((f) => [f.name, f]));
