# Pulldasher — Design System (frontend-v2)

The visual system as implemented, plus the reasoning that produced it. Token
values live in `frontend-v2/src/styles.css` (`:root` light, `.dark`) — this
file records the *rules*; the CSS records the *numbers*. Most of these rules
were reached by iterating with the product owner against the live dummy board
(July 2026); the "why" notes are load-bearing — don't undo a rule without
rereading its why.

## The one color rule

**Color means "look here"; no color means "nothing to see."** A fully quiet
row — outlined marks, no bar, faint strip — is a healthy PR that needs
nothing.

Hierarchy (one hue = one meaning, board-wide):

| Color | Meaning | Notes |
|---|---|---|
| red `--bad` | broken (CI failure) | rare by design; never on healthy rows |
| amber `--warn` | you/someone owes something (lapsed stamp, aging, blocks) | the action color |
| green `--ok` | quiet confirmation (live stamp, CI green on hover) | tuned *calmest* of the three |
| brand blue | yours / interactive (your-move headers, links, fresh) | never decorative |
| violet `--violet` | QA as a *category* (status-filter dots, QA leaderboard) | chrome only — never on a row; rows encode QA via pips + position |
| slate `--slate` | in-progress / neutral pending (CI running) | deliberately hue-less-feeling: pending is not a call to action |
| ink ramp | everything else | |

Why: an audit measured green carrying 7 meanings and red shipping *more
saturated than the brand accent* — hue overload is why "the colors weren't
obvious." Tokens are deliberately tempered (chroma below brand); dark-mode
values are re-derived, not brightened (the old dark amber was highlighter
yellow at 84% lightness).

**Never a background wash for state.** A filled color area out-competes
titles at any opacity — salience is form, not volume. Three progressively
softer washes all failed before this became a rule: put the signal on the
smallest fact-bearing element and change its *form*.

## The encoding ladder

Prefer the highest rung that can carry the meaning:

1. **Position/structure** — cards group under one-word section headers
   (`rowWord` in `model/actions.ts`): RE-STAMP, REVIEW, AWAITING RE-CR…
   Position is preattentive; this deleted per-card status badges entirely.
2. **Form** — solid vs outlined vs empty on the same mark.
3. **Glyph** — universally-read symbols only; never an invented code.
4. **Color** — as a modifier on the above, per the table.

Cards are badge-less: `avatar · title · repo# · age · flags | rail`. The
repo#number is the one door into the *full-state* popover (state sentence,
your move, sign-off names, CI word, branch, claim/rotation). The verb lives
in the section header, not on the card.

**Topical doors, not one mega-popover.** Each rail mark opens its own
detail popover scoped to that mark: the CI bar → the per-check list, the
CR/QA pips → per-signer names and times, the weight strip → the exact +/−
diff. Detail lives one hover from the mark that hints at it; the repo# door
summarizes all of it in prose. This split is deliberate — merging every
fact into one popover would bury the answer to the question the user's
cursor is already pointing at.

**Closed rows are receipts, and there is exactly one closed anatomy**
(`ClosedRow`): merged/closed badge (its own popover door — a closed pull's
only remaining fact is when it landed) · avatar · title · repo# · age. No
rail — nothing is left to act on. Every lens that shows closed pulls renders
this component; never a second hand-rolled closed card.

**Every card that shows a PR is a board row** — the Deal-me-one result, fold
contents, popover previews. Same element order, same marks, same doors. A
context may *add* (a "why this one" footnote, claim buttons) but never
reorder or restate — inline status text on a card is always a regression.

**A button that acts on a list acts on the list the user sees.** The review
queue is ranked by the same score Deal-me-one deals from, so the button
always takes the top visible card. Two orderings for one list — one shown,
one hidden inside a button — is a least-surprise bug even when both are
individually sensible; if a pick needs extra signals, put them in the
lane's ranking and explain them behind the sub-line.

