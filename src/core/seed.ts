/** UTC calendar date as YYYY-MM-DD. */
export const utcDate = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

/** Daily seed: FNV-1a of the UTC date string, masked to 30 bits. */
export function dailySeed(date: string = utcDate()): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) h = Math.imul(h ^ date.charCodeAt(i), 0x01000193);
  return (h >>> 0) & 0x3fffffff;
}
