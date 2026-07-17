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
- **Four lenses, one filter.** Review / My work / People (person or team
  drill-down) / Classic, over the same pool, with a single saved Scope
  (repos + people, with GitHub-team presets). The whole view — lens, query,
  scope, toggles — lives in the URL hash: any board is pasteable and a
  bookmark is a saved view. The filter understands `#number`, `label:x`,
  `status:x`, `older:5`, `repo:x`, and `author:x`.
- **Classic is v1, faithfully.** The same six overlapping columns
  (CI Blocked / Deploy Blocked / Ready / Dev Block / CR / QA), predicates
  and sorts ported line-for-line from v1, for anyone whose muscle memory
  lives there.
- **Changed since your last look.** A last-seen marker in localStorage,
  stamped when you leave (pagehide) and only after ~45 visible seconds, so a
  glance at another tab can't erase the weekend's delta. Solid dot = new PR,
  ring = updated; opening a PR clears its dot. A persistent `● changed N`
  toggle sits in the filter row (not just the arrival banner) to narrow the
  board to those PRs, and the banner also counts merges while you were away.
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
  meter falls back to size-only until it is.
- **CR leaderboard** (v1's leader-list) and **desktop notifications** aren't
  ported yet.
