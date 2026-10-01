import { issueUrl, n, shortRepo } from '../../../../shared/format';
import { utcDay } from '../../../../shared/model/projects';
import { isUnderWay, type RoadmapItem } from '../../../../shared/model/roadmap';
import {
   afterEndOf,
   issueKey,
   issueText,
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

const PR_STATE_WORD: Record<NonNullable<LinkedPull['state']>, string> = {
   open: 'open',
   merged: 'merged',
   closed: 'closed unmerged',
};

/** A linked PR as a small link: its number (its repo too, when it's in
 * another one than the issue) and how it stands. */
function PullChip({ pr, repo }: { pr: LinkedPull; repo: string }) {
   const other = pr.repo.toLowerCase() !== repo.toLowerCase();
   return (
      <a
         href={issueUrl(pr.repo, pr.number)}
         target="_blank"
         rel="noopener noreferrer"
         className={`text-xs ${linkClass}`}
         title={pr.title ?? 'A PR that links it'}
      >
         PR {other ? shortRepo(pr.repo) : ''}#{pr.number}
         {pr.state ? ` ${PR_STATE_WORD[pr.state]}` : ''}
      </a>
   );
}

/** One item of a spec: the issue (or a plain checklist line), how it got
 * in and when it closed, the PRs that link it, and the other
 * plans that list it. */
function ItemLine({
   item,
   plan,
   others,
   movedTo,
}: {
   item: ScopeItem;
   plan: RoadmapItem;
   /** the project's other plans whose scope holds it */
   others: RoadmapItem[];
   /** the later plan it moved to, while it's open */
   movedTo: RoadmapItem | undefined;
}) {
   const late = item.joinedAt != null && item.joinedAt >= afterEndOf(plan);
   const repo = item.ref?.repo;
   return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-secondary px-3.5 py-2 text-[13px]">
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
            <span className="flex-none text-xs text-ink-3">checklist line</span>
         )}
         <span className="min-w-0 break-words text-ink">{item.title}</span>
         {item.source === 'label' && (
            <span className="text-xs text-ink-3">has the project label</span>
         )}
         {item.state !== 'open' && item.closedAt != null && (
            <span className="text-xs text-ink-3">
               {item.state} {dayOfEpoch(item.closedAt)}
            </span>
         )}
         {movedTo && <span className="text-xs text-ink-3">now in {movedTo.name}</span>}
         {late && (
            <span className="text-xs text-ink-3">
               added {dayOfEpoch(item.joinedAt as number)}, after the plan ended
            </span>
         )}
         {others.length > 0 && (
            <span className="text-xs text-ink-3">also in {others.map(p => p.name).join(', ')}</span>
         )}
         {repo && (item.prs ?? []).map(pr => <PullChip key={issueKey(pr)} pr={pr} repo={repo} />)}
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
         : 'closed unmerged';
   return (
      <div className="flex flex-wrap items-baseline gap-x-2 border-t border-secondary px-3.5 py-2 text-[13px]">
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

/** One plan's spec: the issue behind it, how much is done, and its items. */
function PlanSpec({
   plan,
   scope,
   status,
   label,
   holders,
   plansById,
   nav,
   navigate,
}: {
   plan: RoadmapItem;
   scope: PlanScope | undefined;
   /** whether the scopes have loaded */
   status: 'loading' | 'failed' | 'ready';
   /** the project's label in full, for the issues labeled into it */
   label: string;
   /** the plans holding each issue, by issueKey */
   holders: ReadonlyMap<string, RoadmapItem[]>;
   plansById: ReadonlyMap<number, RoadmapItem>;
   nav: ProjectsNav;
   navigate: Navigate;
}) {
   const items = scope?.items ?? [];
   const by = (state: ScopeItem['state']) =>
      items.filter(i => i.state === state && i.movedTo == null);
   const moved = items.filter(i => i.movedTo != null);
   const total = (scope?.done ?? 0) + (scope?.open ?? 0);
   const late = [...(scope?.afterEnd ?? [])].reverse();
   const lines = (list: ScopeItem[], id: string) => (
      <Truncated cap={LIST_CAP} id={`spec:${plan.id}:${id}`}>
         {list.map((item, i) => {
            const movedTo = item.movedTo == null ? undefined : plansById.get(item.movedTo);
            const others = item.ref
               ? (holders.get(issueKey(item.ref)) ?? []).filter(
                    p => p.id !== plan.id && p.id !== movedTo?.id
                 )
               : [];
            return (
               <ItemLine
                  key={item.ref ? issueKey(item.ref) : `line:${i}`}
                  item={item}
                  plan={plan}
                  others={others}
                  movedTo={movedTo}
               />
            );
         })}
      </Truncated>
   );
   let summary;
   if (!plan.spec) {
      summary = (
         <>
            <span>
               No spec issue yet. Name one on the roadmap: the epic whose sub-issues and checklist
               list what this plan delivers.
            </span>
            {scope && countWords(scope) && (
               <span className="text-ink-2 tabular-nums">
                  Issues labeled {label}: {countWords(scope)}
               </span>
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
            <a
               href={issueUrl(plan.spec.repo, plan.spec.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="hover:text-brand hover:underline"
            >
               {scope?.specTitle ?? issueText(plan.spec)}
            </a>
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
               count={by('open').length}
               label="Still open"
               id={`spec:${plan.id}:open`}
               defaultOpen={isUnderWay(plan.status)}
            >
               {lines(by('open'), 'open')}
            </Fold>
            <Fold
               count={moved.length}
               label="Moved to a later plan"
               gloss="Still open, and a later plan’s spec lists them too, so they count there"
               id={`spec:${plan.id}:moved`}
            >
               {lines(moved, 'moved')}
            </Fold>
            <Fold count={by('done').length} label="Done" id={`spec:${plan.id}:done`}>
               {lines(by('done'), 'done')}
            </Fold>
            <Fold
               count={by('dropped').length}
               label="Dropped"
               gloss="Closed as not planned or as a duplicate"
               id={`spec:${plan.id}:dropped`}
            >
               {lines(by('dropped'), 'dropped')}
            </Fold>
            <Fold
               count={late.length}
               label="PRs opened after the plan ended"
               gloss="This project’s PRs that opened after the plan’s last week and count toward it: they opened before a later plan started, or they link its spec. A PR with no project label counts when it links its spec."
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
 * specs it, how much is done, and every item in it, each issue with the PRs
 * that link it. Under each, the PRs that opened after the plan's end, which
 * is where a project that runs on shows. Plans under way come first; a
 * finished plan with nothing to show is left out.
 */
export function ProjectSpecs({
   slug,
   label,
   plans,
   scopes,
   nav,
   navigate,
}: {
   slug: string;
   /** the project's label in full */
   label: string;
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
   const plansById = new Map(mine.map(p => [p.id, p]));
   const holders = new Map<string, RoadmapItem[]>();
   for (const plan of mine) {
      for (const item of scopes?.get(plan.id)?.items ?? []) {
         if (!item.ref) continue;
         const k = issueKey(item.ref);
         holders.set(k, [...(holders.get(k) ?? []), plan]);
      }
   }
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
               it links an issue in the spec of one that had.
            </p>
         )}
         {mine.map(plan => (
            <PlanSpec
               key={plan.id}
               plan={plan}
               scope={scopes?.get(plan.id)}
               status={status}
               label={label}
               holders={holders}
               plansById={plansById}
               nav={nav}
               navigate={navigate}
            />
         ))}
      </section>
   );
}
