/** Daily seed: FNV-1a of a YYYY-MM-DD (UTC) string, masked to 30 bits. The client supplies the date. */
export function dailySeed(date: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) h = Math.imul(h ^ date.charCodeAt(i), 0x01000193);
  return (h >>> 0) & 0x3fffffff;
}
