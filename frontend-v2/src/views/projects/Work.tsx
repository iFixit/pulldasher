import { Fragment, useState } from 'react';
import { epoch, issueUrl, n, shortRepo } from '../../../../shared/format';
import { utcDay } from '../../../../shared/model/projects';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import type { DerivedPull } from '../../../../shared/model/status';
import type { PullData } from '../../../../shared/types';
import {
   afterEndOf,
   issueKey,
   issueText,
   planOfWork,
   type IssuePull,
   type IssueRef,
   type ProjectIssue,
} from '../../../../shared/model/work';
import { RefChip, type GitHubRefData } from '../../components/GitHubRef';
import { IssueSearch } from '../../components/IssueSearch';
import { Fold, GroupHeader, Rows, Truncated } from '../../components/Lane';
import { CiStatus } from '../../components/pips';
import { dayWords } from '../../model/projectData';
import { changeProjectIssue, useProjectWork } from '../../model/projectWork';
import type { WorkData } from '../../model/workData';

const dayOfEpoch = (at: number) => dayWords(utcDay(at));

/** a long list shows this many rows, then "+ N more" */
const LIST_CAP = 40;

/** What the board knows of a PR: its live row's data when it's open on the
 * board, or its data from the last two weeks' merges. */
export interface PullLookup {
   live: (ref: IssueRef) => DerivedPull | undefined;
   known: (ref: IssueRef) => PullData | undefined;
}

/** A PR as its chip shows it, with what the board knows of it. */
function pullRef(pr: IssuePull, known: PullData | undefined): GitHubRefData {
   return {
      kind: 'pr',
      repo: pr.repo,
      number: pr.number,
      title: known?.title ?? pr.title,
      state: known
         ? known.merged_at
            ? 'merged'
            : known.state === 'open'
            ? 'open'
            : 'closed'
         : pr.state,
      author: known?.user.login ?? pr.author,
      createdAt: known ? epoch(known.created_at) : pr.createdAt,
      additions: known?.additions ?? null,
      deletions: known?.deletions ?? null,
      files: known?.changed_files ?? null,
   };
}

/** A PR's line: its chip, title, CI and sign-offs while it's open, who
 * opened it and when, and whether that was after the plan ended. */
