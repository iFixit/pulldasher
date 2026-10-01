import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { issueUrl, n, shortRepo } from '../../../../shared/format';
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
import { ClosedRow } from '../../components/ClosedRow';
import { RefChip } from '../../components/GitHubRef';
import { IssueSearch } from '../../components/IssueSearch';
import { Fold, GroupHeader, Rows, SubDoor, Truncated } from '../../components/Lane';
import { Row, type RowOptions } from '../../components/Row';
import { dayOf, dayWords } from '../../model/projectData';
import { changeProjectIssue, useProjectWork } from '../../model/projectWork';
import type { Navigate } from './parts';

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

/** A PR the board hasn't read (it closed long ago, or it's in a repo the
 * board doesn't track): its chip, title, author and day, as far as known. */
function PullLine({ pr, repoShown }: { pr: IssuePull; repoShown: boolean }) {
   return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-1.5 text-[13px]">
         <RefChip data={{ kind: 'pr', ...pr }} repoShown={repoShown} />
         {pr.title && (
            <a
               href={issueUrl(pr.repo, pr.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="min-w-0 break-words text-ink hover:text-brand hover:underline"
            >
               {pr.title}
            </a>
         )}
         <span className="text-xs text-ink-3">
            {[pr.author, pr.createdAt != null ? `opened ${dayOfEpoch(pr.createdAt)}` : '']
               .filter(Boolean)
               .join(', ')}
         </span>
      </div>
   );
}

/**
 * A PR as the board draws it everywhere else: its row while it's open, its
 * closed row once it merged or closed in the last two weeks, or a plain
 * line for one the board hasn't read. One that opened after its plan ended
 * says so under it.
 */
function PullItem({
   pr,
   pulls,
   late,
   opts,
   repoShown,
}: {
   pr: IssuePull;
   pulls: PullLookup;
   /** it opened after the end of the plan it counts toward */
   late: boolean;
   opts: RowOptions;
   repoShown: boolean;
}) {
   const live = pulls.live(pr);
   const known = live ? undefined : pulls.known(pr);
   return (
      // the divider rides on this wrapper, so a note stays with its row
      <div className="border-t border-secondary first:border-t-0">
         {live ? (
            <Row pull={live} opts={opts} />
         ) : known ? (
            <ClosedRow pull={known} lastSeen={opts.lastSeen} />
         ) : (
            <PullLine pr={pr} repoShown={repoShown} />
         )}
         {late && (
            <p className="m-0 -mt-1 pb-1.5 pl-[45px] pr-3.5 text-xs text-ink-3">
               Opened after the plan ended.
            </p>
         )}
      </div>
   );
}

/** How an issue added here came to be here, in words. Nothing for one its
 * label brought, the usual case the list's sub-line explains. */
function viaWords(issue: ProjectIssue): string {
   if (!issue.via.includes('hand')) return '';
   const added = `added${issue.addedBy ? ` by ${issue.addedBy}` : ' here'}${
      issue.attachedAt != null ? ` on ${dayOfEpoch(issue.attachedAt)}` : ''
   }`;
   // with the label too, taking it off here wouldn't take it out
   return issue.via.includes('label') ? `${added}, and has the label` : added;
}

/** The other projects an issue is in, each a link to its page. */
function AlsoIn({
   slugs,
   nameOf,
   navigate,
}: {
   slugs: string[];
   nameOf: (slug: string) => string;
   navigate: Navigate;
}) {
   if (!slugs.length) return null;
   return (
      <span className="text-xs text-ink-3">
         also in{' '}
         {slugs.map((slug, i) => (
            <Fragment key={slug}>
               {i > 0 && ', '}
               <button
                  type="button"
                  onClick={() => navigate({ project: slug })}
                  className="hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-2 underline decoration-line underline-offset-2 hover:text-brand"
               >
                  {nameOf(slug)}
               </button>
            </Fragment>
         ))}
      </span>
   );
}

/** An issue with the PRs that link it under it. */
function IssueBlock({
   issue,
   pulls,
   isLate,
   fresh,
   onRemove,
   opts,
   repoShown,
   nameOf,
   navigate,
}: {
   issue: ProjectIssue;
   pulls: PullLookup;
   isLate: (pr: IssuePull) => boolean;
   /** just added: it flashes once */
   fresh: boolean;
   /** take it off the project; only for one added here and not labeled */
   onRemove: (() => void) | null;
   opts: RowOptions;
   repoShown: (ref: IssueRef) => boolean;
   nameOf: (slug: string) => string;
   navigate: Navigate;
}) {
   const via = viaWords(issue);
   return (
      <div
         data-issue={issueKey(issue.ref)}
         className={`border-t border-secondary first:border-t-0 ${fresh ? 'row-fresh' : ''}`}
      >
         {/* pd-row: Remove shows on this line's hover, as a row's kebab does */}
         <div className="pd-row flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3.5 pb-1 pt-2 text-[13px]">
            <RefChip
               data={{
                  kind: 'issue',
                  ...issue.ref,
                  title: issue.title,
                  state: issue.state,
                  author: issue.author,
                  createdAt: issue.createdAt,
               }}
               repoShown={repoShown(issue.ref)}
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
            <AlsoIn slugs={issue.alsoIn} nameOf={nameOf} navigate={navigate} />
            {issue.state !== 'open' && issue.closedAt != null && (
               <span className="text-xs text-ink-3">
                  {issue.state} {dayOfEpoch(issue.closedAt)}
               </span>
            )}
            {onRemove && (
               <button
                  type="button"
                  onClick={onRemove}
                  className="pd-kebab hit pressable ml-auto rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-ink"
               >
                  Remove
               </button>
            )}
         </div>
         {issue.prs.length > 0 ? (
            // indented under the issue they do
            <div className="ml-6 pb-1">
               <Truncated cap={LIST_CAP} id={`work-prs:${issueKey(issue.ref)}`} label="more PRs">
                  {issue.prs.map(pr => (
                     <PullItem
                        key={issueKey(pr)}
                        pr={pr}
                        pulls={pulls}
                        late={isLate(pr)}
                        opts={opts}
                        repoShown={repoShown(pr)}
                     />
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
 * A project's work on its page: its open issues, each with the PRs that
 * link it under it; its PRs that link none of its issues; its done and
 * dropped issues; and the issues its PRs link that aren't in it, to add.
 * The search adds an issue by hand.
 */
export function ProjectWorkSection({
   slug,
   label,
   plans,
   pulls,
   opts,
   nameOf,
   navigate,
}: {
   slug: string;
   /** the project's label in full */
   label: string;
   plans: readonly RoadmapItem[] | null;
   pulls: PullLookup;
   /** how the board draws its PR rows */
   opts: RowOptions;
   /** a project's name, by slug */
   nameOf: (slug: string) => string;
   navigate: Navigate;
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
   // the repo most of the page is in goes unsaid on its chips (the hover
   // card still names it), so one from elsewhere stands out
   const repos = new Map<string, number>();
   for (const ref of [
      ...issues.flatMap(i => [i.ref, ...i.prs]),
      ...(page?.unlinked ?? []),
      ...(page?.suggested ?? []),
   ]) {
      repos.set(ref.repo.toLowerCase(), (repos.get(ref.repo.toLowerCase()) ?? 0) + 1);
   }
   const mainRepo = [...repos].sort((a, b) => b[1] - a[1])[0]?.[0];
   const repoShown = (ref: IssueRef) => ref.repo.toLowerCase() !== mainRepo;
   const blocks = (list: ProjectIssue[], id: string) => {
      // a just-added issue leads its list, so a long one can't hide it
      const ordered = landed
         ? [
              ...list.filter(i => issueKey(i.ref) === landed),
              ...list.filter(i => issueKey(i.ref) !== landed),
           ]
         : list;
      return (
         <Truncated cap={LIST_CAP} id={`work:${slug}:${id}`} label="more issues">
            {ordered.map(issue => (
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
                  opts={opts}
                  repoShown={repoShown}
                  nameOf={nameOf}
                  navigate={navigate}
               />
            ))}
         </Truncated>
      );
   };
   // a closed issue with a PR still open is work still moving, so its fold
   // starts open and says so; a PR under two of them counts once
   const closedFold = (state: 'done' | 'dropped', gloss?: string) => {
      const list = by(state);
      const open = new Set(list.flatMap(i => i.prs.filter(isOpenPr).map(issueKey))).size;
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
                  <Fold
                     count={page.unlinked.length}
                     label={issues.length ? 'PRs with no issue here' : 'Its PRs'}
                     gloss={`This project’s PRs${
                        issues.length ? ' that link none of its issues' : ''
                     }: the open ones, and the ones closed in the last 2 weeks.${
                        issues.length ? ' Add the issue each one does, or check it belongs.' : ''
                     }`}
                     id={`work:${slug}:unlinked`}
                     // a ledger of merged PRs can wait; an open one can't
                     defaultOpen={page.unlinked.some(isOpenPr)}
                  >
                     <Truncated cap={LIST_CAP} id={`work:${slug}:unlinked`} label="more PRs">
                        {page.unlinked.map(pr => (
                           <PullItem
                              key={issueKey(pr)}
                              pr={pr}
                              pulls={pulls}
                              late={isLate(pr)}
                              opts={opts}
                              repoShown={repoShown(pr)}
                           />
                        ))}
                     </Truncated>
                  </Fold>
                  {closedFold('done')}
                  {closedFold('dropped', 'Closed as not planned or as a duplicate')}
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
                              <RefChip
                                 data={{ kind: 'issue', ...issue }}
                                 repoShown={repoShown(issue)}
                              />
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
                              <AlsoIn slugs={issue.alsoIn} nameOf={nameOf} navigate={navigate} />
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
               page ? (
                  // the sub-line is the door to how the list is built
                  <SubDoor
                     label="What’s on this list"
                     text={`${issueWords} · ${n(openPrs, 'PR')} open`}
                  >
                     <p className="m-0">
                        Its issues are the ones with the {label} label on GitHub and the ones added
                        here.
                     </p>
                     <p className="m-0">
                        A PR shows under every issue it links (“Parts of #N”, “closes #N”). One that
                        links none of them shows under PRs with no issue here.
                     </p>
                  </SubDoor>
               ) : undefined
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
