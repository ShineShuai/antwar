// Replay layer: keyframes for seeking, the replay descriptor and its verification (docs/REPLAY.md).
// A replay is inputs plus hashes, never an event log. No clock, no I/O.
import { MAX_IMPORTED, makeProgram } from './asm.ts';
import { GENERATOR_VERSION, generateWorld } from './gen.ts';
import { OP } from './isa.ts';
import { parseMap } from './map.ts';
import { RULESETS } from './rules.ts';
import type { RulesId } from './rules.ts';
import { createSim, fnv1a } from './sim.ts';
import type { SimOptions } from './sim.ts';
import type { Instr, Program, Rules } from './types.ts';

/** State hash checkpoints, the cross-implementation proof (reference, RNG tab): 4 bytes each, stored in the descriptor. */
export const HASH_EVERY = 1000;
/** Full-state keyframes for seeking: a seek re-runs fewer than this many rounds. A multiple of HASH_EVERY. */
export const KEY_EVERY = 2000;
/** Longest descriptor this build will verify (10 matches). */
export const MAX_ROUNDS = 1_000_000;

/** A simulation that remembers its past: hash checkpoints and keyframes are taken the first time a round is reached. */
export function createReplay(opts: SimOptions) {
  const sim = createSim(opts);
  const first = sim.snapshot();
  const keys = new Map<number, Uint8Array>([[0, first]]); // round -> snapshot, every KEY_EVERY
  const sums = new Map<number, number>([[0, fnv1a(first)]]); // round -> state hash, every HASH_EVERY
  let frontier = 0; // furthest round simulated so far

  function advance(to: number): void {
    while (sim.cycle < to) {
      const next = Math.min(to, sim.cycle + HASH_EVERY - (sim.cycle % HASH_EVERY));
      sim.run(next - sim.cycle);
      const c = sim.cycle;
      if (c <= frontier) continue;
      frontier = c;
      if (c % HASH_EVERY === 0) {
        const s = sim.snapshot();
        sums.set(c, fnv1a(s));
        if (c % KEY_EVERY === 0) keys.set(c, s);
      }
    }
  }

  return {
    sim,
    get round(): number { return sim.cycle; },
    /** Furthest round simulated: seeking beyond it simulates, seeking within it restores. */
    get frontier(): number { return frontier; },
    /** Forward n rounds, recording. */
    run(n: number): void { advance(sim.cycle + n); },
    /** One round (for callers that observe every round). */
    step(): void { advance(sim.cycle + 1); },
    /** The state hash at a multiple of HASH_EVERY that has been reached, else undefined. */
    hashAt(round: number): number | undefined { return sums.get(round); },
    /**
     * Go to any round >= 0, backwards or forwards. Restores the nearest keyframe at or below the round (or keeps the
     * current state when it is already between that keyframe and the round) and re-runs fewer than KEY_EVERY rounds.
     * With `before`, the last leg always starts from the keyframe and `before()` runs ahead of each round of it:
     * the trace window then depends on the target round only.
     */
    seek(round: number, before?: () => void): void {
      if (!Number.isSafeInteger(round) || round < 0) throw new RangeError(`bad round ${round}`);
      const base = Math.min(round - (round % KEY_EVERY), frontier - (frontier % KEY_EVERY));
      if (before || sim.cycle < base || sim.cycle > round) sim.restore(keys.get(base) as Uint8Array);
      if (!before) { advance(round); return; }
      while (sim.cycle < round) { before(); advance(sim.cycle + 1); }
    },
  };
}
export type Replay = ReturnType<typeof createReplay>;

// ---- flat IR: what a descriptor carries for a brain --------------------------------------------------------------

/** Parallel arrays, one entry per instruction. goto does not exist here (the loaders resolve it). */
export interface FlatIr { op: number[]; a: number[]; b: number[]; t: number[]; e: number[] }

export const toFlat = (p: Program): FlatIr => ({ op: [...p.op], a: [...p.a], b: [...p.b], t: [...p.t], e: [...p.e] });

/** Canonical brain fingerprint: FNV-1a over u32 n, then per instruction u8 op, i32 a, i32 b, u16 t, u16 e (little-endian). */
export function brainHash(p: Program): number {
  const out = new Uint8Array(4 + p.n * 13), dv = new DataView(out.buffer);
  dv.setUint32(0, p.n, true);
  for (let i = 0, o = 4; i < p.n; i++, o += 13) {
    out[o] = p.op[i]; dv.setInt32(o + 1, p.a[i], true); dv.setInt32(o + 5, p.b[i], true);
    dv.setUint16(o + 9, p.t[i], true); dv.setUint16(o + 11, p.e[i], true);
  }
  return fnv1a(out);
}

export type Reason = 'invalid' | 'version' | 'rules' | 'generator' | 'brain' | 'hash';
export class ReplayError extends Error {
  reason: Reason;
  constructor(reason: Reason, message: string) { super(message); this.reason = reason; }
}
const bad = (message: string, reason: Reason = 'invalid'): never => { throw new ReplayError(reason, message); };
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, what: string): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : bad(`${what} must be an integer ${lo}..${hi}`);
const u32 = (v: unknown, what: string): number => num(v, 0, 0xffffffff, what);

