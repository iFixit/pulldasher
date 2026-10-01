import { issueUrl, n, shortRepo } from '../../../../shared/format';
import { utcDay } from '../../../../shared/model/projects';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import {
   issueKey,
   type LinkedPull,
   type PlanScope,
   type ScopeItem,
   type WorkPull,
} from '../../../../shared/model/scope';
import { Fold, GroupHeader, Rows, Truncated } from '../../components/Lane';
import { dayWords } from '../../model/projectData';
import { openPlan, type Navigate, type ProjectsNav } from './parts';
import { PLAN_STATUS_WORD, planWords } from './roadmapHealth';

const dayOfEpoch = (at: number) => dayWords(utcDay(at));

const linkClass = 'text-ink-3 hover:text-brand hover:underline';

/** a long list shows this many rows, then "+ N more" */
const LIST_CAP = 40;

/** A linked PR as a small link: its number and how it stands. */
function PullChip({ pr }: { pr: LinkedPull }) {
   return (
      <a
         href={issueUrl(pr.repo, pr.number)}
         target="_blank"
         rel="noopener noreferrer"
         className={`text-xs ${linkClass}`}
         title={pr.title ? `${pr.title}${pr.state ? ` (${pr.state})` : ''}` : 'A PR that links it'}
      >
         PR #{pr.number}
         {pr.state && pr.state !== 'merged' ? ` ${pr.state}` : ''}
      </a>
   );
}

/** One item of a spec: the issue (or a plain checklist line), its PRs, and
 * whether it joined after the plan was made or sits in another plan too. */
function ItemLine({
   item,
   plan,
   others,
}: {
   item: ScopeItem;
   plan: RoadmapItem;
   /** the other plans whose scope holds it */
   others: RoadmapItem[];
}) {
   const added =
      item.joinedAt != null && plan.created_at != null && item.joinedAt > plan.created_at;
   return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-secondary px-3.5 py-2 text-[13px] first:border-t-0">
         {item.ref ? (
            <a
               href={issueUrl(item.ref.repo, item.ref.number)}
               target="_blank"
               rel="noopener noreferrer"
               className={`flex-none text-xs ${linkClass}`}
            >
               {shortRepo(item.ref.repo)}#{item.ref.number}
            </a>
         ) : (
            <span className="flex-none text-xs text-ink-3" title="A checklist line with no issue">
               checklist
            </span>
         )}
         <span className="min-w-0 break-words text-ink">{item.title}</span>
         {item.state !== 'open' && item.closedAt != null && (
            <span className="text-xs text-ink-3">
               {item.state} {dayOfEpoch(item.closedAt)}
            </span>
         )}
         {added && (
            <span
               className="text-xs text-ink-3"
               title={`It joined the spec on ${dayOfEpoch(
                  item.joinedAt as number
               )}, after the plan was made`}
            >
               added since the plan
            </span>
         )}
         {others.length > 0 && (
            <span className="text-xs text-ink-3">also in {others.map(p => p.name).join(', ')}</span>
         )}
         {(item.prs ?? []).map(pr => (
            <PullChip key={issueKey(pr)} pr={pr} />
         ))}
      </div>
   );
}

/** A PR that opened after a plan's end. */
function LatePull({ pr }: { pr: WorkPull }) {
   const state =
      pr.mergedAt != null
         ? `merged ${dayOfEpoch(pr.mergedAt)}`
         : pr.state === 'open'
         ? 'still open'
         : 'closed';
   return (
      <div className="flex flex-wrap items-baseline gap-x-2 border-t border-secondary px-3.5 py-2 text-[13px] first:border-t-0">
         <a
            href={issueUrl(pr.repo, pr.number)}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 break-words text-ink hover:text-brand hover:underline"
         >
            <span className="text-xs text-ink-3">
               {shortRepo(pr.repo)}#{pr.number}
            </span>{' '}
            {pr.title}
         </a>
         <span className="text-xs text-ink-3">
            {pr.author}, opened {dayOfEpoch(pr.createdAt)}, {state}
         </span>
      </div>
   );
}

