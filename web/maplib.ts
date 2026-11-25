// The local library of maps (localStorage): named map texts, newest last. Pure functions over a storage, so tests use a fake one.
export const LIB_KEY = 'tinyminds.maps.v1';
export const MAX_MAPS = 50, MAX_NAME = 40, MAX_TEXT = 1 << 17, MAX_TOTAL = 3 << 20;

export interface SavedMap { name: string; text: string; savedAt: number }
type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The saved maps; damaged entries are skipped. */
export function readLibrary(storage: Pick<Storage, 'getItem'>): SavedMap[] {
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(LIB_KEY) ?? '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: SavedMap[] = [], seen = new Set<string>();
  for (const m of raw as Partial<SavedMap>[]) {
    if (typeof m?.name !== 'string' || typeof m.text !== 'string' || typeof m.savedAt !== 'number') continue;
    if (m.name === '' || m.name.length > MAX_NAME || m.text.length > MAX_TEXT || seen.has(m.name)) continue;
    seen.add(m.name); out.push({ name: m.name, text: m.text, savedAt: m.savedAt });
    if (out.length === MAX_MAPS) break;
  }
  return out;
}

/** Saves `text` under `name` (the same name is replaced and moves to the end). Throws RangeError for a bad name, a map that is too big or a full library. */
export function saveMap(storage: Store, name: string, text: string, now = Date.now()): SavedMap[] {
  const n = name.trim();
  if (n === '' || n.length > MAX_NAME) throw new RangeError(`a name of 1 to ${MAX_NAME} characters`);
  if (text.length > MAX_TEXT) throw new RangeError('this map is too big for the library (128 KiB)');
  const lib = readLibrary(storage).filter((m) => m.name !== n);
  if (lib.length >= MAX_MAPS) throw new RangeError(`the library holds ${MAX_MAPS} maps: delete one first`);
  lib.push({ name: n, text, savedAt: now });
  if (lib.reduce((a, m) => a + m.text.length, 0) > MAX_TOTAL) throw new RangeError('the library is full: delete a map first');
  storage.setItem(LIB_KEY, JSON.stringify(lib));
  return lib;
}

export function deleteMap(storage: Store, name: string): SavedMap[] {
  const lib = readLibrary(storage).filter((m) => m.name !== name);
  storage.setItem(LIB_KEY, JSON.stringify(lib));
  return lib;
}
