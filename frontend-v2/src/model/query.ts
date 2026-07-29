import { authorOwnsIt, parked, rowNote } from './actions';
import type { DerivedPull } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import { isBotLogin } from '../../../shared/model/visibility';

/**
 * The filter box grammar. Bare terms AND-match as substrings across title,
 * repo, author, and labels; a bare number (or #number) matches the PR
 * number — the single most common search. Tokens narrow one field:
 *
 *   label:qae     any label contains "qae"
 *   status:ready  the derived status (spaces or dashes work: status:needs-cr)
 *   older:5       open at least 5 days (older:5d also accepted)
 *   repo:ifixit   repo name contains
 *   author:al     author login contains
 *   weight:xs,s   review-effort class, comma list ORs (weight:xs,s = XS or S)
 *   has:action    the viewer (`me`) has an imperative move on this card
 *   is:restamp    `me` owes a re-CR or re-QA on a reviewable pull
 *   is:blocked    status is dev_block or deploy_block
 *   is:bot        the author is a bot: the `[bot]` suffix OR a login named in
 *                 config.json's `bots` list (the caller's `extraBots` set) —
 *                 a query-layer bot check must agree with what the board
 *                 itself treats as a bot, or an active is:bot term narrows a
 *                 pool (app.tsx's CI/Ready bot pool included) to fewer PRs
 *                 than that pool actually holds
 *
 * `me` is the viewer's login, needed only for has:/is: — every other token
 * ignores it. `extraBots` is config.json's non-suffix bot logins (empty set
 * if the caller has none), needed only for is:bot. `names` is the optional
 * login → display-name map (model/names.ts): when present, author: and bare
 * terms match the human name too, so "metz" finds djmetzle.
 */
export function matchesQuery(
   p: DerivedPull,
   query: string,
   me: string,
   extraBots: ReadonlySet<string> = new Set(),
   names?: Readonly<Record<string, string | null>>
): boolean {
   const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
   return terms.every(t => matchTerm(p, t, me, extraBots, names));
}

function matchTerm(
   p: DerivedPull,
   term: string,
   me: string,
   extraBots: ReadonlySet<string>,
   names?: Readonly<Record<string, string | null>>
): boolean {
   const d = p.data;
   const authorName = names?.[d.user.login]?.toLowerCase() ?? '';
   const i = term.indexOf(':');
   if (i > 0) {
      const key = term.slice(0, i);
      const val = term.slice(i + 1);
      if (val) {
         if (key === 'label') return d.labels.some(l => l.title.toLowerCase().includes(val));
         if (key === 'status') return p.status.includes(val.replace(/[\s-]+/g, '_'));
         if (key === 'older') {
            const days = Number.parseInt(val, 10);
            return Number.isFinite(days) && p.ageDays >= days;
         }
         if (key === 'repo') return d.repo.toLowerCase().includes(val);
         if (key === 'author')
            return d.user.login.toLowerCase().includes(val) || authorName.includes(val);
         if (key === 'weight')
            return val.split(',').filter(Boolean).includes(p.weight.toLowerCase());
         if (key === 'has') return val === 'action' && rowNote(p, me).action != null;
         if (key === 'is') {
            // same gates as reviewerMove: no re-stamp is owed while the pull
            // is parked, a draft, dev-blocked, or red-CI
            if (val === 'restamp')
               return (
                  !parked(p) && !authorOwnsIt(p) && (p.recrBy.includes(me) || p.reqaBy.includes(me))
               );
            if (val === 'blocked') return p.status === 'dev_block' || p.status === 'deploy_block';
            if (val === 'draft') return p.status === 'draft';
            if (val === 'mine') return d.user.login.toLowerCase() === me.toLowerCase();
            if (val === 'bot') return isBotLogin(d.user.login, extraBots);
            // unrecognized is: value: fall through to the plain substring
            // match below, same as any other unknown key
         }
         // unknown key: treat the whole term as a plain substring below
      }
   }
   const bare = term.startsWith('#') ? term.slice(1) : term;
   if (/^\d+$/.test(bare)) return String(d.number).includes(bare);
   return (
      d.title.toLowerCase().includes(term) ||
      d.repo.toLowerCase().includes(term) ||
      d.user.login.toLowerCase().includes(term) ||
      (authorName !== '' && authorName.includes(term)) ||
      d.labels.some(l => l.title.toLowerCase().includes(term))
   );
}

/**
 * The same grammar over a CLOSED pull (raw PullData, no derived status). The
 * search lens runs this so a merged or closed PR is findable by the identity
 * terms people actually search on: bare text, #number, repo:, author:, label:,
 * is:bot, is:mine. Tokens that describe a live board state (status:, weight:,
 * older:, has:action, is:restamp/blocked/draft) can't hold on something already
 * closed, so a query using one deliberately excludes closed results rather than
 * matching them by accident. Bare terms and identity tokens match exactly as
 * matchTerm does for open pulls, so "offer" finds the same fields either side of
 * the open/closed line.
 */
export function matchesClosedQuery(
   pd: PullData,
   query: string,
   me: string,
   extraBots: ReadonlySet<string> = new Set(),
   names?: Readonly<Record<string, string | null>>
): boolean {
   const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
   return terms.every(t => matchClosedTerm(pd, t, me, extraBots, names));
}

/** State-only token keys: they read a live derivation a closed pull no longer
 * has, so a closed pull can never satisfy them. */
const OPEN_ONLY_KEYS = new Set(['status', 'weight', 'older', 'has']);

function matchClosedTerm(
   pd: PullData,
   term: string,
   me: string,
   extraBots: ReadonlySet<string>,
   names?: Readonly<Record<string, string | null>>
): boolean {
   const authorName = names?.[pd.user.login]?.toLowerCase() ?? '';
   const i = term.indexOf(':');
   if (i > 0) {
      const key = term.slice(0, i);
      const val = term.slice(i + 1);
      if (val) {
         if (key === 'repo') return pd.repo.toLowerCase().includes(val);
         if (key === 'author')
            return pd.user.login.toLowerCase().includes(val) || authorName.includes(val);
         if (key === 'label') return pd.labels.some(l => l.title.toLowerCase().includes(val));
         if (key === 'is') {
            if (val === 'bot') return isBotLogin(pd.user.login, extraBots);
            if (val === 'mine') return pd.user.login.toLowerCase() === me.toLowerCase();
            // is:restamp/blocked/draft describe an open pull's state
            return false;
         }
         if (OPEN_ONLY_KEYS.has(key)) return false;
         // unknown key: fall through to the substring match below
      }
   }
   const bare = term.startsWith('#') ? term.slice(1) : term;
   if (/^\d+$/.test(bare)) return String(pd.number).includes(bare);
   return (
      pd.title.toLowerCase().includes(term) ||
      pd.repo.toLowerCase().includes(term) ||
      pd.user.login.toLowerCase().includes(term) ||
      (authorName !== '' && authorName.includes(term)) ||
      pd.labels.some(l => l.title.toLowerCase().includes(term))
   );
}