/** One plan's spec: the issue behind it, how much is done, and its items. */
function PlanSpec({
   plan,
   scope,
   loading,
   holders,
   nav,
   navigate,
}: {
   plan: RoadmapItem;
   scope: PlanScope | undefined;
   /** the scopes haven't loaded yet */
   loading: boolean;
   /** every plan holding each issue, by issueKey */
   holders: ReadonlyMap<string, RoadmapItem[]>;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const items = scope?.items ?? [];
   const by = (state: ScopeItem['state']) => items.filter(i => i.state === state);
   const others = (item: ScopeItem) =>
      item.ref ? (holders.get(issueKey(item.ref)) ?? []).filter(p => p.id !== plan.id) : [];
   const lines = (state: ScopeItem['state']) => (
      <Truncated cap={LIST_CAP} id={`spec:${plan.id}:${state}`}>
         {by(state).map((item, i) => (
            <ItemLine
               key={item.ref ? issueKey(item.ref) : `line:${i}`}
               item={item}
               plan={plan}
               others={others(item)}
            />
         ))}
      </Truncated>
   );
   const total = (scope?.done ?? 0) + (scope?.open ?? 0);
   const late = scope?.afterEnd ?? [];
   const editPlan = (
      <button
         type="button"
         onClick={() => navigate(openPlan(nav, plan.id))}
         className="hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
      >
         Open on the roadmap
      </button>
   );
   let summary;
   if (loading) {
      summary = <span className="text-ink-3">Reading the spec…</span>;
   } else if (!plan.spec) {
      summary = (
         <span className="text-ink-3">
            No spec issue yet. Name one on the roadmap: the epic whose sub-issues and checklist say
            what this plan delivers.
         </span>
      );
   } else if (scope && !scope.specFound) {
      summary = (
         <span className="text-warn">
            Couldn’t read {issueKey(plan.spec)} on GitHub: it isn’t an issue, or it’s gone. Check
            the spec on the roadmap.
         </span>
      );
   } else if (!scope?.specTitle && !items.length) {
      summary = (
         <span className="text-ink-3">
            {issueKey(plan.spec)} hasn’t been read yet. The board reads specs from GitHub every
            hour, and right after a plan’s spec changes.
         </span>
      );
   } else {
      summary = (
         <>
            <a
               href={issueUrl(plan.spec.repo, plan.spec.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="hover:text-brand hover:underline"
            >
               {scope?.specTitle ?? issueKey(plan.spec)}
            </a>
            <span className="text-ink-2 tabular-nums">
               {items.length
                  ? `${scope?.done ?? 0} of ${total} done${
                       scope?.dropped ? `, ${scope.dropped} dropped` : ''
                    }`
                  : 'lists no sub-issues or checklist yet'}
            </span>
            {!!scope?.added && (
               <span title="Issues that joined the spec after the plan was made">
                  {scope.added} added since the plan
               </span>
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
                  <span className="ml-auto">{editPlan}</span>
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
               count={by('open').length}
               label="Still open"
               id={`spec:${plan.id}:open`}
               defaultOpen
            >
               {lines('open')}
            </Fold>
            <Fold count={by('done').length} label="Done" id={`spec:${plan.id}:done`}>
               {lines('done')}
            </Fold>
            <Fold
               count={by('dropped').length}
               label="Dropped"
               gloss="Closed as not planned or as a duplicate"
               id={`spec:${plan.id}:dropped`}
            >
               {lines('dropped')}
            </Fold>
            <Fold
               count={late.length}
               label="Opened after its end"
               gloss="This project’s PRs that opened after the plan’s last week, and belong to it: they opened before any later plan started, or they link an issue in its spec"
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

/**
 * What a project's plans deliver, on its page: per plan (oldest first), the
 * issue that specs it, how much is done, and every item in it, open first,
 * each issue with the PRs that close or mention it. Under each, the PRs that
 * opened after the plan's end, which is where a project that runs on shows.
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
   // a finished plan with no spec and nothing after its end has nothing to show
   const mine = (plans ?? [])
      .filter(p => p.project === slug)
      .filter(p => {
         const s = scopes?.get(p.id);
         const finished = p.status === 'done' || p.status === 'dropped';
         return !finished || p.spec || s?.items.length || s?.afterEnd.length;
      })
      .sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
   if (!mine.length) return null;
   const holders = new Map<string, RoadmapItem[]>();
   for (const plan of mine) {
      for (const item of scopes?.get(plan.id)?.items ?? []) {
         if (!item.ref) continue;
         const k = issueKey(item.ref);
         holders.set(k, [...(holders.get(k) ?? []), plan]);
      }
   }
   return (
      <section className="mb-7">
         <GroupHeader
            title={mine.length > 1 ? 'What its plans deliver' : 'What its plan delivers'}
            sub={
               scopes === null
                  ? 'Couldn’t load the specs. Try again in a minute.'
                  : n(mine.length, 'plan')
            }
         />
         {mine.map(plan => (
            <PlanSpec
               key={plan.id}
               plan={plan}
               scope={scopes?.get(plan.id)}
               loading={scopes === undefined}
               holders={holders}
               nav={nav}
               navigate={navigate}
            />
         ))}
      </section>
   );
}
