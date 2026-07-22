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

**Every card that shows a PR is a board row** — fold contents, popover
previews, any future one-off surface. Same element order, same marks, same
doors. A context may *add* (a "why this one" footnote, claim buttons) but
never reorder or restate — inline status text on a card is always a
regression.

**A button that acts on a list acts on the list the user sees — and once
they fully agree, the button is redundant.** The retired "Deal me one"
feature walked the whole arc: first its hidden ranking diverged from the
queue's (a least-surprise bug), so the queue adopted the deal's exact
score; then the button could only ever hand you the top visible card of
the lane directly under it, so it was removed entirely. The rule that
remains: a ranked lane IS the recommendation — put pick logic in the
lane's ordering and explain it behind the sub-line, never inside a control
with its own private order.

**Work-in-progress lives inline, not in a popover.** A popover is for
glancing (state detail, signatures, rankings) and rightly dies on any
outside click. Anything the user is mid-way through renders in the board's
own flow, full-width so rows keep the rail geometry, dismissed only
explicitly. (The retired deal feature learned this the hard way: its
popover era dismissed a commitment-in-progress on any stray click.)

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
| circle marks (14px SVG masks, `.pip`) | CI/CR/QA sign-off | ONE family for all three reviewers — the machine is a reviewer too. The label names the reviewer, the glyph names the verdict (✓ approved, ✗ failed, ring = needed/running), the treatment names the standing (solid stands, outlined lapsed). CI is invisible at rest unless failing — its quiet states render in a reserved slot at opacity 0, revealed on row hover, so the reveal can never reflow the line. **The alarm exception**: a failing CI's X disc is the ONE mark drawn larger than the pips (18px, `.pip-alarm`), its label and count in red — broken is the board's rarest and most consequential state, so it escalates by form, never by fill (a filled red chip was prototyped and rejected as badge regression) |
| horizontal ratio strip (4px, under the marks) | review weight | one quiet ink fill on a fixed-extent track; fill **doubles per class** (6/13/25/50/100%) because effort doubles per class — exponential honesty beats linear prettiness |
| the row's baseline (1px hairline, bottom edge) | age / starvation | **gated, not always-on**: nothing below the aging threshold, then a grey hairline — a deepened stretch of the divider the row already has, never a drawn bar. **Relative, not thresholded**: the board's longest-open pull sets the full track and the deepest tint (ultra-light ink → full ink-3); every other row is a fraction of the oldest. **Grey only** — the amber version was disruptive and a red plateau before it read as "broken" everywhere; age is a quiet fact, urgency lives in the queue's ranking and the numeral's font weight. The quiet day count floats right in the meta line, capping the track |

The rail is one instrument: `CI · CR · QA` marks in a row, the weight
strip beneath them. Age lives on the row's own bottom edge, not in the
rail — the track is a line the row already had. When a signal moves onto
a better mark, remove it from the old one in the same change, or the card
gets louder instead of clearer.

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

## Copy rules (static text is part of the visual system)

- **Say the thing, don't be clever.** Lane names state their contents
  plainly: "Waiting on you" / "Waiting on others", never a metaphor the
  reader has to decode ("Your move" tested badly — some developers didn't
  parse the chess reference, and clever-compressed titles read as
  AI-written).
- **One concept, one word, everywhere it appears.** The same underlying
  fact must use the same word in the lane title, the group eyebrow, the
  State filter, the notification title, and the settings toggle (an owed
  re-stamp is "Re-stamp" / "Re-stamp owed" on every surface; it was once
  also "Re-review owed"). Before adding copy, grep for the concept's
  existing word.
- **Team vocabulary is native, not jargon.** CR, QA, stamp, re-stamp,
  rebase come from this team's own workflow (v1 heritage, `cr_req` in the
  DB) and stay. What goes: internal engineering words the reader never
  chose — "scope" (say "filters"), "starved" (say how long it waited),
  "lens" (say "tab"), "wire" (say where the data comes from), codenames
  without their plain gloss ("cryo" → "parked").
- **No em dashes in rendered copy.** Comma, period, semicolon, colon, or
  the house "·" separator. (Comments may keep them; the reader never sees
  comments.)
- **Every curated lane's sub-line is a door** (`SubDoor` in Lane.tsx): the
  visible sentence states the ordering, hovering it opens what lands in
  the lane and how it's ranked. Every group eyebrow glosses itself the
  same way (WORD_GLOSS). A control that sits away from the thing it acts
  on names that thing in its own label, so the connection survives the
  distance. The test for any new mark, header, or lane: a
  developer who has never opened the legend can decode it from the screen
  alone. The legend documents; it never teaches.

## Verification discipline (how design changes get accepted here)

- Judge at **real render px** and zoomed, in-situ beside real neighbors, in
  **both themes** — on the dummy board (`npm run dev:dummy`).
- Prototype candidates with throwaway DOM/JS mutation in the live page;
  let the owner pick from *rendered* candidates, not descriptions.
- For any salience claim, do the arithmetic (area × contrast) — one
  "inverted salience" design shipped with the math actually backwards.
- The legend (`?` panel) is updated in the same change as any vocabulary
  change, but if a mark only works with the legend open, keep iterating.
