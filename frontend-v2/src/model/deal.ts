import { pullKey } from '../format';
import { crSort } from './sort';
import { STARVE_DAYS, type DerivedPull } from './status';

/**
 * "Deal me one": pick the single best pull to review right now out of an
 * already-scoped queue, so a reviewer who doesn't want to browse can just hit
 * a button. Not a replacement for crSort's ordering — it layers two social
 * signals crSort doesn't know about (have I reviewed this repo before; does
 * this author owe me one) on top of it, then breaks ties by crSort's own
 * order so two reviewers with an identical board always land on the same
 * pull.
 */

export interface DealOptions {
   me: string;
   /** the whole board's derived pulls (not just the queue) — familiarity and
    * reciprocity look across every repo/author the viewer touches, not only
    * the pulls up for grabs right now. */
   pulls: DerivedPull[];
   claims: Readonly<Record<string, { login: string; at: number }>>;
   /** session-only: keys the viewer has already passed on this sitting. */
   passed: ReadonlySet<string>;
}

/** Has `login` landed an active CR or QA stamp on this pull? */
function hasStamp(p: DerivedPull, login: string): boolean {
   return p.crBy.includes(login) || p.qaBy.includes(login);
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
function score(p: DerivedPull, opts: DealOptions): number {
   const urgency = p.starved ? p.starveScore : p.ageDays / STARVE_DAYS;
   const repo = p.data.repo;
   const author = p.data.user.login;
   const familiar = opts.pulls.some(other => other.data.repo === repo && hasStamp(other, opts.me));
   const owedByAuthor = opts.pulls.some(
      other => other.data.user.login === opts.me && hasStamp(other, author)
   );
   const quickWin = p.sizeKnown && (p.weight === 'XS' || p.weight === 'S');
   return urgency + (familiar ? 2 : 0) + (owedByAuthor ? 2 : 0) + (quickWin ? 1 : 0);
}

/**
 * Best next pull from `queue` (Review's already-filtered reviewable list),
 * excluding anything claimed or already passed this sitting. Ties broken by
 * crSort's own order, so the same board always deals the same pull first —
 * "best" is a real, reproducible answer, not a coin flip.
 */
export function dealOne(queue: DerivedPull[], opts: DealOptions): DerivedPull | null {
   // store.ts's claimFor does the same lookup; duplicated rather than
   // imported so this stays a pure model function independent of the
   // (browser-coupled) store module, like every other file in model/.
   const candidates = queue.filter(p => {
      const key = pullKey(p.data);
      if (opts.passed.has(key)) return false;
      if (opts.claims[key]) return false;
      return true;
   });
   if (!candidates.length) return null;

   // crSort first: establishes the deterministic base order a scoring tie
   // falls back to (only a strictly higher score displaces the current best).
   const ordered = crSort(candidates);
   let best = ordered[0];
   let bestScore = score(best, opts);
   for (const p of ordered.slice(1)) {
      const s = score(p, opts);
      if (s > bestScore) {
         best = p;
         bestScore = s;
      }
   }
   return best;
}
