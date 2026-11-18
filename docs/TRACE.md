# Official trace

The ICFP 2004 task (section 2.13) published the whole state after every round 0..10,000 of one game: `tiny.world`, the 400-state
`sample.ant` against itself, s0 = 12345. The reference puts this at the top of its order of trust. Code: `src/core/trace.ts`
(pure strings), `cli/trace.ts`, `scripts/fetch-trace.ts`, `test/official.test.ts`, `test/trace.test.ts`.

## Result

All 10,001 frames (rounds 0..10000, 100 cells each) are identical to the official dump, line for line, in a toroidal and in a
bounded world. Our exporter also writes rounds 0..1000 and 9000..10000 byte for byte equal to `dump.0-1000.gz` and
`dump.9000-10000.gz`. Nothing had to be changed in the simulator, the RNG or the `.ant` importer.

What the trace exercises (measured on the dump): 32 ants, 5 of them killed (rounds 409, 937, 3323, 5491, 5983), all six marker
bits of both colours, up to 17 packets carried at once, 171 distinct program states visited, 76 packets of food at the start and 91 at
the end (83 on the ground, 8 carried; 91 = 76 + 5 x 3, the packets the dead ants left). What it cannot show: one 10x10 world with a rock border, so toroidal and bounded runs must agree
(the two tests only confirm that), one brain mirrored against itself, two colonies, Classic rules. The micro-tests, the Python
oracle and the reference demo remain the checks for everything else (flags, 26 colonies, rare paths).

## Format (as found in the files)

    random seed: 12345
    <blank>
    After round 0...
    cell (0, 0): rock
    cell (1, 1): 9 food; 
    cell (3, 1): 
    cell (4, 2): black hill; black ant of id 0, dir 0, food 0, state 0, resting 0
    cell (1, 1): 9 food; red marks: 02345; black marks: 5; red ant of id 31, dir 2, food 1, state 4, resting 0   (round 5000)
    <blank>
    After round 1...

- One chunk per round, each starting with a blank line; the file ends after the last cell line.
- One line per cell, row-major. After `cell (x, y): ` come, in this order and each only when present: `N food; `,
  `red hill; ` or `black hill; `, `red marks: DIGITS; `, `black marks: DIGITS; `, then the ant (no trailing separator).
  A rock cell is just `rock`. A cell with nothing keeps the trailing space after the colon; `9 food; ` keeps its trailing space.
- Marks list the set markers as digits in ascending order. Ids are global and row-major (black 0..15 on top, red 16..31).
- `resting` is 14 right after a move and counts down one per round; `state` is the `.ant` line number from 0 (= our pc).
- Round 0 is the initial state, round 1 the first executed round. The 10 files `dump.A-B.gz` share their boundary round.
- Colony 0 is red (`+`), colony 1 black (`-`). The format has two colours: `frameLines` refuses more.

## Use

    node scripts/fetch-trace.ts                      # or: npm run trace:fetch -> traces/official/
    node cli/trace.ts compare --map traces/official/tiny.world --ant traces/official/sample.ant traces/official/dump.*.gz
    node cli/trace.ts export  --map W --ant A [--ant B] --rounds 10000 [--from 0] [--seed 12345] --out mine.txt

`compare` merges chunk files (overlapping rounds must agree), runs the simulator with the dump's seed to every frame, and stops at
the first differing line: round, line number in the frame, official text, our text. Exit 1 on a difference. `--no-wrap` runs a
bounded world. `export` streams, so a 100x100 world does not need memory for the whole dump (it is large: 10,000 lines per round).

`npm test` runs `test/official.test.ts` when `traces/official/` is complete and skips it otherwise (three skipped tests, with the
command to fetch). `ANTWAR_OFFICIAL=1` turns a missing trace into a failure; CI sets it.

## Provenance and licence

`icfpcontest.org` (the original host) did not resolve from the build machine, so the files come from a public copy in
`github.com/schani/icfp-2004` (`data/`, team Funktion im Kopf der Mensch). `spec/official-trace.json` pins that repository's
commit and the sha256 of each of the 12 files; `fetch-trace.ts` refuses anything else. The match itself is the authenticity check:
an implementation written from the task text agreeing on 10,001 states of 100 cells cannot be a coincidence, and a changed
seed or one changed ant line makes `compare` fail within a few rounds (both are tested).

The files are **downloaded, not committed**. The task gave no licence for them and neither does the copy. Committing them is
the open fixtures decision (`test/fixtures/README.md`); the 1.6 MB of gzip would not help much anyway.

## Findings on the way

- `test/fixtures/starter.ant` is the 16-state example ant from the task text, **not** `sample.ant`. The README had called both
  fixtures "the task's sample world and ant". The fixture README now says what each is.
- `tiny.world` as committed differed from the official file in whitespace only. The official layout puts the leading space on
  **odd** rows (they are the shifted ones); `formatMap` wrote it on even rows. Fixed: `formatMap(parseMap(official)) === official`
  is tested. The worlds are identical (checked for the six pinned generator seeds), but the pinned FNV of the formatted *text* in
  `test/match.test.ts` changed. Share links and descriptors that embed older map text still parse (whitespace is ignored).
- The reference's "Trace" bullet (RNG tab, State hash and trace) and the Fixtures bullet now describe the format and where the
  files come from, in English and Chinese.

## Not done

Flags: the exporter writes whatever the simulator holds (`food` is the carried count, so carry-two prints 2, which the official
format never has), and nothing official exists to compare a flag with. Importing a dump into the workshop viewer.
