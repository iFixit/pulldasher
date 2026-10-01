import { n } from '../../../../shared/format';
import { utcDay } from '../../../../shared/model/projects';
import { isUnderWay, type RoadmapItem } from '../../../../shared/model/roadmap';
import { issueKey, issueText, type PlanScope, type WorkPull } from '../../../../shared/model/scope';
import { RefChip } from '../../components/GitHubRef';
import { Fold, GroupHeader, Rows, Truncated } from '../../components/Lane';
import { dayWords } from '../../model/projectData';
import { openPlan, type Navigate, type ProjectsNav } from './parts';
import { PLAN_STATUS_WORD, planWords } from './roadmapHealth';

const dayOfEpoch = (at: number) => dayWords(utcDay(at));

/** a long list shows this many rows, then "+ N more" */
const LIST_CAP = 40;

/** A PR that opened after a plan's end. */
function LatePull({ pr }: { pr: WorkPull }) {
   const state =
      pr.mergedAt != null
         ? `merged ${dayOfEpoch(pr.mergedAt)}`
         : pr.state === 'open'
         ? 'still open'
         : 'closed unmerged';
   return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-secondary px-3.5 py-2 text-[13px]">
         <RefChip
            data={{
               kind: 'pr',
               repo: pr.repo,
               number: pr.number,
               title: pr.title,
               state: pr.mergedAt != null ? 'merged' : pr.state,
               author: pr.author,
               createdAt: pr.createdAt,
            }}
         />
         <span className="min-w-0 break-words text-ink">{pr.title}</span>
         <span className="text-xs text-ink-3">
            {pr.author}, opened {dayOfEpoch(pr.createdAt)}, {state}
         </span>
      </div>
   );
}

/** How much of a scope is done, in words: "13 of 16 done, 1 dropped". */
function countWords(scope: PlanScope): string {
   const total = scope.done + scope.open;
   if (!total) return scope.dropped ? `All ${scope.dropped} dropped` : '';
   return [
      `${scope.done} of ${total} done`,
      scope.dropped ? `${scope.dropped} dropped` : '',
      scope.moved ? `${scope.moved} moved to a later plan` : '',
   ]
      .filter(Boolean)
      .join(', ');
}

/** One plan's spec: the issue behind it, how much is done, and the PRs
 * that opened after its end. Its issues are in the project's Issues list. */
