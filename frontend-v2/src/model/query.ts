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
 */
export function matchesQuery(p: DerivedPull, query: string): boolean {
   const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
   return terms.every(t => matchTerm(p, t));
}

function matchTerm(p: DerivedPull, term: string): boolean {
   const d = p.data;
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
         if (key === 'author') return d.user.login.toLowerCase().includes(val);
         // unknown key: treat the whole term as a plain substring below
      }
   }
   const bare = term.startsWith('#') ? term.slice(1) : term;
   if (/^\d+$/.test(bare)) return String(d.number).includes(bare);
   return (
      d.title.toLowerCase().includes(term) ||
      d.repo.toLowerCase().includes(term) ||
      d.user.login.toLowerCase().includes(term) ||
      d.labels.some(l => l.title.toLowerCase().includes(term))
   );
}
