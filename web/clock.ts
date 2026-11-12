/** UTC calendar date as YYYY-MM-DD (the client owns the clock; core/ never reads it). */
export const utcDate = (d: Date = new Date()): string => d.toISOString().slice(0, 10);
