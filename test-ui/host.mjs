// A page of the site in jsdom, for test-ui/*.test.mjs (devDependencies: esbuild, jsdom). The page's module is bundled by esbuild and run in a
// window whose Workers are fakes that answer from the real engines (web/engine.ts, web/batch-engine.ts); canvases and matchMedia are stubs.
// This is not a browser: layout is zero-sized, nothing is painted. docs/UITEST.md lists what that leaves to a look in a real browser.
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundles = new Map();
const bundle = async (page) => {
  if (!bundles.has(page)) {
    const out = await build({ entryPoints: [`${root}web/${page}.ts`], bundle: true, format: 'esm', write: false, target: 'es2022', logLevel: 'error',
      define: { 'import.meta.url': `"file:///app/web/${page}.js"` } });
    bundles.set(page, `(async () => {${out.outputFiles[0].text}})().catch((e) => { window.__err = String((e && e.stack) || e); });`);
  }
  return bundles.get(page);
};
export const load = (file) => import(`${root}${file}`);
export const sleep = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Opens `page` ('workshop', 'arena' or 'maps'). `storage`: localStorage entries to set before the page runs (values are JSON-stringified unless
 * strings); `hash`: the location's #fragment; `canvasOps`: counts canvas calls in `win.__ops`. Returns the window and small helpers. */
export async function openPage(page, { storage = {}, hash = '', timeout = 30000 } = {}) {
  const html = readFileSync(`${root}web/${page}.html`, 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const vc = new VirtualConsole(); // (a page that sets location.href is "not implemented" in jsdom: not an error here)
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) console.error(e); });
  vc.on('error', (...a) => console.error(...a));
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `http://localhost/${hash}`, pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const { createEngine } = await load('web/engine.ts'), { createBatchEngine } = await load('web/batch-engine.ts');
  w.__workers = []; w.__sent = []; w.__ops = 0;
  w.Worker = class {
    constructor(url) {
      this.kind = String(url).includes('batch-worker') ? 'batch' : 'sim'; this.sent = [];
      this.engine = this.kind === 'batch' ? createBatchEngine() : createEngine();
      w.__workers.push(this);
    }
    postMessage(m) {
      this.sent.push(m); w.__sent.push(m);
      const r = this.engine.handle(m), msg = this.kind === 'batch' ? r : r.msg;
      if (msg.type === 'frame') w.__lastFrame = msg;
      setTimeout(() => { if (!this.dead) this.onmessage?.({ data: msg }); }, 0);
    }
    terminate() { this.dead = true; }
  };
  w.matchMedia = () => ({ matches: false });
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, k) => (k === 'canvas' ? null : () => { w.__ops++; }), set: () => true });
  w.crypto.getRandomValues ??= (a) => { for (let i = 0; i < a.length; i++) a[i] = 12345; return a; };
  for (const k of ['CompressionStream', 'DecompressionStream', 'Blob', 'Response', 'TextEncoder', 'TextDecoder', 'ReadableStream']) w[k] = globalThis[k];
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { w.__copied = t; } }, configurable: true });
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  w.eval(await bundle(page));
  await sleep(60);
  if (w.__err) throw new Error(`page ${page} failed to load: ${w.__err}`);
  const $ = (id) => w.document.getElementById(id);
  return {
    w, $, root,
    fire: (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true })),
    set(el, v, type = 'change') { el.value = v; el.dispatchEvent(new w.Event(type, { bubbles: true })); },
    async pick(el, v) { this.set(el, v); await sleep(); },
    async wait(f, ms = timeout) { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(10); if (!f()) throw new Error(`timed out waiting for ${f}`); },
    key: (k, o = {}) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, ...o })),
    editors: () => w.document.querySelectorAll('textarea.hl-ta').length,
    sent: (type) => w.__sent.filter((m) => m.type === type),
    stored: (key) => JSON.parse(w.localStorage.getItem(key) ?? 'null'),
    close: () => w.close(),
  };
}
export const KEYS = { workshop: 'tinyminds.workshop.v1', draft: 'tinyminds.maps.draft.v1' };
