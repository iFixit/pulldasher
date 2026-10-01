import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { epoch, issueUrl, n, shortRepo } from '../../../../shared/format';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import type { DerivedPull } from '../../../../shared/model/status';
import type { PullData } from '../../../../shared/types';
import {
   afterEndOf,
   issueKey,
   planOfWork,
   type IssueHit,
   type IssuePull,
   type IssueRef,
   type ItemState,
   type ProjectIssue,
} from '../../../../shared/model/work';
import { RefChip, type GitHubRefData } from '../../components/GitHubRef';
import { IssueSearch } from '../../components/IssueSearch';
import { Fold, GroupHeader, Rows, Truncated } from '../../components/Lane';
import { CiStatus } from '../../components/pips';
import { dayOf, dayWords } from '../../model/projectData';
import { changeProjectIssue, useProjectWork } from '../../model/projectWork';
import type { WorkData } from '../../model/workData';

// a time as the day it fell on here, like the rest of the tab
const dayOfEpoch = (at: number) => dayWords(dayOf(new Date(at * 1000)));

/** a long list shows this many rows, then "+ N more" */
const LIST_CAP = 40;

/** where an issue lands on the page, by its state */
const FOLD_OF: Record<ItemState, string> = {
   open: 'Open issues',
   done: 'Done',
   dropped: 'Dropped',
};

/** how long a confirmation stays; an error stays until dismissed */
const NOTE_MS = 8000;

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

