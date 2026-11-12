// Static build: esbuild bundles the page script and the Worker into dist/ (served as-is).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: { 'web/workshop': 'web/workshop.ts', 'web/sim-worker': 'web/sim-worker.ts' },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: 'dist',
  sourcemap: true,
  logLevel: 'info',
});
mkdirSync('dist/web', { recursive: true });
cpSync('web/workshop.html', 'dist/web/workshop.html');