function PlanSpec({
   plan,
   scope,
   status,
   nav,
   navigate,
}: {
   plan: RoadmapItem;
   scope: PlanScope | undefined;
   /** whether the scopes have loaded */
   status: 'loading' | 'failed' | 'ready';
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const items = scope?.items ?? [];
   const total = (scope?.done ?? 0) + (scope?.open ?? 0);
   const late = [...(scope?.afterEnd ?? [])].reverse();
   let summary;
   if (!plan.spec) {
      summary = (
         <>
            <span>
               No spec issue yet. Name one on the roadmap: the epic whose sub-issues and checklist
               list what this plan delivers.
            </span>
            {scope && countWords(scope) && (
               <span className="text-ink-2 tabular-nums">Its issues: {countWords(scope)}</span>
            )}
         </>
      );
   } else if (status === 'loading') {
      summary = <span>Reading its spec…</span>;
   } else if (status === 'failed') {
      summary = <span>Couldn’t load its spec. Try again in a minute.</span>;
   } else if (scope && !scope.specFound) {
      summary = (
         <span className="text-warn">
            Couldn’t read {issueText(plan.spec)} on GitHub: it isn’t an issue, or it’s gone. Check
            the spec issue on the roadmap.
         </span>
      );
   } else if (!scope?.specTitle && !items.length) {
      summary = (
         <span>
            {issueText(plan.spec)} hasn’t been read yet. The board reads specs from GitHub every
            hour, and right after a plan’s spec changes.
         </span>
      );
   } else {
      summary = (
         <>
            <span className="inline-flex min-w-0 items-baseline gap-1.5">
               <RefChip
                  data={{
                     kind: 'issue',
                     ...plan.spec,
                     title: scope?.specTitle ?? null,
                  }}
               />
               <span className="text-ink-2">{scope?.specTitle ?? issueText(plan.spec)}</span>
            </span>
            <span className="text-ink-2 tabular-nums">
               {(scope && countWords(scope)) || 'lists no sub-issues or checklist yet'}
            </span>
            {!!scope?.addedAfterEnd && (
               <span className="text-ink-2">{scope.addedAfterEnd} added after it ended</span>
            )}
         </>
      );
   }
   return (
      <div className="mb-4">
         <Rows>
            <div className="px-3.5 py-2.5 text-xs text-ink-3">
               <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[13px] font-medium text-ink">{plan.name}</span>
                  <span>{PLAN_STATUS_WORD[plan.status]}</span>
                  <span>{planWords(plan)}</span>
                  <button
                     type="button"
                     onClick={() => navigate(openPlan(nav, plan.id))}
                     className="hit pressable ml-auto rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
                  >
                     Open on the roadmap
                  </button>
               </div>
               <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">{summary}</div>
               {total > 0 && (
                  <div
                     className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                     role="img"
                     aria-label={`${scope?.done ?? 0} of ${total} done`}
                  >
                     <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${((scope?.done ?? 0) / total) * 100}%` }}
                     />
                  </div>
               )}
            </div>
            <Fold
               count={late.length}
               label="PRs opened after the plan ended"
               gloss="This project’s PRs that opened after the plan’s last week and count toward it: they opened before a later plan started, or they link its issues. A PR with no project label counts when it links one of them."
               detail={late.length ? `latest ${dayOfEpoch(late[0].createdAt)}` : undefined}
               id={`spec:${plan.id}:late`}
               defaultOpen
            >
               <Truncated cap={LIST_CAP} id={`spec:${plan.id}:late`}>
                  {late.map(pr => (
                     <LatePull key={issueKey(pr)} pr={pr} />
                  ))}
               </Truncated>
            </Fold>
         </Rows>
      </div>
   );
}

/** under way first, then parked, then finished; finished ones newest first */
const rankOf = (p: RoadmapItem) => (isUnderWay(p.status) ? 0 : p.status === 'parked' ? 1 : 2);

/**
 * What a project's plans deliver, on its page: per plan, the issue that
 * specs it, how much of its scope is done, and the PRs that opened after the
 * plan's end, which is where a project that runs on shows. The issues
 * themselves are in the project's Issues list. Plans under way come first;
 * a finished plan with nothing to show is left out.
 */
export function ProjectSpecs({
   slug,
   plans,
   scopes,
   nav,
   navigate,
}: {
   slug: string;
   plans: readonly RoadmapItem[] | null;
   /** undefined while they load, null if that failed */
   scopes: ReadonlyMap<number, PlanScope> | null | undefined;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const mine = (plans ?? [])
      .filter(p => p.project === slug)
      .filter(p => {
         const s = scopes?.get(p.id);
         return rankOf(p) < 2 || p.spec || s?.items.length || s?.afterEnd.length;
      })
      .sort(
         (a, b) =>
            rankOf(a) - rankOf(b) ||
            (rankOf(a) === 2 ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)) ||
            a.id - b.id
      );
   if (!mine.length) return null;
   const status = scopes === undefined ? 'loading' : scopes === null ? 'failed' : 'ready';
   return (
      <section className="mb-7">
         <GroupHeader
            title={mine.length > 1 ? 'What its plans deliver' : 'What its plan delivers'}
            sub={n(mine.length, 'plan')}
         />
         {mine.length > 1 && (
            <p className="m-0 mb-2 max-w-[72ch] text-xs text-ink-3">
               A PR counts toward the latest of these plans that had started when it opened, unless
               it links an issue of one that had.
            </p>
         )}
         {mine.map(plan => (
            <PlanSpec
               key={plan.id}
               plan={plan}
               scope={scopes?.get(plan.id)}
               status={status}
               nav={nav}
               navigate={navigate}
            />
         ))}
      </section>
   );
}
