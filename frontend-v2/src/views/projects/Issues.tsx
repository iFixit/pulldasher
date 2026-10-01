import { useState } from 'react';
import { epoch } from '../../../../shared/format';
import { utcDay } from '../../../../shared/model/projects';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { issueKey, type IssueRef, type ProjectIssue } from '../../../../shared/model/scope';
import type { PullData } from '../../../../shared/types';
import { RefChip, type GitHubRefData } from '../../components/GitHubRef';
import { IssueSearch } from '../../components/IssueSearch';
import { Fold, GroupHeader, Rows, Truncated } from '../../components/Lane';
import { dayWords } from '../../model/projectData';
import { changeProjectIssue, useProjectIssues } from '../../model/projectIssues';

const dayOfEpoch = (at: number) => dayWords(utcDay(at));

/** a long list shows this many rows, then "+ N more" */
const LIST_CAP = 40;

/** A PR as its chip shows it, with what the board knows of it. */
function pullRef(
   pr: { repo: string; number: number; title: string | null; state: string | null },
   known: PullData | undefined
): GitHubRefData {
   return {
      kind: 'pr',
      repo: pr.repo,
      number: pr.number,
      title: known?.title ?? pr.title,
      state:
         pr.state === 'open' || pr.state === 'merged' || pr.state === 'closed' ? pr.state : null,
      author: known?.user.login ?? null,
      createdAt: known ? epoch(known.created_at) : null,
      additions: known?.additions ?? null,
      deletions: known?.deletions ?? null,
      files: known?.changed_files ?? null,
   };
}

/** How an issue is attached, in words: its plans' specs, the label, by hand. */
function viaWords(issue: ProjectIssue, plans: ReadonlyMap<number, RoadmapItem>, label: string) {
   const names = issue.plans.map(id => plans.get(id)?.name).filter(Boolean);
   const words: string[] = [];
   if (issue.via.includes('sub') || issue.via.includes('check')) {
      // with one plan, which spec is plain
      words.push(
         plans.size > 1 && names.length ? `in the spec of ${names.join(' and ')}` : 'in the spec'
      );
   }
   if (issue.via.includes('label')) words.push(`has the ${label} label`);
   if (issue.via.includes('hand')) {
      words.push(
         `added here${issue.addedBy ? ` by ${issue.addedBy}` : ''}${
            issue.joinedAt != null && issue.via.length === 1
               ? ` on ${dayOfEpoch(issue.joinedAt)}`
               : ''
         }`
      );
   }
   return words.join(' · ');
}

function IssueLine({
   issue,
   plans,
   label,
   pullOf,
   onRemove,
}: {
   issue: ProjectIssue;
   plans: ReadonlyMap<number, RoadmapItem>;
   label: string;
   pullOf: (repo: string, number: number) => PullData | undefined;
   /** take it off the project; only for one added by hand */
   onRemove: ((ref: IssueRef) => void) | null;
}) {
   const movedTo = issue.movedTo == null ? undefined : plans.get(issue.movedTo);
   return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-secondary px-3.5 py-2 text-[13px]">
         {issue.ref ? (
            <RefChip
               data={{
                  kind: 'issue',
                  ...issue.ref,
                  title: issue.title,
                  state: issue.state,
                  author: issue.author,
                  createdAt: issue.createdAt,
               }}
            />
         ) : (
            <span className="flex-none text-xs text-ink-3">checklist line</span>
         )}
         <span className="min-w-0 break-words text-ink">{issue.title}</span>
         <span className="text-xs text-ink-3">{viaWords(issue, plans, label)}</span>
         {issue.state !== 'open' && issue.closedAt != null && (
            <span className="text-xs text-ink-3">
               {issue.state} {dayOfEpoch(issue.closedAt)}
            </span>
         )}
         {movedTo && <span className="text-xs text-ink-3">moved on to {movedTo.name}</span>}
         {(issue.prs ?? []).map(pr => (
            <RefChip key={issueKey(pr)} data={pullRef(pr, pullOf(pr.repo, pr.number))} />
         ))}
         {onRemove && issue.ref && (
            <button
               type="button"
               onClick={() => onRemove(issue.ref as IssueRef)}
               className="hit pressable ml-auto rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-bad"
               title={
                  issue.via.length > 1
                     ? 'Take off what was added here; it stays for the other reasons shown'
                     : 'Take it off this project'
               }
            >
               Remove
            </button>
         )}
      </div>
   );
}

