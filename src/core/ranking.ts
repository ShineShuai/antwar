// Ranking for any number of colonies. The contest scores a game of two colonies 2 (more nest food), 1 (equal) or 0; for more, every
// pair of colonies is scored that way, so a colony earns 2 points for each colony it out-scores and 1 for each one it equals. Nothing
// but the order of the food counts. Integers only. See docs/MATCH.md.

/** Points for one game from the nest food of a colony and of its opponent. */
export const points = (mine: number, theirs: number): number => (mine > theirs ? 2 : mine === theirs ? 1 : 0);

export interface ColonyResult {
  /** 1 for the most food; colonies with equal food share a rank and leave a gap after it (1, 2, 2, 4). */
  rank: number[];
  /** Pairwise points against every other colony; they add up to n * (n - 1) in every game. */
  points: number[];
}

/** The result of one game from the nest food of each colony (index = colony). */
export function colonyResult(food: readonly number[]): ColonyResult {
  const rank: number[] = [], pts: number[] = [];
  for (let c = 0; c < food.length; c++) {
    let r = 1, p = 0;
    for (let d = 0; d < food.length; d++) {
      if (d === c) continue;
      if (food[d] > food[c]) r++;
      p += points(food[c], food[d]);
    }
    rank.push(r); pts.push(p);
  }
  return { rank, points: pts };
}