**Ranked lanes explain themselves in three quiet layers**: the sub-line
says the ordering in one plain sentence (and is itself the hover-door to
the full story — existing text becomes interactive, no info-icon chrome);
each card's state popover carries a "why it's up next" line; and every
fold's hint says what lands in it. If a user has to ask why a card is
where it is, one of these layers is missing.

## Identity vs standing

A mark has two layers: the **glyph names what it is; the treatment names its
condition.** Encode state transitions by modifying a dimension of the
existing mark, not by swapping symbols:

- sign-off stamp: **solid ✓ disc** = stands · **outlined ✓** = approved once,
  a push lapsed it · **empty ring** = never approved. (Rejected on concept:
  ↻ read as *loading*, ⊘ read as *cancelled* — symbols carry categorical
  connotations; match the category, not the vibe.)

## The rail's shape taxonomy

One shape family per metric — a second circle would read as an unlabeled
member of the sign-off family (it did, when weight was a dot):

| Shape | Metric | Behavior |
|---|---|---|
| circle-checks (14px SVG masks, `.pip`) | CR/QA sign-off | the rail's senior elements; nothing else may match their size |
| segmented horizontal bar | CI | red/slate segments sized by count; **passed is invisible at rest**, green revealed on hover |
| horizontal ratio strip (4px, under CR+QA) | review weight | one quiet ink fill on a fixed-extent track; fill **doubles per class** (6/13/25/50/100%) because effort doubles per class — exponential honesty beats linear prettiness |
| horizontal ratio strip (4px, under CI) | age / starvation | **gated, not always-on**: renders nothing below the aging threshold (a placeholder holds the slot), then an amber fill growing warn→rot, red past rot, plateauing there. Distinct from the weight strip on four axes — left column, gated, only ever amber/red, square caps vs pill. The numeral in the meta line stays neutral ink (weight bump only): one mark carries the color |

The rail is two columns × two decks: `CI / age-strip` on the left,
`CR+QA pips / weight-strip` on the right. Age's color lives *only* in its
strip — when a signal moves onto a better mark, remove it from the old one
in the same change, or the card gets louder instead of clearer.

Marks are drawn as SVG masks / CSS geometry, never font glyphs — a text ✓
at 10px is at the mercy of the platform rasterizer (a struck-through ✓ was
conceptually perfect and rendered as a blob).

## Layout invariants

- The metric rail is a vertically-centered right column on wide rows
  (mail-client anatomy); in narrow columns (≤520px container query) it wraps
  to a full-width line, chips flowing left.
- Fixed-width slots keep rail columns aligned down a list; empty states
  render invisible placeholders, not nothing.
- Nothing truncates except the wait-word popover source text; density comes
  from geometry (compact mode), never from hiding text.
- Ratio marks need a **fixed extent**: a track that stretches with its cell
  makes fractions incomparable across rows.
- **Counts are always quiet**: `tabular-nums` in the surrounding text color,
  never bold ink — a count is a fact, not an alert. (Fold counts once shipped
  bold and read as more urgent than the lane titles above them.)
- **One header system, four tiers**, each defined once: `BoardColumn`
  (collapsible column panel) > `GroupHeader` (sticky lane title) >
  eyebrow labels (`eyebrowText` in WordGroups.tsx — word sub-headers and
  band labels share the exported constant, never a hand-rolled copy) >
  `Fold` summaries (disclosure rows, not titles).

## Verification discipline (how design changes get accepted here)

- Judge at **real render px** and zoomed, in-situ beside real neighbors, in
  **both themes** — on the dummy board (`npm run dev:dummy`).
- Prototype candidates with throwaway DOM/JS mutation in the live page;
  let the owner pick from *rendered* candidates, not descriptions.
- For any salience claim, do the arithmetic (area × contrast) — one
  "inverted salience" design shipped with the math actually backwards.
- The legend (`?` panel) is updated in the same change as any vocabulary
  change, but if a mark only works with the legend open, keep iterating.
