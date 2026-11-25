// The replay loop of a viewer, without the DOM: one Worker running the replay engine (web/engine.ts), at most one request in flight, the
// newest seek and track request queued behind it, a pump that runs the match at `speed` rounds a frame. The workshop and the Arena's game
// viewer both draw on top of it (the viewer, status line, timeline and inspector stay with the page), and Node tests drive it with the engine in-process.
import type { Reply, Request } from './protocol.ts';

export type Ready = Extract<Reply, { type: 'ready' }>;
export type Frame = Extract<Reply, { type: 'frame' }>;
export type InitRequest = Extract<Request, { type: 'init' }>;

export interface ReplayWorker {
  onmessage: ((e: { data: Reply }) => void) | null;
  postMessage(m: Request): void;
  terminate(): void;
}

export interface ReplayHooks {
  /** The engine is ready (the world is known): size the canvas and make the viewer. Called before the first frame is asked for. */
  ready(m: Ready): void;
  /** A frame arrived and is now `last`: draw it. */
  frame(f: Frame): void;
  /** The engine refused (a brain that does not compile, a bad map). Playing has stopped. */
  error(message: string): void;
  /** Playing started or stopped (for the button). */
  running(on: boolean): void;
}

export interface ReplayOptions {
  makeWorker: () => ReplayWorker;
  /** Rounds per frame while playing. */
  speed: () => number;
  /** Ask the engine for rule counts and traces (the workshop's explain box). */
  explain?: () => boolean;
  /** Runs `cb` before the next frame is drawn; requestAnimationFrame in a page. */
  schedule?: (cb: () => void) => void;
}

export interface ReplayController {
  /** Start a new replay of `init` (the old one is stopped): paused at round 0, or at `startAt`. `rounds` is the length of the match. */
  load(init: InitRequest, o: { rounds: number; startAt?: number }): void;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Pause and run exactly one round. */
  step(): void;
  /** Pause and jump to a round (clamped to the match); a request in flight is finished first, and only the newest queued seek is made. */
  seek(round: number): void;
  /** Follow an ant (its id), or none (null): the engine returns its trace with the frames. */
  track(ant: number | null): void;
  /** Stop and let go of the Worker. */
  destroy(): void;
  readonly cycle: number;
  readonly running: boolean;
  readonly last: Frame | undefined;
}

export function createReplayController(o: ReplayOptions, hooks: ReplayHooks): ReplayController {
  const schedule = o.schedule ?? ((cb: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : void setTimeout(cb, 0)));
  let worker: ReplayWorker | undefined, generation = 0;
  let rounds = 0, startAt = 0, cycle = 0, running = false, busy = false, last: Frame | undefined;
  let wantSeek: number | undefined, wantTrack: number | null | undefined;

  const send = (m: Request): void => { busy = true; worker?.postMessage(m); };
  const setRunning = (on: boolean): void => { if (running === on || (on && !worker)) return; running = on; hooks.running(on); if (on) pump(); }; // (nothing to play without a replay)
  function pump(): void {
    if (!running || busy || !worker) return;
    send({ type: 'run', n: Math.min(Math.max(1, Math.trunc(o.speed())), rounds - cycle), explain: o.explain?.() ?? false });
  }
  function onMessage(m: Reply): void {
    if (m.type === 'error') { busy = false; wantSeek = undefined; wantTrack = undefined; setRunning(false); hooks.error(m.message); return; }
    if (m.type === 'ready') {
      hooks.ready(m);
      const r = wantSeek ?? startAt; wantSeek = undefined;
      send(r > 0 ? { type: 'seek', round: Math.min(r, rounds) } : { type: 'frame' });
      return;
    }
    busy = false; cycle = m.cycle; last = m;
    hooks.frame(m);
    if (wantTrack !== undefined) { const t = wantTrack; wantTrack = undefined; send({ type: 'track', ant: t }); return; }
    if (wantSeek !== undefined) { const r = wantSeek; wantSeek = undefined; send({ type: 'seek', round: r }); return; }
    if (cycle >= rounds) setRunning(false); else if (running) schedule(pump);
  }

  return {
    load(init, opts) {
      worker?.terminate();
      const mine = ++generation;
      rounds = Math.max(0, Math.trunc(opts.rounds)); startAt = Math.max(0, Math.trunc(opts.startAt ?? 0));
      cycle = 0; last = undefined; busy = false; wantSeek = undefined; wantTrack = undefined;
      setRunning(false);
      worker = o.makeWorker();
      worker.onmessage = (e) => { if (mine === generation) onMessage(e.data); }; // (a Worker we have let go of may still have a message on its way)
      send(init);
    },
    play() { setRunning(true); },
    pause() { setRunning(false); },
    toggle() { setRunning(!running); },
    step() { setRunning(false); if (!busy && worker) send({ type: 'run', n: 1, explain: o.explain?.() ?? false }); },
    seek(round) {
      const r = Math.max(0, Math.min(rounds, Math.trunc(round)));
      setRunning(false);
      if (busy) wantSeek = r; else if (worker) send({ type: 'seek', round: r });
    },
    track(ant) { if (busy) wantTrack = ant; else if (worker) send({ type: 'track', ant }); },
    destroy() { generation++; worker?.terminate(); worker = undefined; busy = false; wantSeek = undefined; wantTrack = undefined; setRunning(false); },
    get cycle() { return cycle; },
    get running() { return running; },
    get last() { return last; },
  };
}
