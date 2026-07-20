import { hasReviewRequest } from './reviewers';
import type { DerivedPull, Status } from './status';
import { isBotLogin } from './visibility';

/**
 * Turn rotation: a starved, CR-incomplete pull with no claim still needs
 * someone to pick it up. Rather than a server-assigned queue, every client
 * computes the same "whose turn" answer independently — a pure hash of the
 * pull's key over its repo's reviewer pool. Same inputs (the board's CR
 * signatures, the pull's repo/number) → same name on every client, with no
 * round trip and nothing to keep in sync.
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
 * excluded (isBotLogin's suffix check is enough here, same as
 * model/status.ts's engagedNoStamp — this module has no reason to depend on
 * config.json's `bots` list).
 */
export function buildReviewerPools(pulls: DerivedPull[]): Map<string, string[]> {
   const byRepo = new Map<string, Set<string>>();
   for (const p of pulls) {
      const set = byRepo.get(p.data.repo) ?? new Set<string>();
      for (const sig of p.data.status.allCR) {
         const login = sig.data.user.login;
         if (!isBotLogin(login, new Set())) set.add(login);
      }
      byRepo.set(p.data.repo, set);
   }
   const pools = new Map<string, string[]>();
   for (const [repo, set] of byRepo) pools.set(repo, [...set].sort());
   return pools;
}

const TURN_STATUSES: Status[] = ['needs_cr', 'needs_recr'];

/**
 * Whose turn it is on this pull, or null when there's no rotation to name:
 * not starved, not CR-incomplete, or an empty pool once the author and
 * anyone already carrying an active CR stamp are excluded. Deterministic —
 * hash(`${repo}#${number}`) modulo the (already-excluded) pool picks the
 * same login on every client for the same pull, every time, with no state to
 * agree on.
 *
 * A claim on the pull supersedes this at the CALLER's level (Row, rowNote's
 * withCoordination, notifications) — turnFor itself knows nothing about
 * claims.
 */
export function turnFor(p: DerivedPull, pools: ReadonlyMap<string, string[]>): string | null {
   if (!p.starved || !TURN_STATUSES.includes(p.status)) return null;
   // An explicit GitHub review request answers "whose turn" authoritatively —
   // don't also rotate a name onto the pull, or the board would tell someone
   // it's their turn on a PR GitHub already routed to a specific reviewer.
   if (hasReviewRequest(p)) return null;
   const pool = pools.get(p.data.repo);
   if (!pool || !pool.length) return null;
   const author = p.data.user.login;
   const candidates = pool.filter(login => login !== author && !p.crBy.includes(login));
   if (!candidates.length) return null;
   const idx = djb2(`${p.data.repo}#${p.data.number}`) % candidates.length;
   return candidates[idx];
}
