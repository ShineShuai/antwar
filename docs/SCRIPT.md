# Level 3: the structured script

The reference's ladder is personality -> rules -> moods -> **script** -> assembly. The script is the structured syntax of the
reference's "High-level compiler grammar" (the ocamlyacc grammar of the original toolchain), with the lowering rules the
reference marks as inferred, made exact. Code: `src/lang/script.ts`. `node cli/rc.ts FILE.script` prints size and warnings,
`--asm` the flat assembly it lowers to, `--ant` the official `.ant` text. A text whose first word (after comments) is `define`
is a script; the workshop, the CLIs and the replay layer load it like any other brain.

## Language

    // comment    # comment    /* comment */
    define wander {                     // a macro; no parameters: the body is a block
      w: choose {                       // a label, then a random choice
        case: turn left ;               // every case holds ONE instruction
        case: turn right ;
        case: move else goto w ;        // blocked: roll again
      }
    }
    define main {                       // the program starts here (or at the last define)
      loop {
        sense ahead food
          then { move ; pickup ; }
          else wander ;
      }
    }

* **Instructions** (each ends as shown): `sense DIR COND cont` `pickup cont` `move cont` `flip N cont` `mark N ;` `unmark N ;`
  `drop ;` `turn left|right ;` `loop INSTR` `exit ;` `repeat N INSTR` `choose { case: INSTR ... }` `goto LABEL ;` `LABEL: INSTR`
  `{ INSTR ... }` `MACRO` / `MACRO { block } { block }` and `;` (nothing). `direction N cont` (the ant faces N, 0-5) and `payload N cont` (it carries N packets) are the
  extended senses: Tinyminds has them, Classic does not ("not in this ruleset").
* **DIR** = `here ahead left ahead right ahead` (also `leftahead`, `rightahead`). **COND** = `friend foe food rock home`
  `marker N` `friend with food` `foe with food` `foe marker` `foe home` (also the one-word forms). Case does not matter.
* **cont** = `then A` | `else B` | `then A else B` | `;`. `A` runs when the test succeeds, `B` when it fails, and what follows the whole
  instruction runs after either. A bare `;` continues the same way on both paths. `else` binds to the nearest `then`.
  `flip N`: the `then` side has chance 1 in N (a `flipzero N`); `move`/`pickup`: success is `then`, failure `else`.
* **Macros**: `define NAME { ... }`, or with block parameters `define NAME p q = INSTR`; call `NAME { block } { block }`. A
  parameter name inside the body runs the block, where the call was written. No-parameter macros are called by name alone;
  because `NAME { ... }` is a call with a block, put a `;` between a call and a following block statement.
* **Reserved words** (macro, parameter and label names cannot be them): `define sense mark unmark pickup drop turn move flip
  direction payload loop exit choose case repeat goto then else left right here ahead friend foe with food rock marker home`
  and the one-word condition names. (`goto home` does not parse in the original either.)
* Ranges: markers 0-5, `flip` 1-16384, `choose` 1-64 cases, `repeat` 0-1000.

## Cost, as everywhere

A sense, `move`, `pickup`, `drop`, `turn`, `mark`, `unmark` and `flip` take one round. `goto`, labels, `loop`, `exit`, macro calls and
blocks cost nothing; they only decide which instruction comes next. The program starts at the macro `main` (the last define
if there is none) and, when it falls off its end, starts again at no cost.

## Lowering (what `--asm` prints)

| script | flat assembly |
|---|---|
| `sense .. then A else B` | `sense .. else L1; A; goto L2; L1: B; L2:` |
| `then A` only / `else B` only / `;` | `sense .. else L2; A; L2:` / `sense .. else L1; goto L2; L1: B; L2:` / `sense .. else L2; L2:` |
| `loop X` | `L: X; goto L` |
| `exit` | `goto` the end of the innermost loop |
| `repeat n X` | `X` copied n times (no counters exist) |
| `choose` with k cases | `flipzero k else c2; case1; goto end; c2: flipzero k-1 else c3; ...; the last case unconditional` (uniform) |
| macro call | the body, expanded at the call site; parameters substituted as blocks |
| `L: X` / `goto L` | a label / a free edge, resolved by the assembler |