const USES_ELSE = new Set([OP.SENSE, OP.SENSEANY, OP.MOVE, OP.PICKUP, OP.FLIP, OP.DIRECTION, OP.PAYLOAD]);
const popcount = (x: number): number => { let k = 0; for (let v = x; v; v &= v - 1) k++; return k; };

/** Validate untrusted IR against a ruleset and build the Program. Everything the loaders guarantee is re-checked here. */
export function fromFlat(raw: unknown, rules: Rules): Program {
  const ir = raw as Partial<Record<keyof FlatIr, unknown>> | null;
  if (typeof ir !== 'object' || ir === null) return bad('ir must be an object');
  const cols = (['op', 'a', 'b', 't', 'e'] as const).map((k) => (isArr(ir[k]) ? (ir[k] as unknown[]) : bad(`ir.${k} must be an array`)));
  const [op, a, b, t, e] = cols, n = op.length;
  if (n < 1 || n > MAX_IMPORTED) return bad(`a brain has 1..${MAX_IMPORTED} instructions`);
  if (cols.some((c) => c.length !== n)) return bad('ir columns differ in length');
  const list: Instr[] = [];
  for (let i = 0; i < n; i++) {
    const w = `instruction ${i}`, o = op[i];
    const I: Instr = { op: num(o, 0, OP.PAYLOAD, `${w}: op`), a: num(a[i], -0x80000000, 0x7fffffff, `${w}: a`),
      b: num(b[i], 0, 0x7fff, `${w}: b`), t: num(t[i], 0, n - 1, `${w}: t`), e: num(e[i], 0, n - 1, `${w}: e`) };
    const code = I.op;
    if (code === OP.GOTO) bad(`${w}: goto is not an IR instruction`);
    if ((code === OP.SENSEANY || code === OP.DIRECTION || code === OP.PAYLOAD) && !rules.ext) bad(`${w}: not in this ruleset`);
    if (!USES_ELSE.has(code) && I.e !== 0) bad(`${w}: unused else target must be 0`);
    if (code !== OP.SENSE && code !== OP.SENSEANY && I.b !== 0) bad(`${w}: unused b must be 0`);
    switch (code) {
      case OP.SENSE: case OP.SENSEANY:
        num(I.a, 0, 3, `${w}: sense direction`);
        if (code === OP.SENSE && !rules.ext && popcount(I.b as number) !== 1) bad(`${w}: sense takes one condition`);
        break;
      case OP.MARK: case OP.UNMARK: num(I.a, 0, 5, `${w}: marker`); break;
      case OP.TURN: num(I.a, 0, 1, `${w}: turn`); break;
      case OP.FLIP: num(I.a, 1, 0x7fffffff, `${w}: flip p`); break;
      case OP.DIRECTION: num(I.a, 0, 5, `${w}: direction`); break;
      case OP.PAYLOAD: num(I.a, 0, rules.cap, `${w}: payload`); break;
      default: if (I.a !== 0) bad(`${w}: unused a must be 0`); // move, pickup, drop
    }
    list.push(I);
  }
  return makeProgram(list);
}

// ---- the replay descriptor --------------------------------------------------------------------------------------

export interface BrainEntry { hash: number; ir: FlatIr; /** source text, informative only: never executed */ src?: string }
export interface Descriptor {
  v: 1;
  rules: RulesId;
  seed: number;
  /** absent = toroidal (the spec default) */
  wrap?: false;
  /** World file text; absent = generateWorld(seed) of generator version `gen`. */
  map?: string;
  gen?: number;
  /** One per colony. */
  brains: BrainEntry[];
  rounds: number;
  /** State hash after rounds HASH_EVERY, 2 * HASH_EVERY, ... up to `rounds`. */
  checkpoints: number[];
  /** State hash after `rounds`. */
  hash: number;
}

const MAX_MAP_TEXT = 1 << 17, MAX_SRC = 1 << 17;

