import { useState } from 'react';
import type { DerivedPull } from '../model/status';
import { EmptyState } from '../components/bits';
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
const crDone = (p: DerivedPull) => p.crHave >= p.data.status.cr_req;
const qaDone = (p: DerivedPull) => p.qaHave >= p.data.status.qa_req;
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

function Column({ title, pulls, opts }: { title: string; pulls: DerivedPull[]; opts: RowOptions }) {
   const [open, setOpen] = useState(true);
   return (
      <section className="min-w-0">
         <h2 className="m-0">
            <button
               type="button"
               aria-expanded={open}
               onClick={() => setOpen(o => !o)}
               className="flex w-full items-center gap-2 rounded-t-2xl border border-line bg-muted px-4 py-2.5 text-left text-sm font-semibold"
               title={open ? 'collapse column' : 'expand column'}
            >
               {title}
               <span className="flex-1" />
               <span className="text-xs font-normal text-ink-3 tabular-nums">{pulls.length}</span>
            </button>
         </h2>
         {open && (
            <div className="overflow-hidden rounded-b-2xl border border-t-0 border-line bg-surface">
               {pulls.map(p => (
                  <Row
                     key={`${p.data.repo}#${p.data.number}`}
                     pull={p}
                     opts={{ ...opts, badge: false }}
                  />
               ))}
               {!pulls.length && <div className="px-4 py-3 text-[13px] text-ink-3">none</div>}
            </div>
         )}
      </section>
   );
}

export function Classic({ pulls, opts }: { pulls: DerivedPull[]; opts: RowOptions }) {
   const me = opts.me;
   if (!pulls.length) {
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

   const columns: [string, DerivedPull[]][] = [
      ['CI Blocked', ciBlocked],
      ['Deploy Blocked', deployBlocked],
      ['Ready', ready],
      ['Dev Block', devBlocked],
      ['CR', needsCr],
      ['QA', needsQa],
   ];

   return (
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
         {columns.map(([title, list]) => (
            <Column key={title} title={title} pulls={list} opts={opts} />
         ))}
      </div>
   );
}
