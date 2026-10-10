import { hasReviewRequest } from './reviewers';
import { CR_INCOMPLETE, type DerivedPull } from '../../../shared/model/status';
import { isSuffixBot } from '../../../shared/model/visibility';

/**
 * Turn rotation: a starved, CR-incomplete pull with no claim still needs
 * someone to pick it up. Rather than a server-assigned queue, every client
 * computes the same "whose turn" answer independently, so there's no round
 * trip and nothing to keep in sync.
 *
 * Who gets named is the best-fit reviewer, not just a hash: the pick leans on
 * the same reciprocity signal deal.ts ranks pulls by — someone the pull's
 * author has reviewed before is owed a look back, so they lead. (Repo
 * familiarity can't separate candidates here: the pool IS everyone who CR's
 * this repo, so they're all familiar.) When nobody's specifically owed, or
 * several are, a deterministic djb2 hash of the pull's key spreads the pick
 * across pulls so it isn't always the same name.
 */

/** djb2: a tiny, deterministic string hash — good enough for picking an
 * index into a small pool, not for anything security-sensitive. */
function djb2(s: string): number {
   let h = 5381;
   for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
   return h >>> 0;
}

/**
 * Per repo, the sorted unique logins holding ANY CR signature — active or
 * stale — on any pull of that repo. Stale counts because a re-review is
 * still a review: someone who has CR'd this repo before is fair game for the
 * rotation even if their stamp on this particular pull went stale. Bots
 * excluded (isSuffixBot is enough here, same as model/status.ts's
 * engagedNoStamp — this module has no reason to depend on the org's
 * configured `bots` list).
 */
export function buildReviewerPools(pulls: DerivedPull[]): Map<string, string[]> {
   const byRepo = new Map<string, Set<string>>();
   for (const p of pulls) {
      const set = byRepo.get(p.data.repo) ?? new Set<string>();
      for (const sig of p.data.status.allCR) {
         const login = sig.data.user.login;
         if (!isSuffixBot(login)) set.add(login);
      }
      byRepo.set(p.data.repo, set);
   }
   const pools = new Map<string, string[]>();
   for (const [repo, set] of byRepo) pools.set(repo, [...set].sort());
   return pools;
}

const TURN_STATUSES = CR_INCOMPLETE;

/**
 * Whose turn it is on this pull, or null when there's no rotation to name:
 * not starved, not CR-incomplete, or an empty pool once the author and anyone
 * already carrying an active CR stamp are excluded. Deterministic — the same
 * board picks the same login on every client, with no state to agree on.
 *
 * `pulls` is the whole board, read for the reciprocity signal (who the author
 * has reviewed before). A claim on the pull supersedes this at the CALLER's
 * level (Row, rowNote's withCoordination, notifications) — turnFor itself
 * knows nothing about claims.
 */
export function turnFor(
   p: DerivedPull,
   pools: ReadonlyMap<string, string[]>,
   pulls: readonly DerivedPull[]
): string | null {
   // a parked (Cryogenic Storage) pull asks nothing of anyone, so it never
   // enters the rotation, starved or not
   if (p.cryo || !p.starved || !TURN_STATUSES.includes(p.status)) return null;
   // An explicit GitHub review request answers "whose turn" authoritatively —
   // don't also rotate a name onto the pull, or the board would tell someone
   // it's their turn on a PR GitHub already routed to a specific reviewer.
   if (hasReviewRequest(p)) return null;
   const pool = pools.get(p.data.repo);
   if (!pool || !pool.length) return null;
   const author = p.data.user.login;
   const candidates = pool.filter(login => login !== author && !p.crBy.includes(login));
   if (!candidates.length) return null;

   // Reciprocity: tag every candidate the author has already reviewed (an
   // active CR or QA stamp on a PR that candidate authored). One board pass,
   // not one per candidate. Those are owed a look back, so they form the
   // preferred tier; if none qualify, everyone's fair game.
   const candSet = new Set(candidates);
   const owed = new Set<string>();
   for (const o of pulls) {
      const a = o.data.user.login;
      if (candSet.has(a) && (o.crBy.includes(author) || o.qaBy.includes(author))) owed.add(a);
   }
   const tier = candidates.filter(c => owed.has(c));
   const pick = tier.length ? tier : candidates;

   // deterministic spread across pulls so equally-good candidates share the load
   const idx = djb2(`${p.data.repo}#${p.data.number}`) % pick.length;
   return pick[idx];
}