/** Structural validation of an untrusted descriptor (JSON.parse output). Throws ReplayError. */
export function parseDescriptor(raw: unknown): Descriptor {
  const d = raw as Record<string, unknown> | null;
  if (typeof d !== 'object' || d === null || isArr(d)) return bad('a descriptor is a JSON object');
  if (d.v !== 1) return bad(`descriptor version ${String(d.v)}; this build reads 1`, 'version');
  if (typeof d.rules !== 'string' || !Object.hasOwn(RULESETS, d.rules)) return bad(`unknown ruleset ${String(d.rules)}`, 'rules');
  const out: Descriptor = { v: 1, rules: d.rules as RulesId, seed: u32(d.seed, 'seed'), brains: [], rounds: 0, checkpoints: [], hash: 0 };
  if (d.wrap !== undefined) { if (d.wrap !== false) return bad('wrap is false or absent'); out.wrap = false; }
  if (d.map !== undefined) {
    if (typeof d.map !== 'string' || d.map.length > MAX_MAP_TEXT) return bad('map must be world text under 128 KB');
    out.map = d.map;
  } else out.gen = num(d.gen, 0, 0xffff, 'gen (a descriptor without a map needs the generator version)');
  if (!isArr(d.brains) || d.brains.length < 1 || d.brains.length > 26) return bad('brains: 1..26 entries');
  out.brains = d.brains.map((x: unknown, i: number): BrainEntry => {
    const b = x as Record<string, unknown> | null;
    if (typeof b !== 'object' || b === null) return bad(`brain ${i} must be an object`);
    const e: BrainEntry = { hash: u32(b.hash, `brain ${i} hash`), ir: b.ir as FlatIr };
    if (b.src !== undefined) {
      if (typeof b.src !== 'string' || b.src.length > MAX_SRC) return bad(`brain ${i} src must be text under 128 KB`);
      e.src = b.src;
    }
    return e;
  });
  out.rounds = num(d.rounds, 0, MAX_ROUNDS, 'rounds');
  if (!isArr(d.checkpoints)) return bad('checkpoints must be an array');
  const k = d.checkpoints.length;
  if (k * HASH_EVERY > out.rounds || (k + 1) * HASH_EVERY <= out.rounds) bad(`checkpoints: expected one per ${HASH_EVERY} rounds up to ${out.rounds}`);
  out.checkpoints = d.checkpoints.map((h: unknown, i: number) => u32(h, `checkpoint ${i}`));
  out.hash = u32(d.hash, 'hash');
  return out;
}

export interface RecordOptions {
  rules: RulesId; seed: number; rounds: number; programs: Program[];
  /** World file text; absent = generated from the seed. */
  map?: string; wrap?: boolean; sources?: string[];
}

/** Run a match and write down its descriptor. */
export function record(o: RecordOptions): Descriptor {
  const rules = RULESETS[o.rules];
  const rp = createReplay({ map: o.map === undefined ? generateWorld(o.seed) : parseMap(o.map), programs: o.programs, seed: o.seed, rules, wrap: o.wrap !== false });
  rp.run(o.rounds);
  const checkpoints: number[] = [];
  for (let r = HASH_EVERY; r <= o.rounds; r += HASH_EVERY) checkpoints.push(rp.hashAt(r) as number);
  return parseDescriptor({
    v: 1, rules: o.rules, seed: o.seed, ...(o.wrap === false ? { wrap: false } : {}),
    ...(o.map === undefined ? { gen: GENERATOR_VERSION } : { map: o.map }),
    brains: o.programs.map((p, i) => ({ hash: brainHash(p), ir: toFlat(p), ...(o.sources?.[i] === undefined ? {} : { src: o.sources[i] }) })),
    rounds: o.rounds, checkpoints, hash: rp.sim.hash(),
  });
}

export type Verdict =
  | { ok: true; rounds: number; hash: number }
  /** `round`: for a hash mismatch, the first checkpoint that disagrees (the divergence is within HASH_EVERY rounds below it). */
  | { ok: false; reason: Reason; message: string; round?: number };

/** Re-run a descriptor and compare every checkpoint and the final hash. Never throws: a damaged or foreign descriptor is a verdict. */
export function verify(raw: unknown): Verdict {
  try {
    const d = parseDescriptor(raw), rules = RULESETS[d.rules];
    const programs = d.brains.map((b, i) => {
      const p = fromFlat(b.ir, rules);
      if (brainHash(p) !== b.hash) bad(`brain ${i}: its hash does not match its instructions`, 'brain');
      return p;
    });
    if (d.map === undefined && d.gen !== GENERATOR_VERSION) bad(`made with world generator ${d.gen}; this build has ${GENERATOR_VERSION}`, 'generator');
    const rp = createReplay({ map: d.map === undefined ? generateWorld(d.seed) : parseMap(d.map), programs, seed: d.seed, rules, wrap: d.wrap !== false });
    for (let k = 0; k < d.checkpoints.length; k++) {
      const round = (k + 1) * HASH_EVERY;
      rp.run(round - rp.round);
      if (rp.hashAt(round) !== d.checkpoints[k]) {
        return { ok: false, reason: 'hash', round, message: `state hash differs at round ${round} (diverged after round ${round - HASH_EVERY})` };
      }
    }
    rp.run(d.rounds - rp.round);
    const hash = rp.sim.hash();
    if (hash !== d.hash) return { ok: false, reason: 'hash', round: d.rounds, message: `final state hash differs at round ${d.rounds}` };
    return { ok: true, rounds: d.rounds, hash };
  } catch (e) {
    if (e instanceof ReplayError) return { ok: false, reason: e.reason, message: e.message };
    return { ok: false, reason: 'invalid', message: e instanceof Error ? e.message : String(e) };
  }
}