The size limit (2,000 instructions) is checked after expansion; the error names the macro chain that overflowed.

## Decisions (the reference calls the lowering "inferred")

1. **`exit` leaves the innermost loop.** The reference's reading, `exit = L: goto L`, is a zero-cost goto cycle, which the
   assembler rejects (a program that never acts would hang the simulator). `exit` outside any loop is an error. A macro starts
   outside any loop; a block given to a macro belongs to the macro where it is written, so `each { ... exit ; }` inside a loop of
   the caller leaves the caller's loop.
2. **The entry point**: the macro `main`, else the last define (the reference's example ends with the macro that starts, `scout`).
   It must take no blocks.
3. **Labels** belong to one macro expansion: two calls of a macro with a label inside do not clash, and `goto` sees only the
   labels of its own macro. A label cannot be inside `repeat` (the body is copied) or inside a block that its macro uses twice.
4. **The no-parameter define needs a block** (`define f { ... }`); with parameters, `define f x = INSTR`. This is the reference's
   resolution of the grammar's shift/reduce conflict. A define whose body is a single instruction other than a call or label may
   also omit the braces (`define spin loop turn left ;`).
5. **`choose` accepts at most 64 cases and `flip` 1-16384**, as the reference says authoring levels keep to p <= 64 (the chance
   `ceil(16384/p)/16384` is exact for powers of two and within 0.4% up to 64). `flip` above 64 compiles with a warning.
6. **An unused macro is still checked**: it is expanded once with empty blocks, so an error in it is reported (and a warning says it is
   never used).
7. **A `case:` holds exactly one instruction**, as in the grammar. `case: foo ;` is an error with a hint (a macro call needs no `;`).

## Errors and warnings

Errors name the line (`line 3: a marker must be a number from 0 to 5, found "9"`): unknown macro or instruction (with a "did you
mean"), recursion (`a -> b -> a`), nesting deeper than 8, wrong number of blocks, reserved names, a missing `;` or `}`, `exit`
outside a loop, unknown, duplicate or misplaced labels, out-of-range numbers, a loop that can go round without ever acting, too
big after expansion, extended senses in Classic. Warnings never block: an unused macro, a `sense`/`flip` with no `then` or `else`
(it only spends a round; `move ;` is fine, it just tries), code after a `loop` without `exit`, `flip` above 64, a program
that never picks up or never drops food, a marker written and never read or the reverse.

## Checks

`test/script.test.ts` (15 tests): round-exact costs on a one-ant world, `repeat`/`loop`/`exit`, the `choose` flip chain and the share
of each case over 91 ants, macros (nesting, shadowing, blocks), 39 error cases with their line numbers, the warnings, every spelling
of the conditions, and the dangling else. **The starter ant written as a script (`ants/starter.script`) plays identically to the flat
starter**: same position, direction, food and rest of every ant for 500 rounds on 4 worlds, the same random draws in the same
order, and the same 16 states. A larger script and the compiled trail rules go through the Python oracle from their official `.ant`
text (`toIcfp`, new in `src/core/asm.ts`, the inverse of `parseIcfp`; also `node cli/rc.ts --ant`), and the hashes agree.

## In the workshop

The brain box takes a script (note: macros, entry, size, states; warnings and errors with line numbers that jump to the line). The
"Starter (script, level 3)" example is `ants/starter.script`. Following an ant names the script line it is about to run (the trace
collapses rounds on the same line, as it does for assembly). Not there: the rule-firing bars (they are per rule), and "see what it
compiles to" for scripts, which is `cli/rc.ts --asm`.

## Not done

A script version of the trail kit (`step`, `return home`, ... are rules-language skills; in a script they are macros you write), a
decompiler from assembly back to a script, per-line fire counts for scripts, an oracle check of the extended senses (the Python oracle is Classic), syntax colouring.
