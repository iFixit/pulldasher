import { crDone, qaDone, type DerivedPull } from '../model/status';
import type { PullData } from '../types';
import { ago, closedEpoch, pullKey } from '../format';
import { ClosedBadge, EmptyState, RepoRef } from '../components/bits';
import { CardShell } from '../components/Card';
import { BoardColumn } from '../components/Column';
import { laneShown, Truncated } from '../components/Lane';
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
   return (
      <BoardColumn count={pulls.length} header={title} defaultOpen={defaultOpen} empty="None">
         {/* a 60-row CR column is a 3600px scroll: cap it, keep the count honest */}
         <Truncated cap={laneShown(15, opts)} id={`classic:${title}`}>
            {pulls.map(p => (
               <Row key={pullKey(p.data)} pull={p} opts={opts} />
            ))}
         </Truncated>
      </BoardColumn>
   );
}

/** The closed card shares the column card's two-zone anatomy. */
function ClosedCard({ pull }: { pull: PullData }) {
   const merged = !!pull.merged_at;
   return (
      <CardShell
         login={pull.user.login}
         repo={pull.repo}
         number={pull.number}
         title={pull.title}
         meta={
            <>
               <ClosedBadge merged={merged} inline />
               <RepoRef repo={pull.repo} number={pull.number} />
               <span className="ml-auto w-16 text-right tabular-nums">
                  {ago(closedEpoch(pull))} ago
               </span>
            </>
         }
      />
   );
}

/** v1's Recently Closed panel, honored for ?closed=1 bookmarks. */
function ClosedColumn({ pulls }: { pulls: PullData[] }) {
   const ordered = [...pulls].sort((a, b) => closedEpoch(b) - closedEpoch(a));
   return (
      <BoardColumn count={pulls.length} header="Recently Closed" empty="None">
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
         {closed && <ClosedColumn pulls={closed} />}
      </div>
   );
}
