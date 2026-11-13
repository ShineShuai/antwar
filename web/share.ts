// Share links: the whole setup travels in the URL fragment, #v1.<base64url(deflate-raw(JSON))>.
// The fragment is never sent to a server; the decoder caps the inflated size so a crafted link cannot exhaust memory.
export interface Share { seed: number; brains: [string, string]; map?: string; gen?: number }

export const MAX_INFLATED = 1 << 20;

async function pump(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, cap: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > cap) { await reader.cancel(); throw new Error('payload too large'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const toB64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (t: string): Uint8Array => {
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(t.length / 4) * 4, '='));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function encodeShare(s: Share): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, ...s }));
  return toB64(await pump(json, new CompressionStream('deflate-raw'), Infinity));
}

/** The decoded setup, or null if the token is malformed, too large or not a v1 payload. */
export async function decodeShare(token: string): Promise<Share | null> {
  try {
    const raw = await pump(fromB64(token), new DecompressionStream('deflate-raw'), MAX_INFLATED);
    const o = JSON.parse(new TextDecoder().decode(raw)) as Partial<Share> & { v?: number };
    const brains = o.brains;
    if (o.v !== 1 || typeof o.seed !== 'number' || !Number.isFinite(o.seed)) return null;
    if (!Array.isArray(brains) || brains.length !== 2 || !brains.every((b) => typeof b === 'string')) return null;
    if (o.map !== undefined && typeof o.map !== 'string') return null;
    return { seed: o.seed, brains: [brains[0], brains[1]], map: o.map, gen: typeof o.gen === 'number' ? o.gen : undefined };
  } catch {
    return null;
  }
}
