# Pulldasher frontend v2

A reviewer-centric frontend that answers "what should I act on next?" instead
of rendering seven flat columns. It runs beside the classic board: the server
serves v1 at `/` and v2 at `/v2`, both fed by the same socket protocol
(`initialize` + `pullChange`), so nothing about the backend or DB changes.

## Ideas

- **One pull, one status.** `src/model/status.ts` derives a single mutually
  exclusive status per pull (draft > blocked > ci_red > needs_recr >
  needs_cr > needs_qa > ready) instead of v1's overlapping column predicates.
- **The re-stamp lane.** Inactive CR signatures (invalidated by a push) are
  already on the wire; a pull that was reviewed and fixed but lacks a fresh
  stamp is the cheapest review on the board, so it leads.
- **Three lenses, one filter.** For you / People / Teams over the same pool,
  with a single saved Scope (repos + people, with GitHub-team presets).
- **Changed since your last look.** A last-seen marker in localStorage; rows
  updated after it get a tick, and a banner offers "show only changes".

## Running it

```bash
cd frontend-v2
npm install
npm run dev          # against a local backend on :3000 (proxies /token + socket)
npm run dev:dummy    # no backend: v1's dummy-pulls.json fixture
npm run build        # type-check + bundle to frontend-v2/dist (served at /v2)
npm test             # vitest: status-derivation and CI-verdict unit tests
```

## Teams config

Copy `public/teams.example.json` to `public/teams.json` (gitignored) and list
GitHub team slugs with member logins. It powers the Teams lens and the scope
presets; without it those features quietly disappear. Long-term this belongs
in the backend (fetch org teams via the existing Octokit client and ship them
with the socket handshake).

## Known gaps (backend additions v2 could use)

- **Comment/review activity isn't on the wire** — cues like "X commented 2h
  ago" need the server to include recent comment metadata in `toObject()`.
- **Teams over the handshake** instead of a static file (see above).
- **`changed_files`** is stored in the DB but not sent; the review-weight
  chip falls back to size-only until it is.
