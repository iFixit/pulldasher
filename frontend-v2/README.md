# Pulldasher frontend v2

A reviewer-centric frontend that answers "what should I act on next?" instead
of rendering seven flat columns. It runs beside the classic board: the server
serves v1 at `/` and v2 at `/v2`, both fed by the same socket protocol
(`initialize` + `pullChange`), so nothing about the backend or DB changes.

## Ideas

- **One pull, one status.** `src/model/status.ts` derives a single mutually
  exclusive status per pull (draft > dev_block > ci_red > needs_recr >
  needs_cr > needs_qa > deploy_block > ci_pending > unmergeable > ready)
  instead of v1's overlapping column predicates. The three flavors of
  "blocked" are separate statuses because they mean opposite things: a dev
  block is the author's move, a deploy hold is done-but-don't-ship, and
  unmergeable is a rebase.
- **Yours to do.** The Review tab opens with every action that's yours —
  re-stamps you owe (CR and QA), your merge buttons, your CI fixes —
  regardless of who authored the pull. `src/model/actions.ts` is the single
  source for "whose move is it", shared with My work.
- **One item, one order, everywhere.** Every lens renders the same card:
  avatar and full-width title on top, one meta line below (status, repo,
  context, flags) ending in a fixed metric rail — review effort, then CR and
  QA sign-off pips, then age — right-anchored so the rail reads as vertical
  columns down any board. Giving the title its own line is what lets a long
  title wrap cleanly and what lets the whole thing reflow to a phone;
  Classic keeps its columns, but the card inside them is the same one the
  lanes use. The whole card is a click target (the title link stretches over
  it), so a click anywhere opens the PR.
- **The re-stamp lane.** Inactive CR/QA signatures (invalidated by a push)
  are already on the wire; a pull that was reviewed and fixed but lacks a
  fresh stamp is the cheapest review on the board, so it leads. Sign-off is a
  pip meter — one square per required stamp: filled green is a live stamp,
  amber is a stamp a push invalidated (a re-stamp is owed, the board's most
  actionable state), hollow is still needed. A dotted underline marks a slot
  you stamped; clicking the pips lists who signed and when. No check glyph, no
  slash — the fill is the whole vocabulary.
- **Review effort, always shown.** A five-segment meter (light to heavy,
  color-ramped) rides the rightmost rail of every row, so "can I fit this in
  the time I have" reads without opening the diff. A cheap prior from diff
  size; humans override by reading.
- **A queue that ranks the right thing.** `src/model/sort.ts` scores by
  weight, then boosts pulls one stamp from done and credits age, so an old M
  outranks a fresh S before the starvation cliff. Thresholds are tuned to
  the shop's measured cadence (median first review under 2 hours, p90 ~4
  days): ages show hours under a day, heat amber past 4 days and red past
  10, with both clocks in the tooltip. "Iterating" keys on the push clock,
  not updated_at, so a reviewer's comment can't sink a pull down the queue.
- **Five lenses, one filter.** Review / My work / People (person or team
  drill-down) / Classic / Stats, over the same pool. The whole view — lens,
  query, scope, toggles — lives in the URL hash: any board is pasteable and a
  bookmark is a saved view. The text filter understands `#number`, `label:x`,
  `status:x`, `older:5`, `repo:x`, and `author:x`.
- **The Stats lens.** The board's shape and its review economics: the open
  breakdown as a stacked bar, CR and QA leaderboards (distinct PRs signed off,
  over the current pool), who's waiting longest for CR by author, and time to
  merge by diff-size class over the closed window. It moves with the scope, so
  scoping to a team makes these that team's numbers. `src/model/stats.ts` is
  the aggregation layer; the cards are pure presentational.
- **Settings.** A cog opens a right-side panel for the knobs that are personal
  taste, not team policy or model math: theme (system/light/dark), row
  density, default view, the age-color thresholds (amber/red days, display
  only), the glance guard (how many attended seconds count as a look) plus a
  one-click "mark everything as seen", your drafts and cryo defaults, and the
  Repo Manager (mute/unmute repos, unhide org-hidden ones). Persisted
  per-browser in `src/settings.ts`. Org-level repo hides come from the
  server's `hideByDefault` repo spec — the read-only baseline you override.
