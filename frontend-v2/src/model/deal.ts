import { pullKey } from '../format';
import { crSort } from './sort';
import { STARVE_DAYS, type DerivedPull } from './status';

/**
 * The review queue's one ranking. dealRank orders a pool by the same score
 * "Deal me one" uses — crSort's deterministic base re-ranked by urgency plus
 * two social signals crSort doesn't know about (have I reviewed this repo
 * before; does this author owe me one) — and dealFrom hands out the first
 * still-available entry of that order. The lane renders dealRank's output
 * verbatim, so the button always deals the top visible card that's still up
 * for grabs: the list and the button can't disagree.
 */

export interface DealRankOptions {
   me: string;
   /** the whole board's derived pulls (not just the queue) — familiarity and
    * reciprocity look across every repo/author the viewer touches, not only
    * the pulls up for grabs right now. */
   pulls: DerivedPull[];
   /** pulls to hand out only once everything else is gone (bot PRs): they still
    * need a reviewer, but shouldn't jump ahead of human work however old they
    * get. Ranked among themselves by the same signals. */
   deprioritize?: (p: DerivedPull) => boolean;
   /** the user's aging threshold (settings.ageWarnDays) — the urgency ramp for
    * not-yet-starved pulls normalizes against it, so raising the threshold
    * slows the ramp instead of leaving it pinned to the model default. */
   warnDays?: number;
}

/** Has `login` landed an active CR or QA stamp on this pull? */
function hasStamp(p: DerivedPull, login: string): boolean {
   return p.crBy.includes(login) || p.qaBy.includes(login);
}

/** Whether anyone has claimed this pull — a self-requested review, read
 * straight off the wire (pull.review_requests). Mirrors store.ts's claimFor;
 * duplicated rather than imported so this stays a pure model function
 * independent of the (browser-coupled) store module, like every other file
 * in model/. */
function isClaimed(p: DerivedPull): boolean {
   return (p.data.review_requests ?? []).some(r => r.self && r.login !== p.data.user.login);
}

/**
 * The score a candidate earns, higher is better:
 *  - urgency: a starved pull's starveScore (already age × size weighted), or
 *    for a fresh one, ageDays normalized against the starvation threshold —
 *    so a two-day-old pull still edges out a same-day one without needing to
 *    hit the starvation cliff first.
 *  - +2 familiarity: the viewer has stamped this repo before — less context
 *    to load before reviewing.
 *  - +2 reciprocity: this pull's author has stamped one of the viewer's own
 *    pulls — a nudge toward returning the favor.
 *  - +1 quick win: a known XS/S pull, a small bias toward clearing easy ones.
 */
function score(p: DerivedPull, opts: DealRankOptions): number {
   const urgency = p.starved ? p.starveScore : p.ageDays / (opts.warnDays ?? STARVE_DAYS);
   const repo = p.data.repo;
   const author = p.data.user.login;
   const familiar = opts.pulls.some(other => other.data.repo === repo && hasStamp(other, opts.me));
   const owedByAuthor = opts.pulls.some(
      other => other.data.user.login === opts.me && hasStamp(other, author)
   );
   const quickWin = p.sizeKnown && (p.weight === 'XS' || p.weight === 'S');
   const base = urgency + (familiar ? 2 : 0) + (owedByAuthor ? 2 : 0) + (quickWin ? 1 : 0);
   // a demoted pull (a bot's) sinks below every non-demoted one no matter how
   // old, but keeps its relative order among the other demoted ones
   return opts.deprioritize?.(p) ? base - 1000 : base;
}

/**
 * The whole pool in deal order: crSort establishes the deterministic base, a
 * stable re-sort by score (higher first) lifts the urgent/social picks, so a
 * scoring tie falls back to crSort's order and the same board always ranks
 * the same way — "best" is a real, reproducible answer, not a coin flip.
 */
export function dealRank(pool: DerivedPull[], opts: DealRankOptions): DerivedPull[] {
   const base = crSort(pool);
   return base
      .map((p, i) => ({ p, s: score(p, opts), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map(x => x.p);
}

/**
 * Deal the first still-available entry of an already-ranked list — skipping
 * anything claimed or already passed this sitting. Takes the *rendered* queue
 * (dealRank order, star-pinning and all) rather than re-ranking, so the card
 * dealt is by construction the top visible one still up for grabs.
 */
export function dealFrom(
   ranked: DerivedPull[],
   opts: {
      /** session-only: keys the viewer has already passed on this sitting. */
      passed: ReadonlySet<string>;
   }
): DerivedPull | null {
   for (const p of ranked) {
      const key = pullKey(p.data);
      if (opts.passed.has(key) || isClaimed(p)) continue;
      return p;
   }
   return null;
}
