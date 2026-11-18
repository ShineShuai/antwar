#!/usr/bin/env node
// Downloads the official ICFP 2004 trace (tiny.world, sample.ant, dump.*.gz) into traces/official/ and checks the
// sha256 pinned in spec/official-trace.json. The files are not committed (licence unchecked): see docs/TRACE.md.
//   node scripts/fetch-trace.ts [DIR]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../spec/official-trace.json', import.meta.url), 'utf8')) as {
  source: string; commit: string; dir: string; sha256: Record<string, string>;
};
const dir = new URL(`${process.argv[2] ?? 'traces/official'}/`.replace(/\/+$/, '/'), new URL('../', import.meta.url));
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const raw = (f: string): string => `${manifest.source.replace('https://github.com', 'https://raw.githubusercontent.com')}/${manifest.commit}/${manifest.dir}/${f}`;

mkdirSync(dir, { recursive: true });
let bad = 0;
for (const [f, want] of Object.entries(manifest.sha256)) {
  const path = new URL(f, dir);
  if (existsSync(path) && sha(readFileSync(path)) === want) { console.log(`have ${f}`); continue; }
  let got = '', body = new Uint8Array();
  for (let attempt = 1; attempt <= 3 && got !== want; attempt++) {
    try {
      const res = await fetch(raw(f));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = new Uint8Array(await res.arrayBuffer());
      got = sha(body);
    } catch (e) { console.error(`${f}: attempt ${attempt}: ${(e as Error).message}`); }
  }
  if (got === want) { writeFileSync(path, body); console.log(`got  ${f} (${body.length} bytes)`); }
  else { bad++; console.error(`FAIL ${f}: sha256 ${got || 'unavailable'}, pinned ${want}`); }
}
process.exit(bad ? 1 : 0);