- **One visibility model: muted vs in-scope, override for now.** Scope
  (include) and mute (exclude) aren't rival mechanisms — scope is "which
  slice am I focused on", mute is "repos I never want to see", and a session
  act (a scope, a `repo:` term, a reveal) overrides a mute for right now.
  Three parties vote in a fixed order — org baseline (`hideByDefault` + cryo),
  your durable prefs (muted repos, drafts default), then the session (URL) —
  with session-explicit beating a durable mute. It all lives behind one
  **Filters** control whose trigger is the active-filter summary (the standing
  answer to "what's hidden right now"): tabs for Repos (include checkbox +
  mute icon per row, muted/org-hidden collapsed with a reveal), People (teams +
  authors), and Drafts (Mine/All — your own drafts always show). The durable
  editor is the Settings **Repo Manager** (muted / org-hidden / on-your-board).
  `src/model/visibility.ts` decides a repo's baseline state; the old separate
  Scope popover and eye/Hidden selector folded into this. Session reveal still
  rides the URL as `#show=cryo,someRepo`; `#drafts=all` overrides your default.
- **Classic is v1, faithfully.** The same six overlapping columns
  (CI Blocked / Deploy Blocked / Ready / Dev Block / CR / QA), predicates
  and sorts ported line-for-line from v1, for anyone whose muscle memory
  lives there.
- **Changed since your last look.** A last-seen marker in localStorage,
  stamped when you leave (pagehide) and only after ~45 visible seconds, so a
  glance at another tab can't erase the weekend's delta. Solid dot = new PR,
  ring = updated; opening a PR clears its dot. What changed is a **lane** in
  Review (newest first), not a bar toggle — it collects the delta at the top
  the way "Yours to do" collects your actions, rather than filtering the board.
  A slim banner still counts the PRs merged or closed while you were away.
- **Keyboard:** `/` filter, `j`/`k` walk rows, `Enter` opens, `c` copies the
  focused row's branch.

## Running it

```bash
cd frontend-v2
npm install
npm run dev          # against a local backend on :3000 (proxies /token + socket)
npm run dev:dummy    # no backend: v1's dummy-pulls.json fixture
npm run build        # type-check + bundle to frontend-v2/dist (served at /v2)
npm test             # vitest: status, sort, query, and legacy-URL unit tests
```

## Site config

Copy `public/config.example.json` to `public/config.json` (gitignored) for
deployment-specific settings:

- `teams` — GitHub team slugs with member logins. Powers the team chips on
  the People lens and the scope presets; without it those features quietly
  disappear. Long-term this belongs in the backend (fetch org teams via the
  existing Octokit client and ship them with the socket handshake).
- `bots` — machine-account logins to fold into the bot-PRs group. Accounts
  with GitHub's `[bot]` suffix are detected without config.

## v1 bookmark compatibility

v1 saved its settings in the query string, and years of bookmarks encode
them. A URL with any v1 param (`repo`, `author`, `cryo`, `drafts`,
`external_block`, `personal`, `closed`, or the `ci`/`dep`/`ready`/`dev`/
`cr`/`qa` column-collapse flags) opens the Classic lens configured the same
way, v1 defaults included (other people's drafts hidden unless `drafts=1`,
`closed=1` shows the Recently Closed column). A dismissible chip names what
the bookmark applied. `src/legacy.ts` owns the translation. (v2's own board
lens `#lens=board` merged into Classic; old links redirect.)

## Known gaps (backend additions v2 could use)

- **Comment/review activity isn't on the wire** — cues like "X commented 2h
  ago" need the server to include recent comment metadata in `toObject()`.
- **Teams over the handshake** instead of a static file (see above).
- **`changed_files`** is stored in the DB but not sent; the review-effort
  meter falls back to size-only until it is, and the Stats merge-time chart
  drops PRs missing `additions`/`deletions`.
- **Stats are windowed, not historical.** Leaderboards and merge-time only see
  the open pool plus the server's 14-day closed window, so they read "lately",
  not "all time". Career totals would need the server to expose more history.
- **Desktop notifications** aren't ported yet.
