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

**Workflow verbs are first-class — and own no geometry.** Claim and
Snooze are the board's two gestures; the rail's right edge is the
board's strongest column (the age numeral caps it) and belongs to DATA
alone. So the verbs float just left of the rail, fading in on row hover
or focus — opacity only, the board's one reveal mechanism; motion stays
reserved for state changes — on a muted backdrop that keeps them legible
over the meta text beneath. Nothing is reserved, nothing shifts, every
fact column stays flush. Pointer-events follow the fade, so an invisible
word can never steal a click. Claim and Release wear brand (the
invitation and its undo); Snooze, ink. Each chip follows ONE rule: it
STANDS when it records a choice you made — a claimed row always shows
"Release", a snoozed row always shows "Unsnooze", in place, no hover —
and reveals on approach when it merely OFFERS one ("Claim", "Snooze").
The state and its exit are the same pixel: no state glyph (the hand
icon was retired outright), no meta flag restating it (tried and cut —
the standing chip already IS the record). If both states are yours,
both chips stand. Touch has no hover: offers live in the kebab there,
labeled and carrying the same toggled words; standing exits remain
visible everywhere. A verb renders only where it acts (Snooze on
Review alone); utilities stay in the kebab at every width, verbs atop
its menu. Failure modes this design retires, in order tried: four
identical icons (equal salience, unequal decisions); sixty standing
words down a lane (texture where quiet belongs); and a reserved
invisible slot at the row's end (it pushed the age column off the right
edge and paid dead space for words that weren't there — a place is only
worth standing if something visible stands in it).

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
fold's label glosses what lands in it on hover. If a user has to ask why
a card is where it is, one of these layers is missing.

## Identity vs standing

**The silhouette and the corner mark** — the author-identity system, two
channels and no ring:

