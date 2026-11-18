// The official ICFP 2004 dump format (task section 2.13): exporter, reader, comparator. Pure strings, no I/O.
//
//   random seed: 12345
//   <blank>
//   After round N...
//   cell (x, y): <rock | [F food; ][red|black hill; ][red marks: 024; ][black marks: 5; ][ant]>
//   ...                                   one line per cell, row-major; ant = "red ant of id I, dir D, food F, state S, resting R"
//   <blank> After round N+1... (and so on)
//
// Round 0 is the initial state; round 1 is the first executed round. Ids are global and row-major. Colony 0 = red ('+').
import { createSim } from './sim.ts';
import type { Sim, SimOptions } from './sim.ts';
import type { WorldMap } from './types.ts';

const NAME = ['red', 'black'];

export class TraceError extends Error {}

/** One line per cell for the current round of `sim`. Two colonies at most (the format only knows red and black). */
export function frameLines(sim: Sim, map: WorldMap): string[] {
  const { W, H } = map, N = W * H;
  if (sim.marks.length > 2 * N) throw new TraceError('the dump format has two colours: at most two colonies');
  const at = new Map<number, number>();
  for (let i = 0; i < sim.ants; i++) {
    const a = sim.ant(i);
    if (a.alive) at.set(a.pos, i);
  }
  const out: string[] = [];
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      let s = `cell (${x}, ${y}): `;
      if (map.rock[p]) { out.push(`${s}rock`); continue; }
      if (sim.food[p]) s += `${sim.food[p]} food; `;
      if (map.hill[p] >= 0) s += `${NAME[map.hill[p]]} hill; `;
      for (let c = 0; c < 2; c++) {
        const bits = sim.marks[c * N + p] ?? 0;
        let m = '';
        for (let k = 0; k < 6; k++) if ((bits >> k) & 1) m += k;
        if (m) s += `${NAME[c]} marks: ${m}; `;
      }
      const id = at.get(p);
      if (id !== undefined) {
        const a = sim.ant(id);
        s += `${NAME[a.col]} ant of id ${id}, dir ${a.dir}, food ${a.has}, state ${a.pc}, resting ${a.rest}`;
      }
      out.push(s);
    }
  }
  return out;
}

/** Text chunks of a dump covering rounds `from`..`to`: the seed line first, then one chunk per round (each starts with a blank line). */
export function* dumpChunks(opts: SimOptions, from: number, to: number): Generator<string> {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) throw new TraceError(`bad round range ${from}..${to}`);
  const sim = createSim(opts);
  yield `random seed: ${opts.seed ?? 12345}\n`;
  sim.run(from);
  for (;;) {
    yield `\nAfter round ${sim.cycle}...\n${frameLines(sim, opts.map).join('\n')}\n`;
    if (sim.cycle >= to) return;
    sim.step();
  }
}

export interface DumpFrame { round: number; lines: string[] }
export interface Dump { seed: number; frames: DumpFrame[] }

/** Reads one dump file (LF or CRLF). Frames keep their cell lines verbatim; only the framing is validated. */
export function parseDump(text: string): Dump {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines[lines.length - 1] === '') lines.pop();
  const head = /^random seed: (\d+)$/.exec(lines[0] ?? '');
  if (!head) throw new TraceError('line 1: expected "random seed: N"');
  const frames: DumpFrame[] = [];
  let cur: DumpFrame | undefined;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (l === '') {
      const m = /^After round (\d+)\.\.\.$/.exec(lines[i + 1] ?? '');
      if (!m) throw new TraceError(`line ${i + 2}: expected "After round N..." after a blank line`);
      cur = { round: Number(m[1]), lines: [] };
      frames.push(cur);
      i++;
    } else if (cur && l.startsWith('cell (')) cur.lines.push(l);
    else throw new TraceError(`line ${i + 1}: unexpected "${l.slice(0, 40)}"`);
  }
  return { seed: Number(head[1]), frames };
}

/** Joins chunk files (they share their boundary round): one seed, rounds ascending and unique; overlapping frames must agree. */
export function mergeDumps(dumps: readonly Dump[]): Dump {
  if (!dumps.length) throw new TraceError('no dumps to merge');
  const byRound = new Map<number, string[]>();
  for (const d of dumps) {
    if (d.seed !== dumps[0].seed) throw new TraceError(`seeds differ: ${dumps[0].seed} and ${d.seed}`);
    for (const f of d.frames) {
      const old = byRound.get(f.round);
      if (old === undefined) byRound.set(f.round, f.lines);
      else if (firstDiff(old, f.lines)) throw new TraceError(`round ${f.round} differs between two files`);
    }
  }
  const frames = [...byRound].sort((p, q) => p[0] - q[0]).map(([round, lines]) => ({ round, lines }));
  return { seed: dumps[0].seed, frames };
}

export interface LineDiff { index: number; expected: string; actual: string }
/** First line (0-based) where two frames differ, a missing line counting as the empty string. */
export function firstDiff(expected: readonly string[], actual: readonly string[]): LineDiff | undefined {
  const n = Math.max(expected.length, actual.length);
  for (let index = 0; index < n; index++) {
    if (expected[index] !== actual[index]) return { index, expected: expected[index] ?? '', actual: actual[index] ?? '' };
  }
  return undefined;
}

export type TraceVerdict =
  | { ok: true; frames: number; rounds: number }
  | ({ ok: false; round: number } & LineDiff);

/** Runs `opts` (seed from the dump) to every frame of `dump` in turn and compares the whole state text. Stops at the first difference. */
export function compareDump(dump: Dump, opts: Omit<SimOptions, 'seed'>): TraceVerdict {
  const sim = createSim({ ...opts, seed: dump.seed });
  let last = 0;
  for (const f of dump.frames) {
    if (f.round < sim.cycle) throw new TraceError(`frames out of order at round ${f.round} (merge chunk files first)`);
    sim.run(f.round - sim.cycle);
    const d = firstDiff(f.lines, frameLines(sim, opts.map));
    if (d) return { ok: false, round: f.round, ...d };
    last = f.round;
  }
  return { ok: true, frames: dump.frames.length, rounds: last };
}
