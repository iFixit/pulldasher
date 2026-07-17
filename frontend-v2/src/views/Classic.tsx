import { crDone, qaDone, type DerivedPull } from '../model/status';
import type { PullData } from '../types';
import { ago, pullKey } from '../format';
import { EmptyState } from '../components/bits';
import { CardShell } from '../components/Card';
import { BoardColumn } from '../components/Column';
import { Truncated } from '../components/Lane';
import { Row, type RowOptions } from '../components/Row';

/**
 * The v1 board, faithfully: the same six overlapping columns, the same
 * predicates, the same sorts, straight from frontend/src/pulldasher/index.tsx
 * and pulldasher/sort.ts. A pull can appear in several columns at once and
 * empty columns stay visible — that spatial constancy is the muscle memory
 * this lens exists to preserve. New concepts (lanes, one-status-per-pull,
 * folds) stay out of here on purpose.
 */

// v1 predicate ports. Where v1 read raw wire fields (dev_block[0] with no
// active check), so does this — near-unchanged beats more-correct here.
const devBlock = (p: DerivedPull) => !!p.data.status.dev_block[0];
const deployBlock = (p: DerivedPull) => !!p.data.status.deploy_block[0];
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
   cmp(a.qaingBy === me, b.qaingBy === me) ||
   cmp(!a.externalBlock, !b.externalBlock) ||
   cmp(!a.conflict, !b.conflict) ||
   cmp(!a.qaingBy, !b.qaingBy) ||
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
   return (
      <BoardColumn count={pulls.length} header={title} defaultOpen={defaultOpen} empty="none">
         {/* a 60-row CR column is a 3600px scroll: cap it, keep the count honest */}
         <Truncated cap={15} id={`classic:${title}`}>
            {pulls.map(p => (
               <Row key={pullKey(p.data)} pull={p} opts={{ ...opts, compact: true }} />
            ))}
         </Truncated>
      </BoardColumn>
   );
}

/** The closed card shares the column card's two-zone anatomy. */
function ClosedCard({ pull }: { pull: PullData }) {
   const merged = !!pull.merged_at;
   const closedAt = Date.parse(pull.closed_at ?? pull.updated_at) / 1000;
   return (
      <CardShell
         login={pull.user.login}
         repo={pull.repo}
         number={pull.number}
         title={pull.title}
         right={
            <>
               <span
                  className="font-medium"
                  style={{ color: merged ? 'var(--ok)' : undefined }}
                  title={merged ? 'merged' : 'closed without merging'}
               >
                  {merged ? 'Merged' : 'Closed'}
               </span>
               <span className="w-16 text-right tabular-nums">{ago(closedAt)} ago</span>
            </>
         }
      />
   );
}

/** v1's Recently Closed panel, honored for ?closed=1 bookmarks. */
function ClosedColumn({ pulls }: { pulls: PullData[] }) {
   const ordered = [...pulls].sort(
      (a, b) => Date.parse(b.closed_at ?? b.updated_at) - Date.parse(a.closed_at ?? a.updated_at)
   );
   return (
      <BoardColumn count={pulls.length} header="Recently Closed" empty="none">
         {ordered.map(p => (
            <ClosedCard key={pullKey(p)} pull={p} />
         ))}
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

   const ciBlocked = base.filter(p => !devBlock(p) && !passedCI(p) && !isDraft(p));
   const deployBlocked = base
      .filter(
         p => metDeployReqs(p) && !devBlock(p) && (deployBlock(p) || p.conflict || p.dependent)
      )
      .sort(deployCompare);
   const ready = base.filter(
      p =>
         metDeployReqs(p) &&
         !isDraft(p) &&
         !devBlock(p) &&
         !deployBlock(p) &&
         !p.conflict &&
         !p.dependent
   );
   const devBlocked = base.filter(p => devBlock(p) || isDraft(p));
   const needsCr = base.filter(p => !crDone(p) && !devBlock(p) && !isDraft(p));
   const needsQa = base
      .filter(p => !qaDone(p) && !devBlock(p) && !isDraft(p) && !p.conflict && passedCI(p))
      .sort(qaCompare(me));

   // ids match v1's column collapse params (?ci=0&cr=0…) so old URLs map 1:1
   const columns: [string, string, DerivedPull[]][] = [
      ['ci', 'CI Blocked', ciBlocked],
      ['dep', 'Deploy Blocked', deployBlocked],
      ['ready', 'Ready', ready],
      ['dev', 'Dev Block', devBlocked],
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
         {closed && <ClosedColumn pulls={closed} />}
      </div>
   );
}
