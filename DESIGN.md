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
CR/QA pips → per-signer names and times, the weight letter → the exact +/−
diff, the age line → opened/last-activity. Detail lives one hover from the
mark that hints at it; the repo# door summarizes all of it in prose. This
split is deliberate — merging every
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

**Workflow verbs are first-class: standing words in the row's anatomy.**
Claim and Snooze are the board's two gestures, so they live in the rail's
last column — the verb dock — like CR and age do, not in anything that
materializes on hover. At rest they WHISPER (60% ink-3: readable cold, so
the affordance is discoverable without hover, touch included); on row
hover each rises to its true color — Claim to brand, the invitation,
Snooze to ink. A claim you hold turns the slot into "Release" in standing
brand: a commitment is never hidden. The dock is one column down a lane
(the Claim slot is reserved even where unclaimable), a verb renders only
where it acts (Snooze on Review alone), and utilities (copy branch,
re-fetch) stay in the kebab at every width, verbs atop its menu. Two
failure modes this replaces: four identical icons gave equal salience to
unequal decisions, and a hover-revealed pill made the board's core gesture
undiscoverable at rest.

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
| circle marks (14px SVG masks, `.pip` for humans; `.ci-ring`/`.ci-disc` for CI) | CI/CR/QA sign-off | ONE geometry for all three reviewers, but **check glyphs are reserved for humans**: CR/QA pips carry the ✓ (solid stands, outlined lapsed, empty needed); CI is a glyphless circle — the machine's mark (2026-07: the knocked-out ✗ disc was retired as louder than any human mark; mass and color carry the alarm now). CI's three standings, all animated with purpose: a **red ring with a center dot** = failing (always binary — a 1-of-25 failure must read as loudly as 25-of-25, so the fraction lives in the popover, never the mark; it lands once with a 320ms scale-settle, then holds still — an alarm that keeps moving is a nag. A solid red disc was tried and cut as a blob: the dot is the smallest mass that still says alarm, hollow like the rest of the machine family, and a form apart from the green passed ring, not just a hue); a **slate ring sweeping clockwise** = running, the sweep being the completed share of checks (breathing at 2.4s so a live run reads as alive; `--sweep` is a registered `@property` so share changes glide); a **closed green ring** revealed on row hover = passed (invisible at rest — no news is good news). It does not draw itself on reveal: **animation is reserved for state CHANGES** (a share advancing, a failure landing), and hovering isn't a change — a draw-on-hover was tried and cut for exactly this reason. Reduced motion: no breathe, no land. All 14px. **The 18px alarm tier is retired**: it earned its size when the rail was crowded with the weight ruler; in the quiet single-line rail, red-as-the-only-red-mark is already the loudest thing on the rail. In wrapped narrow rails (≤520px containers) the quiet/no-check CI slot collapses instead of reserving a hole — cross-row alignment only exists in wide lanes |
| quiet text letter (11px, same fixed slot as the CI/CR/QA label) | review weight | XS/S/M/L/XL — never a "?": the server guarantees diff stats on every open pull (a list item arriving without them gets the full pull fetched), so the unknown-size state was removed outright. Not its own shape at all, deliberately: it rides inside the CR cluster (`CR` label · weight letter · pips) instead of inventing a fourth family or drawing a ratio strip. A prior 4px fill-doubles-per-class strip under the whole sign-off row was retired (2026-07): the owner found it visually loud and it only ever said what a letter already says. Same popover survives the move — the effort word, the exact +/− diff, and the "Filter to X PRs" action |
| the row's baseline (1px hairline, bottom edge) | age / starvation | **gated, not always-on**: nothing below the aging threshold, then a grey hairline — a deepened stretch of the divider the row already has, never a drawn bar. **Relative, not thresholded**: the board's longest-open pull sets the full track and the deepest tint (ultra-light grey → the full border color, deliberately no darker than the row dividers it extends); every other row is a fraction of the oldest. **Grey only** — the amber version was disruptive and a red plateau before it read as "broken" everywhere; age is a quiet fact, urgency lives in the queue's ranking and the numeral's font weight. The quiet day count floats right in the meta line, capping the track. **The line is also a door** (2026-07): a taller invisible hit strip (10px, sized to the line's own drawn fraction, not the full row) makes a 1px target hoverable without pixel-hunting; hover or focus grows the line to an 8px band and opens the same age popover the numeral shows (opened X ago, last activity Y ago, the relative-to-the-oldest line) — one popover body, two doors, so they can't drift apart |

The rail is one instrument, one line: `CI` then the `CR` cluster (label,
weight letter, sign-off pips) then the `QA` cluster (label, pips). Age
lives on the row's own bottom edge, not in the rail — the track is a line
the row already had, now a hover door in its own right. When a signal moves
onto a better mark, remove it from the old one in the same change, or the
card gets louder instead of clearer.

Marks are drawn as SVG masks / CSS geometry, never font glyphs — a text ✓
at 10px is at the mercy of the platform rasterizer (a struck-through ✓ was
conceptually perfect and rendered as a blob).

**Salience is relative to its era.** A mark's loudness is set by its
neighbors, not by its own pixels: the 18px CI alarm was right next to a
112px ruler and shouting once the ruler died. After removing or quieting
anything in a region, re-audit what now reads loudest there — escalations
earned in a crowded layout rarely survive a quiet one.

**A boolean alarm is never a proportion.** Encoding "broken" as a share
(a red arc sized failing/total) makes one failure out of 25 a 4% sliver —
invisible for the state that most needs seeing. Alarms are binary at full
strength; continuous encodings (the CI progress ring's sweep, the age
line's length) are reserved for facts that are genuinely continuous. The
counts live in the popover.

**One mark can also carry a relation's two standings.** The stack
connector's full elbow means "child of the row above"; the same line
truncated to an 8px stub means "child of something that isn't here." When
a relationship's other end may be off-screen, truncate the mark rather
than inventing a second vocabulary — the full form teaches the stub.

### Icons

One family: every icon on the board renders through `lucide-react` (ISC,
per-icon imports so tree-shaking holds) via the single wrapper in
`components/Icon.tsx` — 14px for inline/action marks, 16px for header chrome,
lucide's own stroke weight never overridden (a second weight would be a second
family). A 2026-07 icon audit found four different coordinate grids, fill and
stroke mixed on what should've been one glyph language, and a dozen
platform-rendered text glyphs standing in for marks (★/☆, ▸/▾, ✕, ◆) — all
retired in the same pass. **Text glyphs are banned for marks app-wide now**,
not just on the rail; if a mark needs a new glyph, it comes from lucide.

Two things stay outside that family on purpose: the rail's CI/CR/QA pips
(`.pip`, above) are CSS masks, not lucide imports — one shape family, sized
and animated in ways an icon library's fixed viewBox can't do, and the
doctrine that governs them predates this pass and isn't part of it. The
`EmptyState` animated draw-check (bits.tsx) is a sanctioned hand-drawn
set-piece: it already speaks lucide's own stroke-and-round-cap language, and
its one-shot draw-on animation is bespoke to this exact SVG, not a lucide
icon with a class bolted on.

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

## Settings & configuration

- **A control lives where its effect is visible.** Notification prefs
  behind the bell, filter defaults inside their filters ("Make this my
  default" when the session differs), team and repos edited on the board
  surfaces that show them. The Settings panel is the home of last resort,
  not the junk drawer.
- **Identity data is not a setting.** Your team, repos, and regions are
  workspace data with their own editors; embedding full pickers in a
  preferences panel cost 31% of its scroll and made it a "large list"
  (owner's words, then measured: 2,846px, 20% visible at once).
- **The panel must be seeable whole.** The test for done: a first-time
  user can enumerate every setting without scrolling much; verbs (refresh,
  reset) and rarely-touched timers fold into one Advanced disclosure,
  destructive action last.
- **Two knobs on one concept is one too many.** Derived values (rot =
  2.5 × warn) beat sibling fields nobody tunes independently.
- **Sticky headers over scrolling interactive content need an explicit
  z-index and an opaque background** — every `.hit` control is positioned
  and will paint over an unranked sticky header in DOM order (this
  shipped as a real mobile bug).

## Feedback & celebrations

- **Only cheer what the user caused.** Board-relative facts improve
  passively (your rank climbs when someone else's reviewed PRs merge
  away); a celebration gated only on the fact's transition fires "at
  random" from the user's seat. Require the user's own action in the
  gate (climbing demands your own stamp count grew).
- **Nags are once per subject** with an explicit refire rule (overtaken
  refires only after you reclaim and lose the spot again); dedupe keys
  name the subject, not the tick.

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
- **The dummy board is the design bench: every mark's every standing must
  be permanently visible on it.** Viewer-relative lanes can structurally
  hide a state (a stack only nests when its members share one list, so no
  chain ever nested until the fixture was synthesized with uniform state).
  When a state can't occur naturally in the fixture, synthesize it
  deterministically and comment why.
- Prototype candidates with throwaway DOM/JS mutation in the live page;
  let the owner pick from *rendered* candidates, not descriptions.
- For any salience claim, do the arithmetic (area × contrast) — one
  "inverted salience" design shipped with the math actually backwards.
- The legend (`?` panel) is updated in the same change as any vocabulary
  change, but if a mark only works with the legend open, keep iterating.
