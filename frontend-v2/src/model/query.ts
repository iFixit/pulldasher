import { authorOwnsIt, parked, rowNote } from './actions';
import type { DerivedPull } from './status';

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
 *
 * `me` is the viewer's login, needed only for has:/is: — every other token
 * ignores it. `names` is the optional login → display-name map (model/
 * names.ts): when present, author: and bare terms match the human name too,
 * so "metz" finds djmetzle.
 */
export function matchesQuery(
   p: DerivedPull,
   query: string,
   me: string,
   names?: Readonly<Record<string, string | null>>
): boolean {
   const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
   return terms.every(t => matchTerm(p, t, me, names));
}

function matchTerm(
   p: DerivedPull,
   term: string,
   me: string,
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
            return false;
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
