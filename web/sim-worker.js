// Module Worker: all simulation work happens here so the page never blocks.
import { createEngine } from './engine.js';

const engine = createEngine();
self.onmessage = ({ data }) => {
  const { msg, transfer } = engine.handle(data);
  self.postMessage(msg, transfer);
};