- **Shape answers person-or-machine.** People are circles; bots (a
  `[bot]` login or config.json's `bots` list) are rounded-square tiles,
  the app-icon idiom Slack and GitHub already taught. No glyph, no hue:
  the outline is the whole mark, so it reads at 16px and in peripheral
  vision.
- **The bottom-right corner answers what-this-person-is-to-you, in one
  of two glyphs.** A small (9px) filled brand heart on a teammate —
  someone on one of your rosters; on your own avatar, a larger
  (13px/11px) brand star seated ON the rim with a transparent bite
  masked out of the face — your silhouette is visibly broken, so your
  rows are findable by *form* before the star even resolves. The star
  means exactly one thing now: you. You are the vocabulary's largest
  case, escalated by size and a broken outline, never by fill. The bite
  is a mask, not a painted stroke, so it stays correct over any row
  background (hover, fresh flash).
- Static always: identity, not state. Never animates.
- **The controls are retired, not just renamed.** There is no more
  "starred repo" or "starred person" toggle: repo relevance is inferred
  from the current board (repos you've authored or stamped on), and
  roster membership is edited only on the Team lens, not from a row or
  filter-row button.

Rejected on the way here, in order: the plain brand ring (selection
halo), a corner dot (online presence), a brand repo#number (reads as a
link), v1's full star-substitution coin (loses the face),
star-badge-riding-ring (two marks negotiating one corner), and the
seated-star seal itself — a parted ring with the star in the opening —
which shipped, then died on the owner's read ("I don't like the seal at
all"): even parted, ring-ness reads as chrome around the face rather
than a mark of it. From the 20-concept sweep that followed, the
runner-ups were a pure size bump (your face ~5px larger; zero new
vocabulary but marginal in far periphery) and a brand mat behind your
avatar (unmissable but the board's first filled color area on rows).
The corner-bot-glyph variant of full unification lost to the square
silhouette: a 9px machine glyph needs bespoke drawing to survive
rasterization, and shape gets the same distinction free.


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
| the row's baseline (2px hairline, bottom edge) | age / starvation | **gated, not always-on**: nothing below the aging threshold, then a grey hairline — a deepened stretch of the divider the row already has, never a drawn bar. **Relative, not thresholded**: the board's longest-open pull sets the full track and the deepest tint (ultra-light grey → the full border color, deliberately no darker than the row dividers it extends); every other row is a fraction of the oldest, on a square-root curve so the actionable young/mid range stays legible even when one ancient PR sets the top (age doesn't feel linear — 2→5 days reads big, 60→63 as nothing). **Grey only** — the amber version was disruptive and a red plateau before it read as "broken" everywhere; age is a quiet fact, urgency lives in the queue's ranking and the numeral's font weight. The quiet day count floats right in the meta line, capping the track. **The line is also a door** (2026-07): a taller invisible hit strip (10px, sized to the line's own drawn fraction, not the full row) makes a thin target hoverable without pixel-hunting; hover or focus grows the line to an 8px band and opens the same age popover the numeral shows (opened X ago, last activity Y ago, the relative-to-the-oldest line) — one popover body, two doors, so they can't drift apart |

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
- **One header system, three tiers**, each defined once: `BoardColumn`
  (collapsible column panel) > `GroupHeader` (sticky lane title) >
  `Fold` (the board's ONE subsection: a collapsible eyebrow band).
  Every subdivision below a lane title is a Fold — word groups inside
  "Waiting on you", the rest-of-the-board ledger, a person's other PRs,
  Ci's per-check bands. The former fourth tier (non-folding word
  sub-headers vs chevron-and-dot disclosure rows) merged into it: two
  grouping languages on one board meant the reader learned both.
  `eyebrowText` (exported from Lane.tsx) is the band's type treatment;
  band labels outside a Fold ("Pick up next", "Check health") share the
  constant, never a hand-rolled copy.
- **The Fold contract**: label speaks the row-word vocabulary (brand for
  a do-word — the next step is yours; muted for everything that waits),
  `· count` after it, a 12px chevron as the one disclosure affordance,
  no status dot (the rows inside carry their own pips — a second color
  code on the band was redundant weight). Clicking anywhere on the band
  toggles, including the label; hovering the label opens its
  one-sentence gloss. Primary lanes greet you with groups open; ledger
  groups rest closed, so a quiet stack of bands reads as a table of
  contents. An explicit open/closed choice is remembered per fold id.

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

## Charts and dates

- **Charts are Recharts, drawn in SVG, and colored only with the tokens.**
  SVG takes `var(--ok)` in a fill, so dark mode costs no redraw, the same
  rule the hand-drawn Stats charts follow. Canvas libraries (uPlot, Chart.js,
  ECharts) were set aside for exactly that: every theme switch would need a
  redraw with colors read out of CSS. Recharts is the heaviest thing on the
  board, so it loads in its own chunk with the views that chart; the review
  board never downloads it. The roadmap's load chart is the one exception:
  plain positioned elements on the timeline's own axis, so each week's bar
  sits exactly above the same weeks of every row.
- **Charts don't animate.** Motion on this board means something changed,
  and a chart drawing itself in on load says nothing.
- **One color vocabulary across Stats and Projects**: ink for opened, green
  for merged or finished, brand for what is still open, a paler ink for
  closed without merging.
- **One date range per page, picked with one control**: the button that
  names the range, opening the presets an analytics tool offers beside a
  two-month calendar (react-day-picker, lazy with its stylesheet). A preset
  applies on click; a hand-picked range applies with Apply. Rejected: a row
  of segment buttons plus two date inputs (shaped for developers, not the
  product manager reading the numbers), and a second control for the
  chart's own window (two knobs on one concept). A chart instead shows at
  least 90 days ending on the range's last day and pales the days before the
  range, so a short range still shows its trend.
- **The roadmap moves by direct manipulation, in whole weeks.** Drag a
  row's grip to change its priority (the order is the priority; there's no
  separate number to keep in sync), drag a bar to move the plan, and drag
  its right edge to change the length. Every drag has a keyboard twin:
  arrows on the grip reorder, arrows on a focused bar move it a week, and
  Shift with them changes the length. A plan's bar says its status by form
  (an outline while planned, a fill once under way, green when done, a gray
  outline when parked, faint when dropped) and its dates and weeks inside, when it has room. Editing opens inline
  under the row, not in a popover, since a half-typed plan shouldn't
  vanish on a stray click. Now, next and later is the same plan without
  week dates, for readers who want the order and not the weeks: a card in
  Next or Later says only the month its work starts. The columns are
  derived from the dates, never set by hand, so the two layouts can't
  disagree.
- **Every mark on the timeline says what it is, where it's drawn.** A
  mark that needs a legend gets rethought, not explained: an unlabeled gray
  line for a project's PR activity and an upright tick for its milestone
  were tried and cut because nobody could read them cold. Now a plan still
  in flight past its end grows an amber piece labeled "+3 wk over", a
  milestone is a flag with its date ("Dec 14 target"), a project with no
  plan is a dashed bar that says "since Aug 17, no plan", and the load
  chart labels its two halves ("In flight, from PRs" and "Ahead, if nothing
  changes") and its dashed line ("10 developers") instead of carrying a
  legend. Stripes
  for projected weeks were cut the same way.
- **The timeline is built for a hundred projects in flight.** Every live
  project shows, planned or not, since the load is the point; lanes fold,
  and remember it like every fold. A project with no plan is one line (its
  name, lead and open PRs), and a find box narrows the rows by name, label,
  lead or team while the load chart keeps counting everything. Planning one
  takes one gesture: its plus opens a chooser under the row (from the week
  its PRs began through the end of a coming month or quarter, the same
  calls Decide offers), or drag across its weeks on the timeline. Design it on the dummy board with
  `?projects=100`, not at a dozen rows. The header with the column names stays
  in place while the rows scroll, and month lines (quarter lines stronger)
  run through every row, so a span reads against the calendar anywhere on
  the page. A column name zooms that quarter or month to the full width;
  the toolbar zooms back out one step and pages to the period before or
  after, and the browser's Back does the same, since the zoom is in the URL.
- **Everything on the roadmap does what it names when clicked.** Nothing
  a planner would reach for is inert:
  - a week's bar in the load chart picks that week (arrow keys move the pick,
    Escape clears it), and the rows narrow to what was in flight or planned
    then, with the week banded through every row
  - the chart's counts filter to what they count ("94 with no plan"), and
    the developer count opens the teams
  - a column or month name zooms in; while zoomed, Today comes back
  - a plain click on a bar opens its editor, and only a drag moves it; on a
    project with no plan, a plain click opens the chooser, and only a drag
    plans it
  - a lead narrows to their work, a health word opens the updates, "after X"
    opens X, the milestone flag and a missed target open the project, the
    amber overrun opens the plan
  - a Now, next, later card, and the Plan cell in the project list, open
    the plan on the timeline
  The test for a new mark: what would someone expect clicking it to do?
  Build that.
- **The weeks ahead count what nobody decided.** A chart that counted only
  the plans after today would drop off a cliff at today and say the team
  frees up next week, when nothing says so. Instead every project still
  open with no decision keeps counting in the weeks ahead (a paler tint of
  the same colors), a plan still in flight past its end keeps counting, and
  parked, finished and dropped work stops. The only way to bring the
  future down is a decision, which is the point.
- **Decide is a list that empties.** With no product manager, the tool
  names the calls owed instead of waiting for someone to notice: new work
  with no decision, plans past their end, stalls, updates saying at risk
  or off track, work marked done or dropped whose PRs are still open, and
  parked work that moved. Each row says why it's there in words, and each
  call is one click that writes the roadmap: commit through the end of a
  coming month or quarter, park, finish, or drop (which asks twice). A
  decided row stays where it was, the same height, saying what was
  decided with a way to change it on the roadmap, so nothing vanishes
  unexplained and the next row never slides under the pointer between two
  clicks. The tab's label counts what's left, and `GET /api/v1/decide`
  lists the same rows for a script or a Claude session.
- **What a plan waits on is words on its row, not lines across the
  timeline**: "after Search reindex", or, amber, "starts before Shopify
  sync ends". Linear draws dependency lines, but ours would cross team
  lanes and every row between the two ends, and the row's words already
  say the one thing the planner acts on. The editor offers only choices
  that can be saved: never the item itself, dropped work, or a loop.
- **A team lane's load is one sentence in its header**: "at most 2 at once
  for 4 developers", counting its plans and its projects with no plan,
  amber once a week has as much in flight as the team has developers,
  because then at least one of them has one developer or none. With no effort
  estimates in this workflow, work in flight against people is the one
  honest measure; the planner judges the rest.
- **A plan's health is a word, amber only when someone owes something.**
  "On track" reads plain. "At risk", "Off track" and an overdue update are
  amber, because each asks someone to act: the planner to replan, the lead
  to post. Red stays CI's. An update keeps the plan as it stood, so the
  next one can say the end moved "2 weeks later" without anyone keeping a
  baseline by hand.
- **A comparison is words, not color.** Each count says how it compares with
  the same number of days just before ("4 more than the 30 days before").
  More merged isn't always good news, so no green or red.

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
  same way (WORD_GLOSS). The PR title is a door too: hovering the
  visible words previews the description, rendered and sanitized
  (markdown.ts, lazy chunk) — the "can I act on this?" read without
  leaving the board. Hover only, never click-pin: the title's click
  already means "open the PR". An empty description gets no door. A control that sits away from the thing it acts
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
