// Module Worker: all simulation work happens here so the page never blocks.
import { createEngine } from './engine.ts';
import type { Reply, Request } from './protocol.ts';

interface WorkerScope {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(msg: Reply, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;
const engine = createEngine();
scope.onmessage = ({ data }) => {
  const { msg, transfer } = engine.handle(data);
  scope.postMessage(msg, transfer);
};
