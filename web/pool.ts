// Plays a batch of games on several Workers. DOM-free: the page passes `make` (a module Worker), tests pass an in-process fake.
// Results do not depend on the number of workers: each game is a function of its task alone.
import type { Outcome, Task } from '../src/core/match.ts';
import type { LeagueTask } from '../src/league.ts';
import type { BatchReply, BatchRequest, BatchSetup, FairOut, FairTask } from './batch-protocol.ts';

export interface WorkerLike {
  onmessage: ((e: { data: BatchReply }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  postMessage(m: BatchRequest): void;
  terminate(): void;
}
export class Cancelled extends Error { constructor() { super('cancelled'); } }
/** A brain that does not compile (`brain` is its index) or another failure of a worker. */
export class BatchError extends Error {
  brain: number | undefined;
  constructor(message: string, brain?: number) { super(message); this.brain = brain; }
}
export interface Batch<O = Outcome> {
  /** The outcomes, in the order of the tasks; rejects with `Cancelled` after `cancel()`, or with `BatchError`. */
  done: Promise<O[]>;
  cancel(): void;
}
type Head = Extract<BatchSetup, { kind: 'head' }>;
type Fair = Extract<BatchSetup, { kind: 'fair' }>;
type League = Extract<BatchSetup, { kind: 'league' }>;

export function runBatch(make: () => WorkerLike, size: number, setup: Head, tasks: readonly Task[], onProgress?: (done: number) => void): Batch<Outcome>;
export function runBatch(make: () => WorkerLike, size: number, setup: Fair, tasks: readonly FairTask[], onProgress?: (done: number) => void): Batch<FairOut>;
export function runBatch(make: () => WorkerLike, size: number, setup: League, tasks: readonly LeagueTask[], onProgress?: (done: number) => void): Batch<FairOut>;
export function runBatch(make: () => WorkerLike, size: number, setup: BatchSetup, tasks: readonly (Task | FairTask | LeagueTask)[], onProgress?: (done: number) => void): Batch<Outcome | FairOut> {
  const outs = new Array<Outcome | FairOut>(tasks.length), workers: WorkerLike[] = [];
  let settled = false, next = 0, finished = 0, fail: (e: Error) => void = () => {};
  const stop = (): void => { settled = true; for (const w of workers) w.terminate(); };
  const done = new Promise<(Outcome | FairOut)[]>((resolve, reject) => {
    fail = (e) => { if (!settled) { stop(); reject(e); } };
    if (tasks.length === 0) { settled = true; resolve(outs); return; }
    const feed = (w: WorkerLike): void => { if (next < tasks.length) { const i = next++; w.postMessage({ type: 'play', i, task: tasks[i] }); } };
    for (let k = 0; k < Math.max(1, Math.min(size, tasks.length)); k++) {
      const w = make();
      workers.push(w);
      w.onmessage = ({ data }) => {
        if (settled) return;
        if (data.type === 'error') fail(new BatchError(data.message, data.brain));
        else if (data.type === 'ready') feed(w);
        else {
          outs[data.i] = data.out;
          finished++; // (not inside the optional call: without a progress callback the argument would not be evaluated)
          onProgress?.(finished);
          if (finished === tasks.length) { stop(); resolve(outs); } else feed(w);
        }
      };
      w.onerror = (e) => fail(new BatchError(e.message ?? 'worker failed'));
      w.postMessage({ type: 'init', setup });
    }
  });
  return { done, cancel: () => fail(new Cancelled()) };
}
