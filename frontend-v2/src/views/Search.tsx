import type { ReactNode } from 'react';
import { closedEpoch, pullKey } from '../../../shared/format';
import type { DerivedPull } from '../../../shared/model/status';
import type { PullData } from '../../../shared/types';
import { matchesClosedQuery, matchesQuery } from '../model/query';
import { EmptyState } from '../components/bits';
import { ClosedRow } from '../components/ClosedRow';
import { GroupHeader, Rows } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';

/**
 * The find surface. The header box's other filters (Repos / People / Weight /
 * State) NARROW the lens you're on; free text is a different job, FINDING a pull
 * you know exists, and it needs its own place. So typing anything switches the
 * board to this lens (app.tsx), which searches every pull the board knows about,
 * open and closed, ignoring the current lens, the folds, and even the hidden
 * rules. That last part is the point: Danny's "offer" PR was a real match sitting
 * collapsed inside Blocked, invisible; here nothing is folded or capped, so a
 * match can't hide.
 *
 * Results are the board's own rows (a closed pull uses ClosedRow), grouped by
 * state in board order, because position is how this board says "where does
 * this stand" and a flat list would throw that away. The group a hit lands in
 * answers the "which section is it in?" question for free.
 */

type StatusGroup = { label: string; has: (p: DerivedPull) => boolean };

// Each open hit lands in the first group it matches; board-intuitive order.
const OPEN_GROUPS: StatusGroup[] = [
   { label: 'Ready to merge', has: p => p.status === 'ready' },
   { label: 'Needs review', has: p => p.status === 'needs_cr' || p.status === 'needs_recr' },
   { label: 'Needs QA', has: p => p.status === 'needs_qa' },
   { label: 'CI failing', has: p => p.status === 'ci_red' },
   { label: 'CI running', has: p => p.status === 'ci_pending' },
   { label: 'Blocked', has: p => p.status === 'dev_block' || p.status === 'deploy_block' },
   { label: 'Conflicts', has: p => p.status === 'unmergeable' },
   { label: 'Drafts', has: p => p.status === 'draft' },
];

export function Search({
   pulls,
   closed,
   query,
   opts,
   extraBots,
   names,
}: {
   /** the whole open board, unfiltered: search is global, hidden repos included */
   pulls: DerivedPull[];
   closed: PullData[];
   query: string;
   opts: RowOptions;
   extraBots: ReadonlySet<string>;
   names: Readonly<Record<string, string | null>>;
}) {
   const me = opts.me;
   const q = query.trim();

   if (!q) {
      return (
         <EmptyState
            variant="search"
            title="Search every PR"
            sub="Find any open or closed pull by title, repo, #number, author, or label. Tokens like repo:, author:, and is:bot narrow it."
         />
      );
   }

   const openHits = pulls
      .filter(p => matchesQuery(p, query, me, extraBots, names))
      .sort((a, b) => b.data.created_at.localeCompare(a.data.created_at));
   const closedHits = closed
      .filter(p => matchesClosedQuery(p, query, me, extraBots, names))
      .sort((a, b) => closedEpoch(b) - closedEpoch(a));
   const total = openHits.length + closedHits.length;

   if (total === 0) {
      return (
         <EmptyState
            variant="search"
            title={`No PR matches “${q}”`}
            sub="Nothing open or closed matched. Try fewer words, or a #number."
         />
      );
   }

   // first-match assignment; anything a future status wouldn't hit collects in a
   // trailing "Open" catch-all rather than dropping out of the results
   const grouped = OPEN_GROUPS.map(g => ({ label: g.label, list: [] as DerivedPull[] }));
   const other: DerivedPull[] = [];
   for (const p of openHits) {
      const g = OPEN_GROUPS.findIndex(gr => gr.has(p));
      if (g === -1) other.push(p);
      else grouped[g].list.push(p);
   }

   const section = (label: string, count: number, rows: ReactNode) => (
      <section key={label} className={opts.compact ? 'mb-4' : 'mb-7'}>
         <GroupHeader title={label} count={count} compact={opts.compact} />
         <Rows>{rows}</Rows>
      </section>
   );

   return (
      <>
         <div className="mb-5">
            <h2 className="m-0 text-base leading-snug font-semibold text-ink">Search</h2>
            <p className="mt-0.5 text-xs text-ink-3">
               {total} {total === 1 ? 'match' : 'matches'} for “{q}” across open and closed PRs
            </p>
         </div>
         {grouped.map(g =>
            g.list.length
               ? section(
                    g.label,
                    g.list.length,
                    g.list.map(p => <Row key={pullKey(p.data)} pull={p} opts={opts} />)
                 )
               : null
         )}
         {other.length > 0 &&
            section(
               'Open',
               other.length,
               other.map(p => <Row key={pullKey(p.data)} pull={p} opts={opts} />)
            )}
         {closedHits.length > 0 &&
            section(
               'Recently closed',
               closedHits.length,
               closedHits.map(p => <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />)
            )}
      </>
   );
}