function PullLine({
   pr,
   pulls,
   late,
   nested,
}: {
   pr: IssuePull;
   pulls: PullLookup;
   /** it opened after the end of the plan it counts toward */
   late: boolean;
   /** under an issue */
   nested: boolean;
}) {
   const live = pulls.live(pr);
   const data = pullRef(pr, live?.data ?? pulls.known(pr));
   const signoffs = live
      ? [
           live.data.status.cr_req ? `CR ${live.crHave}/${live.data.status.cr_req}` : '',
           live.data.status.qa_req ? `QA ${live.qaHave}/${live.data.status.qa_req}` : '',
        ].filter(Boolean)
      : [];
   return (
      <div
         className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-3.5 text-[13px] ${
            nested ? 'pl-9' : 'border-t border-secondary pl-3.5 first:border-t-0'
         }`}
      >
         <RefChip data={data} />
         {data.title && (
            <a
               href={issueUrl(pr.repo, pr.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="min-w-0 break-words text-ink hover:text-brand hover:underline"
            >
               {data.title}
            </a>
         )}
         {live && <CiStatus pull={live} />}
         {signoffs.length > 0 && <span className="text-xs text-ink-3">{signoffs.join(' · ')}</span>}
         <span className="text-xs text-ink-3">
            {[
               data.author,
               data.createdAt != null ? `opened ${dayOfEpoch(data.createdAt)}` : '',
               late ? 'after the plan ended' : '',
            ]
               .filter(Boolean)
               .join(', ')}
         </span>
      </div>
   );
}

/** How an issue is attached, in words. */
function viaWords(issue: ProjectIssue, label: string): string {
   const words: string[] = [];
   if (issue.via.includes('label')) words.push(`has the ${label} label`);
   if (issue.via.includes('hand')) {
      words.push(
         `added here${issue.addedBy ? ` by ${issue.addedBy}` : ''}${
            issue.attachedAt != null ? ` on ${dayOfEpoch(issue.attachedAt)}` : ''
         }`
      );
   }
   return words.join(' · ');
}

/** An issue with the PRs that link it under it. */
function IssueBlock({
   issue,
   label,
   pulls,
   isLate,
   onRemove,
}: {
   issue: ProjectIssue;
   label: string;
   pulls: PullLookup;
   isLate: (pr: IssuePull) => boolean;
   /** take it off the project; only for one added here and not labeled */
   onRemove: (() => void) | null;
}) {
   return (
      <div className="border-t border-secondary first:border-t-0">
         <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3.5 pb-1 pt-2 text-[13px]">
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
            <a
               href={issueUrl(issue.ref.repo, issue.ref.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="min-w-0 break-words font-medium text-ink hover:text-brand hover:underline"
            >
               {issue.title}
            </a>
            <span className="text-xs text-ink-3">{viaWords(issue, label)}</span>
            {issue.state !== 'open' && issue.closedAt != null && (
               <span className="text-xs text-ink-3">
                  {issue.state} {dayOfEpoch(issue.closedAt)}
               </span>
            )}
            {onRemove && (
               <button
                  type="button"
                  onClick={onRemove}
                  className="hit pressable ml-auto rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-bad"
               >
                  Remove
               </button>
            )}
         </div>
         {issue.prs.length > 0 ? (
            <div className="pb-1">
               {issue.prs.map(pr => (
                  <PullLine key={issueKey(pr)} pr={pr} pulls={pulls} late={isLate(pr)} nested />
               ))}
            </div>
         ) : (
            issue.state === 'open' && (
               <p className="m-0 pb-2 pl-9 text-xs text-ink-3">No PR links it yet.</p>
            )
         )}
      </div>
   );
}

/**
 * A project's work on its page: its issues, each with the PRs that link it
 * under it; then its PRs that link none of its issues; then the issues its
 * PRs link that aren't attached, to add. The search adds an issue by hand.
 */
export function ProjectWorkSection({
   slug,
   label,
   plans,
   work,
   pulls,
}: {
   slug: string;
   /** the project's label in full */
   label: string;
   plans: readonly RoadmapItem[] | null;
   /** every plan's PRs by the dates, for how many opened after the end */
   work: WorkData | null | undefined;
   pulls: PullLookup;
}) {
   const page = useProjectWork(slug, plans);
   const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
   const mine = (plans ?? []).filter(p => p.project === slug);
   const isLate = (pr: IssuePull) => {
      if (pr.createdAt == null) return false;
      const plan = planOfWork(mine, pr.createdAt);
      return !!plan && pr.createdAt >= afterEndOf(plan);
   };
   const change = (ref: IssueRef, add: boolean) => {
      setNote({ error: false, text: `${add ? 'Adding' : 'Removing'} ${issueText(ref)}…` });
      void changeProjectIssue(slug, ref, add).then(r =>
         setNote(
            'error' in r
               ? { error: true, text: r.error }
               : { error: false, text: `${add ? 'Added' : 'Removed'} ${issueText(ref)}.` }
         )
      );
   };
   const issues = page?.issues ?? [];
   const by = (state: ProjectIssue['state']) => issues.filter(i => i.state === state);
   const blocks = (list: ProjectIssue[], id: string) => (
      <Truncated cap={LIST_CAP} id={`work:${slug}:${id}`} label="more issues">
         {list.map(issue => (
            <IssueBlock
               key={issueKey(issue.ref)}
               issue={issue}
               label={label}
               pulls={pulls}
               isLate={isLate}
               onRemove={
                  issue.via.length === 1 && issue.via[0] === 'hand'
                     ? () => change(issue.ref, false)
                     : null
               }
            />
         ))}
      </Truncated>
   );
   // the PRs on the page, each once, for the counts
   const shownPrs = new Map(
      [...issues.flatMap(i => i.prs), ...(page?.unlinked ?? [])].map(pr => [issueKey(pr), pr])
   );
   const openPrs = [...shownPrs.values()].filter(pr =>
      pulls.live(pr) ? true : pr.state === 'open'
   ).length;
   const afterEnd = mine.reduce((sum, p) => sum + (work?.plans.get(p.id)?.afterEnd.length ?? 0), 0);
   let body;
   if (page === undefined) {
      body = <p className="m-0 text-[13px] text-ink-3">Loading its issues and PRs…</p>;
   } else if (page === null) {
      body = (
         <p className="m-0 text-[13px] text-ink-3">
            Couldn’t load its issues and PRs. Try again in a minute.
         </p>
      );
   } else {
      body = (
         <>
            {!issues.length && (
               <p className="m-0 mb-2 text-[13px] text-ink-3">
                  No issues yet. Add one above, or give an issue the {label} label on GitHub: the
                  label that puts PRs in this project.
               </p>
            )}
            {(issues.length > 0 || page.unlinked.length > 0 || page.suggested.length > 0) && (
               <Rows>
                  <Fold
                     count={by('open').length}
                     label="Open issues"
                     id={`work:${slug}:open`}
                     defaultOpen
                  >
                     {blocks(by('open'), 'open')}
                  </Fold>
                  <Fold count={by('done').length} label="Done" id={`work:${slug}:done`}>
                     {blocks(by('done'), 'done')}
                  </Fold>
                  <Fold
                     count={by('dropped').length}
                     label="Dropped"
                     gloss="Closed as not planned or as a duplicate"
                     id={`work:${slug}:dropped`}
                  >
                     {blocks(by('dropped'), 'dropped')}
                  </Fold>
                  <Fold
                     count={page.unlinked.length}
                     label="PRs that link none of its issues"
                     gloss="This project’s PRs, open or merged in the last two weeks, that no issue here is linked to. Add the issue they do, or check they belong."
                     id={`work:${slug}:unlinked`}
                     defaultOpen
                  >
                     <Truncated cap={LIST_CAP} id={`work:${slug}:unlinked`} label="more PRs">
                        {page.unlinked.map(pr => (
                           <PullLine
                              key={issueKey(pr)}
                              pr={pr}
                              pulls={pulls}
                              late={isLate(pr)}
                              nested={false}
                           />
                        ))}
                     </Truncated>
                  </Fold>
                  <Fold
                     count={page.suggested.length}
                     label="Linked by its PRs, not added yet"
                     gloss="Issues this project’s recent PRs link (“Parts of #N”, “closes #N”) that aren’t attached to it"
                     id={`work:${slug}:suggested`}
                     defaultOpen
                  >
                     {page.suggested.map(issue => (
                        <div
                           key={issueKey(issue)}
                           className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-secondary px-3.5 py-2 text-[13px] first:border-t-0"
                        >
                           <RefChip data={{ kind: 'issue', ...issue }} />
                           {issue.title && (
                              <a
                                 href={issueUrl(issue.repo, issue.number)}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="min-w-0 break-words text-ink hover:text-brand hover:underline"
                              >
                                 {issue.title}
                              </a>
                           )}
                           <span className="text-xs text-ink-3">
                              linked by{' '}
                              {issue.linkedBy.map((pr, i) => (
                                 <Fragment key={issueKey(pr)}>
                                    {i > 0 && ', '}
                                    <a
                                       href={issueUrl(pr.repo, pr.number)}
                                       target="_blank"
                                       rel="noopener noreferrer"
                                       className="text-ink-2 underline decoration-line underline-offset-2 hover:text-brand"
                                    >
                                       PR #{pr.number}
                                       {pr.repo !== issue.repo && ` in ${shortRepo(pr.repo)}`}
                                    </a>
                                 </Fragment>
                              ))}
                           </span>
                           <button
                              type="button"
                              onClick={() => change(issue, true)}
                              className="hit pressable ml-auto rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
                           >
                              Add
                           </button>
                        </div>
                     ))}
                  </Fold>
               </Rows>
            )}
         </>
      );
   }
   return (
      <section className="mb-7">
         <GroupHeader
            title="Issues and PRs"
            sub={
               page
                  ? [
                       `${page.counts.open} of ${n(page.counts.total, 'issue')} open`,
                       `${n(openPrs, 'PR')} open`,
                       afterEnd ? `${afterEnd} opened after the plan ended` : '',
                    ]
                       .filter(Boolean)
                       .join(' · ')
                  : undefined
            }
         />
         <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <IssueSearch
               label="Add an issue to this project"
               placeholder="Add an issue: words from its title, #123, or its link"
               onPick={hit => change(hit, true)}
               taken={new Set(issues.map(i => issueKey(i.ref)))}
               takenWords="in this project already"
            />
            {note && (
               <span className={`text-xs ${note.error ? 'text-bad' : 'text-ink-3'}`} role="status">
                  {note.text}
               </span>
            )}
         </div>
         <p className="m-0 mb-2 max-w-[72ch] text-xs text-ink-3">
            Its issues are the ones with the {label} label on GitHub and the ones added here. A PR
            shows under every issue it links (“Parts of #N”, “closes #N”).
         </p>
         {body}
      </section>
   );
}
