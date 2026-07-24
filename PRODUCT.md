# Pulldasher — Product Context

register: product

## What this is

A PR review hub for iFixit engineers: the between-tasks glance that answers
"what can I act on, and what's the best next pickup?" in under a second.
Used many times a day, briefly, by people who already know the codebase —
familiarity and speed over novelty, always.

## Users

iFixit engineers (~20 reviewers) triaging their review queue between tasks.
Desktop-first on wide monitors; both light and dark themes are first-class.
The dummy board (`npm run dev:dummy` in `frontend-v2/`) is the design bench.

## Design principles (in the owner's words)

- "A minimal UI that just feels like it was meant to work — but indicate
  things instead of hiding them." Subtle is good; invisible is a bug.
- "No news is good news." Healthy states show nothing at rest (the CI bar is
  invisible when green, revealed on hover). Color on the board means
  *look here* — if everything is quiet, everything is fine.
- Actionability first: the page answers "what's my move" before "what exists."
  Position (which section a card sits in) is the primary state encoding.
- Think Rams / Ive: the mark should *be* the thing it represents, self-evident
  without the legend. The legend documents the vocabulary; it must never be
  required to read it.

## Anti-references

- Badge soup: rows wearing 3+ colored chips each. v2 shipped this once and
  the owner's eyes "went right to the badges instead of the titles."
- Dashboard-as-fruit-salad: saturated status colors on every row.
- Private codes: abstract marks (colored squares) that need the legend.
- Anything that makes heavy/broken work the loudest thing on a board whose
  users are hunting the *easy* pickups.

## See also

DESIGN.md (the visual system as implemented), frontend-v2/src/styles.css
(tokens are the source of truth for values).