/**
 * A project's issues on its page: every issue its plans' specs list, every
 * issue carrying its label, and the ones added here by hand, each once, with
 * how it got here, its state and the PRs that link it. The search box adds
 * one by hand; Remove takes off one added by hand.
 */
export function ProjectIssuesSection({
   slug,
   label,
   plans,
   pullOf,
}: {
   slug: string;
   /** the project's label in full */
   label: string;
   plans: readonly RoadmapItem[] | null;
   /** what the board knows of a PR, for its chip's card */
   pullOf: (repo: string, number: number) => PullData | undefined;
}) {
   const issues = useProjectIssues(slug, plans);
   const [error, setError] = useState<string | null>(null);
   // this project's plans
   const plansById = new Map((plans ?? []).filter(p => p.project === slug).map(p => [p.id, p]));
   const taken = new Set((issues ?? []).flatMap(i => (i.ref ? [issueKey(i.ref)] : [])));
   const change = (ref: IssueRef, add: boolean) => {
      setError(null);
      void changeProjectIssue(slug, ref, add).then(r => {
         if ('error' in r) setError(r.error);
      });
   };
   const by = (state: ProjectIssue['state']) => (issues ?? []).filter(i => i.state === state);
   const lines = (list: ProjectIssue[], id: string) => (
      <Truncated cap={LIST_CAP} id={`issues:${slug}:${id}`}>
         {list.map((issue, i) => (
            <IssueLine
               key={issue.ref ? issueKey(issue.ref) : `line:${i}`}
               issue={issue}
               plans={plansById}
               label={label}
               pullOf={pullOf}
               onRemove={issue.via.includes('hand') ? ref => change(ref, false) : null}
            />
         ))}
      </Truncated>
   );
   const open = by('open');
   let body;
   if (issues === undefined)
      body = <p className="m-0 text-[13px] text-ink-3">Loading its issues…</p>;
   else if (issues === null) {
      body = (
         <p className="m-0 text-[13px] text-ink-3">
            Couldn’t load its issues. Try again in a minute.
         </p>
      );
   } else if (!issues.length) {
      body = (
         <p className="m-0 text-[13px] text-ink-3">
            No issues yet. Add one above, give an issue the {label} label, or name a spec issue on
            its plan.
         </p>
      );
   } else {
      body = (
         <Rows>
            <Fold count={open.length} label="Open" id={`issues:${slug}:open`} defaultOpen>
               {lines(open, 'open')}
            </Fold>
            <Fold count={by('done').length} label="Done" id={`issues:${slug}:done`}>
               {lines(by('done'), 'done')}
            </Fold>
            <Fold
               count={by('dropped').length}
               label="Dropped"
               gloss="Closed as not planned or as a duplicate"
               id={`issues:${slug}:dropped`}
            >
               {lines(by('dropped'), 'dropped')}
            </Fold>
         </Rows>
      );
   }
   return (
      <section className="mb-7">
         <GroupHeader
            title="Issues"
            sub={issues?.length ? `${open.length} open of ${issues.length}` : undefined}
         />
         <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <IssueSearch
               label="Add an issue to this project"
               placeholder="Add an issue: words from its title, #123, or its link"
               onPick={hit => change(hit, true)}
               taken={taken}
               takenWords="in this project already"
            />
            {error && <span className="text-xs text-warn">{error}</span>}
         </div>
         <p className="m-0 mb-2 max-w-[72ch] text-xs text-ink-3">
            Its issues come from its plans’ spec issues, the {label} label, and the ones added here.
         </p>
         {body}
      </section>
   );
}
