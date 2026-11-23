// Module Worker that plays the games of a batch (web/batch-engine.ts), so the page never blocks.
import { createBatchEngine } from './batch-engine.ts';
import type { BatchReply, BatchRequest } from './batch-protocol.ts';

interface WorkerScope {
  onmessage: ((e: MessageEvent<BatchRequest>) => void) | null;
  postMessage(msg: BatchReply): void;
}
const scope = self as unknown as WorkerScope;
const engine = createBatchEngine();
scope.onmessage = ({ data }) => scope.postMessage(engine.handle(data));