/** A PR's line: its chip, title, sign-offs while it's open, who opened it
 * and when, whether that was after the plan ended, and its CI. */
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
         // pd-row: a passing CI shows on hover, as on the board's rows
         className={`pd-row flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-3.5 text-[13px] ${
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
         {live && <CiStatus pull={live} />}
      </div>
   );
}

/** How an issue added here came to be here, in words. Nothing for one its
 * label brought, the usual case the line above the list explains. */
function viaWords(issue: ProjectIssue): string {
   if (!issue.via.includes('hand')) return '';
   const added = `added here${issue.addedBy ? ` by ${issue.addedBy}` : ''}${
      issue.attachedAt != null ? ` on ${dayOfEpoch(issue.attachedAt)}` : ''
   }`;
   // with the label too, taking it off here wouldn't take it out
   return issue.via.includes('label') ? `${added}, and has the label` : added;
}

/** An issue with the PRs that link it under it. */
function IssueBlock({
   issue,
   pulls,
   isLate,
   fresh,
   onRemove,
}: {
   issue: ProjectIssue;
   pulls: PullLookup;
   isLate: (pr: IssuePull) => boolean;
   /** just added: it flashes once */
   fresh: boolean;
   /** take it off the project; only for one added here and not labeled */
   onRemove: (() => void) | null;
}) {
   const via = viaWords(issue);
   return (
      <div
         data-issue={issueKey(issue.ref)}
         className={`border-t border-secondary first:border-t-0 ${fresh ? 'row-fresh' : ''}`}
      >
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
            {via && <span className="text-xs text-ink-3">{via}</span>}
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
               <Truncated cap={LIST_CAP} id={`work-prs:${issueKey(issue.ref)}`} label="more PRs">
                  {issue.prs.map(pr => (
                     <PullLine key={issueKey(pr)} pr={pr} pulls={pulls} late={isLate(pr)} nested />
                  ))}
               </Truncated>
            </div>
         ) : (
            issue.state === 'open' && (
               <p className="m-0 pb-2 pl-9 text-xs text-ink-3">No PR links it yet.</p>
            )
         )}
      </div>
   );
}

interface Note {
   text: string;
   error?: boolean;
   /** still saving: it stays */
   busy?: boolean;
   undo?: () => void;
}

/**
 * A project's work on its page: its issues, each with the PRs that link it
 * under it; then its PRs that link none of its issues; then the issues its
 * PRs link that aren't in it, to add. The search adds an issue by hand.
 */
export function ProjectWorkSection({
   slug,
   label,
   plans,
   work,
   pulls,
   nameOf,
}: {
   slug: string;
   /** the project's label in full */
   label: string;
   plans: readonly RoadmapItem[] | null;
   /** every plan's PRs by the dates, for how many opened after the end */
   work: WorkData | null | undefined;
   pulls: PullLookup;
   /** a project's name, by slug */
   nameOf: (slug: string) => string;
}) {
   const page = useProjectWork(slug, plans);
   const [note, setNote] = useState<Note | null>(null);
   // the issue just added, to bring into view and flash once it shows
   const [landed, setLanded] = useState<string | null>(null);
   const scrolled = useRef<string | null>(null);
   const mine = (plans ?? []).filter(p => p.project === slug);
   const isLate = (pr: IssuePull) => {
      if (pr.createdAt == null) return false;
      const plan = planOfWork(mine, pr.createdAt);
      return !!plan && pr.createdAt >= afterEndOf(plan);
   };
   const isOpenPr = (pr: IssuePull) => (pulls.live(pr) ? true : pr.state === 'open');
   const change = (issue: IssueRef & { state?: ItemState }, add: boolean) => {
      const ref = { repo: issue.repo, number: issue.number };
      setLanded(null);
      scrolled.current = null;
      setNote({ text: `${add ? 'Adding' : 'Removing'} #${ref.number}…`, busy: true });
      void changeProjectIssue(slug, ref, add).then(r => {
         if ('error' in r) setNote({ text: r.error, error: true });
         else if (!add)
            setNote({ text: `Removed #${ref.number}.`, undo: () => change(issue, true) });
         else {
            setLanded(issueKey(ref));
            setNote({
               text: `Added #${ref.number}${issue.state ? ` to ${FOLD_OF[issue.state]}` : ''}.`,
            });
         }
      });
   };
   useEffect(() => {
      if (!note || note.busy || note.error) return;
      const wait = setTimeout(() => setNote(null), NOTE_MS);
      return () => clearTimeout(wait);
   }, [note]);
   // an added issue: open the fold it's in and bring it into view
   useEffect(() => {
      if (!landed || scrolled.current === landed) return;
      const row = document.querySelector(`[data-issue="${CSS.escape(landed)}"]`);
      if (!row) return;
      scrolled.current = landed;
      const fold = row.closest('details');
      if (fold) fold.open = true;
      row.scrollIntoView({ block: 'center' });
   }, [landed, page]);
   const issues = page?.issues ?? [];
   const by = (state: ItemState) => issues.filter(i => i.state === state);
   const blocks = (list: ProjectIssue[], id: string) => (
      <Truncated cap={LIST_CAP} id={`work:${slug}:${id}`} label="more issues">
         {list.map(issue => (
            <IssueBlock
               key={issueKey(issue.ref)}
               issue={issue}
               pulls={pulls}
               isLate={isLate}
               fresh={landed === issueKey(issue.ref)}
               onRemove={
                  issue.via.length === 1 && issue.via[0] === 'hand'
                     ? () => change({ ...issue.ref, state: issue.state }, false)
                     : null
               }
            />
         ))}
      </Truncated>
   );
   // a closed issue with a PR still open is work still moving, so its fold
   // starts open and says so
   const closedFold = (state: 'done' | 'dropped', gloss?: string) => {
      const list = by(state);
      const open = list.reduce((sum, i) => sum + i.prs.filter(isOpenPr).length, 0);
      return (
         <Fold
            count={list.length}
            label={FOLD_OF[state]}
            gloss={gloss}
            id={`work:${slug}:${state}`}
            defaultOpen={open > 0}
            detail={open ? `${n(open, 'PR')} still open` : undefined}
         >
            {blocks(list, state)}
         </Fold>
      );
   };
   // the PRs on the page, each once, for the counts
   const shownPrs = new Map(
      [...issues.flatMap(i => i.prs), ...(page?.unlinked ?? [])].map(pr => [issueKey(pr), pr])
   );
   const openPrs = [...shownPrs.values()].filter(isOpenPr).length;
   const afterEnd = mine.reduce((sum, p) => sum + (work?.plans.get(p.id)?.afterEnd.length ?? 0), 0);
   const whereIs = (hit: IssueHit) => {
      const others = (hit.projects ?? []).filter(s => s !== slug);
      return others.length ? `in ${others.map(nameOf).join(', ')}` : null;
   };
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
                     label={FOLD_OF.open}
                     id={`work:${slug}:open`}
                     defaultOpen
                  >
                     {blocks(by('open'), 'open')}
                  </Fold>
                  {closedFold('done')}
                  {closedFold('dropped', 'Closed as not planned or as a duplicate')}
                  <Fold
                     count={page.unlinked.length}
                     label="PRs that link no issue here"
                     gloss="This project’s PRs that no issue here is linked to. Add the issue each one does, or check it belongs."
                     detail="open, or closed in the last 2 weeks"
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
                     label="Issues its PRs link, not added yet"
                     gloss="Issues this project’s recent PRs link (“Parts of #N”, “closes #N”) that aren’t in it yet"
                     id={`work:${slug}:suggested`}
                     defaultOpen
                  >
                     <Truncated cap={LIST_CAP} id={`work:${slug}:suggested`} label="more issues">
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
                     </Truncated>
                  </Fold>
               </Rows>
            )}
         </>
      );
   }
   let issueWords = '';
   if (page) {
      const { total, open } = page.counts;
      if (!total) issueWords = 'No issues';
      else if (!open) issueWords = `${n(total, 'issue')}, all closed`;
      else issueWords = `${open} of ${n(total, 'issue')} open`;
   }
   return (
      <section className="mb-7">
         <GroupHeader
            title="Issues and PRs"
            sub={
               page
                  ? [
                       issueWords,
                       `${n(openPrs, 'PR')} open`,
                       afterEnd ? `${n(afterEnd, 'PR')} opened after the plan ended` : '',
                    ]
                       .filter(Boolean)
                       .join(' · ')
                  : undefined
            }
         />
         <div className="mb-2">
            <IssueSearch
               label="Add an issue to this project"
               placeholder="Add an issue: title words, #123, or a link"
               onPick={hit => change(hit, true)}
               taken={new Set(issues.map(i => issueKey(i.ref)))}
               takenWords="in this project already"
               whereIs={whereIs}
            />
         </div>
         <p className="m-0 mb-2 max-w-[72ch] text-xs text-ink-3">
            Its issues are the ones with the {label} label on GitHub and the ones added here. A PR
            shows under every issue it links (“Parts of #N”, “closes #N”).
         </p>
         {body}
         {createPortal(
            // confirmations and errors, drawn over the page so they're seen
            // wherever the click was
            <div
               role="status"
               aria-live="polite"
               className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
            >
               {note && (
                  <span
                     className={`pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-md ${
                        note.error ? 'text-bad' : 'text-ink'
                     }`}
                  >
                     <span>{note.text}</span>
                     {(note.undo || note.error) && (
                        <button
                           type="button"
                           onClick={() => {
                              const undo = note.undo;
                              setNote(null);
                              undo?.();
                           }}
                           className="hit pressable flex-none rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
                        >
                           {note.undo ? 'Undo' : 'Dismiss'}
                        </button>
                     )}
                  </span>
               )}
            </div>,
            document.body
         )}
      </section>
   );
}
