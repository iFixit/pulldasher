import { crDone, qaDone, type DerivedPull } from '../model/status';
import type { PullData } from '../types';
import { closedEpoch, pullKey } from '../format';
import { EmptyState } from '../components/bits';
import { BoardColumn } from '../components/Column';
import { laneShown, Truncated } from '../components/Lane';
import { WordGroupRows } from '../components/WordGroups';
import { ClosedRow } from '../components/ClosedRow';
import type { RowOptions } from '../components/Row';

/**
 * The v1 board, faithfully: the same six overlapping columns, the same
 * predicates, the same sorts, straight from frontend/src/pulldasher/index.tsx
 * and pulldasher/sort.ts. A pull can appear in several columns at once and
 * empty columns stay visible — that spatial constancy is the muscle memory
 * this lens exists to preserve. Lanes and folds stay out on purpose; the ONE
 * v2 concept allowed in is the word sub-headers inside each column (the
 * owner asked for them here explicitly when badges died board-wide). Note
 * the axes deliberately differ: a column names a v1 predicate, the words
 * name the viewer's verb — so "AWAITING CR" can appear inside QA (v1's QA
 * column never required CR-done; QA runs in parallel). That overlap is v1
 * behavior made legible, not a grouping bug.
 */

// v1 predicate ports. Where v1 read raw wire fields (dev_block[0] with no
// active check), so does this — near-unchanged beats more-correct here.
const isDevBlocked = (p: DerivedPull) => !!p.data.status.dev_block[0];
const isDeployBlocked = (p: DerivedPull) => !!p.data.status.deploy_block[0];
const isDraft = (p: DerivedPull) => p.data.draft;
// v1 hasPassedCI(): every required status successful; no statuses and no
// required list counts as passed. ciVerdict encodes exactly that split.
const passedCI = (p: DerivedPull) => p.ci === 'success' || p.ci === 'none';
const metDeployReqs = (p: DerivedPull) => crDone(p) && qaDone(p) && passedCI(p);

const hasOutdatedSig = (p: DerivedPull, me: string) =>
   [...p.data.status.allCR, ...p.data.status.allQA].some(
      s => !s.data.active && s.data.user.login === me
   );
const hasCurrentSig = (p: DerivedPull, me: string) => p.crBy.includes(me) || p.qaBy.includes(me);

const cmp = (a: boolean, b: boolean) => Number(b) - Number(a);

/** v1 defaultCompare: mine, then my owed re-stamps, then untouched, then youngest. */
const defaultCompare = (me: string) => (a: DerivedPull, b: DerivedPull) =>
   cmp(a.data.user.login === me, b.data.user.login === me) ||
   cmp(hasOutdatedSig(a, me), hasOutdatedSig(b, me)) ||
   cmp(!hasCurrentSig(a, me), !hasCurrentSig(b, me)) ||
   b.data.created_at.localeCompare(a.data.created_at);

const qaCompare = (me: string) => (a: DerivedPull, b: DerivedPull) =>
   cmp(a.qaingLogin === me, b.qaingLogin === me) ||
   cmp(!a.externalBlock, !b.externalBlock) ||
   cmp(!a.conflict, !b.conflict) ||
   cmp(!a.qaingLogin, !b.qaingLogin) ||
   cmp(crDone(a), crDone(b)) ||
   b.data.created_at.localeCompare(a.data.created_at);

const deployCompare = (a: DerivedPull, b: DerivedPull) => cmp(!a.conflict, !b.conflict);

function Column({
   title,
   pulls,
   opts,
   defaultOpen = true,
}: {
   title: string;
   pulls: DerivedPull[];
   opts: RowOptions;
   defaultOpen?: boolean;
}) {
   // v1's sort already floats the viewer's own concerns to the top (your PRs,
   // an owed re-stamp, a QA you're running), so within each rowWord group the
   // order stays v1-faithful — WordGroupRows only re-buckets by word, it
   // doesn't re-sort.
   return (
      <BoardColumn count={pulls.length} header={title} defaultOpen={defaultOpen}>
         <WordGroupRows
            pulls={pulls}
            opts={opts}
            id={`classic:${title}`}
            cap={laneShown(15, opts)}
         />
      </BoardColumn>
   );
}

/** v1's Recently Closed panel, honored for ?closed=1 bookmarks. */
function ClosedColumn({ pulls, opts }: { pulls: PullData[]; opts: RowOptions }) {
   const ordered = [...pulls].sort((a, b) => closedEpoch(b) - closedEpoch(a));
   return (
      <BoardColumn count={pulls.length} header="Recently Closed">
         <Truncated cap={laneShown(30, opts)} id="classic:closed">
            {ordered.map(p => (
               <ClosedRow key={pullKey(p)} pull={p} lastSeen={opts.lastSeen} />
            ))}
         </Truncated>
      </BoardColumn>
   );
}

export function Classic({
   pulls,
   opts,
   collapsed,
   closed,
}: {
   pulls: DerivedPull[];
   opts: RowOptions;
   /** v1 ?cr=0-style column collapse flags from a legacy URL */
   collapsed?: Set<string>;
   /** closed pulls to show when a legacy URL asked for ?closed=1 */
   closed?: PullData[] | null;
}) {
   const me = opts.me;
   if (!pulls.length && !closed?.length) {
      return <EmptyState title="Workbench clear" sub="No open PRs in this scope." />;
   }
   const base = [...pulls].sort(defaultCompare(me));

   const ciBlocked = base.filter(p => !isDevBlocked(p) && !passedCI(p) && !isDraft(p));
   const deployBlocked = base
      .filter(
         p =>
            metDeployReqs(p) &&
            !isDevBlocked(p) &&
            (isDeployBlocked(p) || p.conflict || p.dependent)
      )
      .sort(deployCompare);
   const ready = base.filter(
      p =>
         metDeployReqs(p) &&
         !isDraft(p) &&
         !isDevBlocked(p) &&
         !isDeployBlocked(p) &&
         !p.conflict &&
         !p.dependent
   );
   const devBlocked = base.filter(p => isDevBlocked(p) || isDraft(p));
   const needsCr = base.filter(p => !crDone(p) && !isDevBlocked(p) && !isDraft(p));
   const needsQa = base
      .filter(p => !qaDone(p) && !isDevBlocked(p) && !isDraft(p) && !p.conflict && passedCI(p))
      .sort(qaCompare(me));

   // ids match v1's column collapse params (?ci=0&cr=0…) so old URLs map 1:1
   const columns: [string, string, DerivedPull[]][] = [
      ['ci', 'CI Blocked', ciBlocked],
      ['dep', 'Deploy Blocked', deployBlocked],
      ['ready', 'Ready', ready],
      ['dev', 'Dev Blocked', devBlocked],
      ['cr', 'CR', needsCr],
      ['qa', 'QA', needsQa],
   ];

   return (
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
         {columns.map(([id, title, list]) => (
            <Column
               key={id}
               title={title}
               pulls={list}
               opts={opts}
               defaultOpen={!collapsed?.has(id)}
            />
         ))}
         {closed && <ClosedColumn pulls={closed} opts={opts} />}
      </div>
   );
}
