// Static build: one tsc emit writes unbundled ES modules to dist/ (.ts specifiers rewritten to .js).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
mkdirSync('dist/web', { recursive: true });
cpSync('web/workshop.html', 'dist/web/workshop.html');
