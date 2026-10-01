import { ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type MouseEvent } from 'react';
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
   type ProjectWork,
} from '../../../../shared/model/work';
import { ClosedRow } from '../../components/ClosedRow';
import { RefChip } from '../../components/GitHubRef';
import { Icon } from '../../components/Icon';
import { IssueSearch } from '../../components/IssueSearch';
import {
   Fold,
   GroupHeader,
   Rows,
   SubDoor,
   Truncated,
   useFoldChoices,
   useFoldState,
} from '../../components/Lane';
import { Row, type RowOptions } from '../../components/Row';
import { dayOf, dayWords } from '../../model/projectData';
import { changeProjectIssue } from '../../model/projectWork';
import {
   holderWords,
   issueStanding,
   prStage,
   STAGE_ORDER,
   STAGE_WORDS,
   type IssueStage,
   type IssueStanding,
   type PrStage,
} from '../../model/stage';
import type { Navigate } from './parts';

// a time as the day it fell on here, like the rest of the tab
const dayOfEpoch = (at: number) => dayWords(dayOf(new Date(at * 1000)));

/** a long list shows this many rows, then "+ N more" */
const LIST_CAP = 40;

/** how long a confirmation stays; an error stays until dismissed */
const NOTE_MS = 8000;

/** what each stage's band means, on hovering its name */
const STAGE_GLOSS: Record<IssueStage, string> = {
   ready: 'Its PRs are signed off: what’s left is merging them',
   hold: 'A PR of it is parked, blocked outside the repo, or signed off and held for a deploy',
   review: 'A PR of it is waiting on a code review or on QA',
   work: 'A PR of it is a draft, blocked, failing CI, signed off but in conflict, or has changes asked for',
   merged: 'Its PRs merged and the issue is still open: close it, or more work is coming',
   none: 'No PR links it yet',
   done: 'Closed as completed',
   dropped: 'Closed as not planned or as a duplicate',
};

/** what each stage's band means for a PR that does no issue here */
const PR_GLOSS: Record<PrStage, string> = {
   ready: 'Signed off: what’s left is merging it',
   hold: 'Parked, blocked outside the repo, or signed off and held for a deploy',
   review: 'Waiting on a code review or on QA',
   work: 'A draft, blocked, failing CI, signed off but in conflict, or has changes asked for',
};

/** What the board knows of a PR: its live row's data when it's open on the
 * board, or its data from the last two weeks' merges. */
export interface PullLookup {
   live: (ref: IssueRef) => DerivedPull | undefined;
   known: (ref: IssueRef) => PullData | undefined;
}

/** A PR the board hasn't read (it closed long ago, or it's in a repo the
 * board doesn't track), or one drawn in full elsewhere on the page: its
 * chip, title, author and day, as far as known. */
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
   asRow = true,
   whoSaid = false,
}: {
   pr: IssuePull;
   pulls: PullLookup;
   /** it opened after the end of the plan it counts toward */
   late: boolean;
   opts: RowOptions;
   repoShown: boolean;
   /** the issue's line above it says who holds it already */
   whoSaid?: boolean;
   /** false where it's a second sighting (it links two issues here): the
    * board's row, with its id and actions, is drawn once a page */
   asRow?: boolean;
}) {
   const live = asRow ? pulls.live(pr) : undefined;
   const known = live || !asRow ? undefined : pulls.known(pr);
   // who holds an open one, in the words the issue's line uses
   const note = [
      live && !whoSaid
         ? holderWords(live, { turns: opts.turns, ageWarnDays: opts.ageWarnDays })
         : '',
      late ? 'opened after the plan ended' : '',
   ]
      .filter(Boolean)
      .join(' · ');
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
         {note && (
            <p className="m-0 -mt-1 pb-1.5 pl-[45px] pr-3.5 text-xs text-ink-3">
               {note[0].toUpperCase() + note.slice(1)}
            </p>
         )}
      </div>
   );
}

/** How an issue added here came to be here, in words. Nothing for one its
 * label brought, the usual case the section's sub-line explains. */
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

/** The store id that remembers whether an issue's PRs are shown. */
const prsFoldId = (slug: string, key: string) => `work:${slug}:prs:${key}`;

/**
 * One issue on one line: what it is, who holds it now, and how many PRs do
 * it. Its PRs, as the board draws them, are one click away: the count, or
 * anywhere on the line that isn't a link.
 */
function IssueLine({
   slug,
   issue,
   standing,
   pulls,
   isLate,
   fresh,
   onRemove,
   opts,
   repoShown,
   nameOf,
   navigate,
   rowOwner,
}: {
   slug: string;
   issue: ProjectIssue;
   standing: IssueStanding;
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
   /** which shown issue draws each PR's board row: its first on the page */
   rowOwner: ReadonlyMap<string, string>;
}) {
   const key = issueKey(issue.ref);
   const [shown, setShown] = useFoldState(prsFoldId(slug, key), false);
   const via = viaWords(issue);
   const late = issue.prs.filter(isLate).length;
   const has = issue.prs.length > 0;
   // the PR count, and the stages its band doesn't already say
   const others = new Map<string, number>();
   for (const pr of issue.prs) {
      const live = pulls.live(pr);
      const word = live
         ? prStage(live) === standing.stage
            ? null
            : STAGE_WORDS[prStage(live)].toLowerCase()
         : pr.state === 'merged'
         ? standing.stage === 'merged'
            ? null
            : 'merged'
         : pr.state === 'closed'
         ? 'closed without merging'
         : null;
      if (word) others.set(word, (others.get(word) ?? 0) + 1);
   }
   const door = [
      n(issue.prs.length, 'PR'),
      ...[...others].map(([word, count]) => `${count} ${word}`),
   ].join(', ');
   const who = standing.pull
      ? holderWords(standing.pull, { turns: opts.turns, ageWarnDays: opts.ageWarnDays })
      : '';
   // anywhere on the line but its links opens or closes its PRs
   const lineClick = (e: MouseEvent) => {
      if (!has || (e.target as HTMLElement).closest('a,button,input,label')) return;
      setShown(!shown);
   };
   return (
      <div
         data-issue={key}
         className={`@container border-t border-secondary first:border-t-0 ${
            fresh ? 'row-fresh' : ''
         }`}
      >
         <div
            onClick={lineClick}
            className={`group/issue grid gap-x-4 gap-y-1 px-3.5 py-2.5 @min-[720px]:grid-cols-[minmax(0,1fr)_13rem_10rem] @min-[720px]:items-baseline @min-[960px]:grid-cols-[minmax(0,1fr)_17rem_12rem] ${
               has ? 'cursor-pointer hover:bg-muted/40' : ''
            }`}
         >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
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
                  className="min-w-0 break-words text-sm font-medium text-ink hover:text-brand hover:underline"
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
               {late > 0 && (
                  <span className="text-xs text-ink-3">
                     {n(late, 'PR')} opened after the plan ended
                  </span>
               )}
               {onRemove && (
                  <button
                     type="button"
                     onClick={onRemove}
                     // last, so unseen it pushes nothing along; it shows on this
                     // line's hover or focus, as a row's menu does, and always on
                     // touch and narrow screens
                     className="hit pressable ml-auto rounded border-0 bg-transparent p-0 text-xs text-ink-3 opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/issue:opacity-100 max-[719px]:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                     Remove
                  </button>
               )}
            </div>
            <span className="text-xs text-ink-2">{who}</span>
            {has ? (
               <button
                  type="button"
                  aria-expanded={shown}
                  onClick={() => setShown(!shown)}
                  className="hit pressable inline-flex items-center gap-1 justify-self-start rounded border-0 bg-transparent p-0 text-left text-xs text-ink-3 hover:text-brand @min-[720px]:justify-self-end"
               >
                  <Icon
                     icon={ChevronRight}
                     size={12}
                     className={`flex-none transition-[rotate] duration-150 ${
                        shown ? 'rotate-90' : ''
                     }`}
                  />
                  {door}
               </button>
            ) : (
               <span />
            )}
         </div>
         {shown && has && (
            // under the issue they do, set in from it
            <div className="ml-6 border-t border-secondary pb-2 @max-[520px]:ml-3">
               <Truncated cap={LIST_CAP} id={`work-prs:${key}`} label="more PRs">
                  {issue.prs.map(pr => (
                     <PullItem
                        key={issueKey(pr)}
                        pr={pr}
                        pulls={pulls}
                        late={isLate(pr)}
                        opts={opts}
                        repoShown={repoShown(pr)}
                        asRow={rowOwner.get(issueKey(pr)) === key}
                        // its only PR is the one the line's holder words are about;
                        // a closed issue's line names no holder
                        whoSaid={issue.prs.length === 1 && standing.pull != null}
                     />
                  ))}
               </Truncated>
            </div>
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
 * A project's work, in three sections. Its issues, each on one line, in
 * bands by stage: what's nearest to shipping first, then what's waiting,
 * then what isn't started, then the closed ones; each issue's PRs one click
 * away. Its PRs that link none of its issues, in bands by stage too. And
 * the issues its PRs link that aren't in it, to add.
 */
export function ProjectWorkSections({
   slug,
   label,
   plans,
   page,
   pulls,
   opts,
   nameOf,
   navigate,
}: {
   slug: string;
   /** the project's label in full */
   label: string;
   plans: readonly RoadmapItem[] | null;
   /** its issues and PRs: undefined while they load, null if that failed */
   page: ProjectWork | null | undefined;
   pulls: PullLookup;
   /** how the board draws its PR rows */
   opts: RowOptions;
   /** a project's name, by slug */
   nameOf: (slug: string) => string;
   navigate: Navigate;
}) {
   const [note, setNote] = useState<Note | null>(null);
   // the note waits while the pointer is on it
   const [held, setHeld] = useState(false);
   const [adding, setAdding] = useState(false);
   // the issue just added, to bring into view and flash once it shows
   const [landed, setLanded] = useState<string | null>(null);
   const scrolled = useRef<string | null>(null);
   const choices = useFoldChoices();
   const mine = (plans ?? []).filter(p => p.project === slug);
   const isLate = (pr: IssuePull) => {
      if (pr.createdAt == null) return false;
      const plan = planOfWork(mine, pr.createdAt);
      return !!plan && pr.createdAt >= afterEndOf(plan);
   };
   const change = (issue: IssueRef & { state?: ItemState }, add: boolean) => {
      const ref = { repo: issue.repo, number: issue.number };
      setLanded(null);
      setHeld(false);
      scrolled.current = null;
      setNote({ text: `${add ? 'Adding' : 'Removing'} #${ref.number}…`, busy: true });
      void changeProjectIssue(slug, ref, add).then(r => {
         if ('error' in r) setNote({ text: r.error, error: true });
         else if (!add)
            setNote({ text: `Removed #${ref.number}.`, undo: () => change(issue, true) });
         else {
            setLanded(issueKey(ref));
            setNote({ text: `Added #${ref.number}.`, undo: () => change(issue, false) });
         }
      });
   };
   useEffect(() => {
      if (!note || note.busy || note.error || held) return;
      const wait = setTimeout(() => setNote(null), NOTE_MS);
      return () => clearTimeout(wait);
   }, [note, held]);
   // an added issue: open the band it's in and bring it into view
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
   const standings = new Map(issues.map(i => [issueKey(i.ref), issueStanding(i, pulls.live)]));
   const stageOf = (i: ProjectIssue) => standings.get(issueKey(i.ref))?.stage ?? 'none';
   // a just-added issue leads its band, so a long one can't hide it
   const ordered = (list: ProjectIssue[]) =>
      landed
         ? [
              ...list.filter(i => issueKey(i.ref) === landed),
              ...list.filter(i => issueKey(i.ref) !== landed),
           ]
         : list;
   const bands = STAGE_ORDER.map(stage => ({
      stage,
      list: ordered(issues.filter(i => stageOf(i) === stage)),
   })).filter(b => b.list.length > 0);
   // a PR linking two issues is drawn in full under the first one shown, in
   // the page's order, and as a plain line under any other
   const rowOwner = new Map<string, string>();
   for (const { list } of bands) {
      for (const issue of list) {
         const key = issueKey(issue.ref);
         if (!(choices[prsFoldId(slug, key)] ?? false)) continue;
         for (const pr of issue.prs) {
            if (!rowOwner.has(issueKey(pr))) rowOwner.set(issueKey(pr), key);
         }
      }
   }
   const isOpenPr = (pr: IssuePull) => (pulls.live(pr) ? true : pr.state === 'open');
   const band = ({ stage, list }: { stage: IssueStage; list: ProjectIssue[] }) => {
      // a closed issue with a PR still open is work still moving, so its
      // band starts open and says so; a PR under two of them counts once
      const closed = stage === 'done' || stage === 'dropped';
      const open = closed
         ? new Set(list.flatMap(i => i.prs.filter(isOpenPr).map(issueKey))).size
         : 0;
      return (
         <Fold
            key={stage}
            count={list.length}
            label={STAGE_WORDS[stage]}
            gloss={STAGE_GLOSS[stage]}
            id={`work:${slug}:${stage}`}
            defaultOpen={!closed || open > 0}
            detail={open ? `${n(open, 'PR')} still open` : undefined}
         >
            <Truncated cap={LIST_CAP} id={`work:${slug}:${stage}`} label="more issues">
               {list.map(issue => (
                  <IssueLine
                     key={issueKey(issue.ref)}
                     slug={slug}
                     issue={issue}
                     standing={standings.get(issueKey(issue.ref)) ?? { stage: 'none', pull: null }}
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
                     rowOwner={rowOwner}
                  />
               ))}
            </Truncated>
         </Fold>
      );
   };
   const whereIs = (hit: IssueHit) => {
      const others = (hit.projects ?? []).filter(s => s !== slug);
      return others.length ? `in ${others.map(nameOf).join(', ')}` : null;
   };
   const counts = page?.counts;
   const unlinked = page?.unlinked ?? [];
   const openIssues = issues.filter(i => i.state === 'open').length;
   // its PRs with no issue, by stage: open ones by where they stand, and the
   // ones merged or closed lately together
   const unlinkedBands: { id: string; word: string; gloss: string; list: IssuePull[] }[] = [
      ...(['ready', 'hold', 'review', 'work'] as PrStage[]).map(stage => ({
         id: stage,
         word: STAGE_WORDS[stage],
         gloss: PR_GLOSS[stage],
         list: unlinked.filter(pr => {
            const live = pulls.live(pr);
            return live ? prStage(live) === stage : stage === 'work' && pr.state === 'open';
         }),
      })),
      {
         id: 'closed',
         word: 'Merged or closed in the last 2 weeks',
         gloss: 'Its PRs that merged or closed in the last 2 weeks',
         list: unlinked.filter(pr => !pulls.live(pr) && pr.state !== 'open'),
      },
   ].filter(b => b.list.length > 0);
   const unlinkedOpen = unlinked.filter(isOpenPr).length;
   return (
      <>
         <section id="project-issues" className="mb-7 scroll-mt-28">
            <GroupHeader
               title="Issues"
               sub={
                  // the sub-line is the door to how the list is built; an empty
                  // list says how below
                  counts?.total ? (
                     <SubDoor label="What’s on this list" text="by where they stand">
                        <p className="m-0">
                           Its issues are the ones with the {label} label on GitHub and the ones
                           added here.
                        </p>
                        <p className="m-0">
                           Each one is as far along as its least finished open PR: ready to ship, on
                           hold, waiting on review, or being worked on. Click an issue to see its
                           PRs.
                        </p>
                     </SubDoor>
                  ) : undefined
               }
               headerExtra={
                  <button
                     type="button"
                     onClick={() => setAdding(!adding)}
                     aria-expanded={adding}
                     className="hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline"
                  >
                     {adding ? 'Done adding' : 'Add an issue'}
                  </button>
               }
            />
            {adding && (
               <div className="mb-3">
                  <IssueSearch
                     label="Add an issue to this project"
                     placeholder="Find an issue: title words, #123, or a link"
                     onPick={hit => change(hit, true)}
                     taken={new Set(issues.map(i => issueKey(i.ref)))}
                     takenWords="in this project already"
                     whereIs={whereIs}
                     autoFocus
                  />
               </div>
            )}
            {page === undefined ? (
               <p className="m-0 text-[13px] text-ink-3">Loading its issues…</p>
            ) : page === null ? (
               <p className="m-0 text-[13px] text-ink-3">
                  Couldn’t load its issues and PRs. Try again in a minute.
               </p>
            ) : issues.length ? (
               <Rows>{bands.map(band)}</Rows>
            ) : (
               <p className="m-0 text-[13px] text-ink-3">
                  No issues yet.{' '}
                  {adding ? (
                     'Find one above, or'
                  ) : (
                     <>
                        <button
                           type="button"
                           onClick={() => setAdding(true)}
                           className="hit pressable rounded border-0 bg-transparent p-0 text-[13px] font-medium text-brand hover:underline"
                        >
                           Add one
                        </button>
                        , or
                     </>
                  )}{' '}
                  give an issue the {label} label on GitHub: the label that puts PRs in this
                  project.
               </p>
            )}
         </section>
         {unlinkedBands.length > 0 && (
            <section className="mb-7">
               <GroupHeader
                  title={issues.length ? 'PRs with no issue here' : 'Its PRs'}
                  sub={
                     <SubDoor
                        label="Which PRs are here"
                        text={[
                           unlinkedOpen ? `${unlinkedOpen} open` : '',
                           unlinked.length - unlinkedOpen
                              ? `${unlinked.length - unlinkedOpen} merged or closed lately`
                              : '',
                        ]
                           .filter(Boolean)
                           .join(' · ')}
                     >
                        <p className="m-0">
                           The PRs with the {label} label
                           {issues.length ? ' that link none of its issues' : ''}: the open ones,
                           and the ones merged or closed in the last 2 weeks.
                        </p>
                        {issues.length > 0 && (
                           <p className="m-0">
                              Add the issue each one does (“Parts of #N” in its description), or
                              check it belongs here.
                           </p>
                        )}
                     </SubDoor>
                  }
               />
               <Rows>
                  {unlinkedBands.map(b => (
                     <Fold
                        key={b.id}
                        count={b.list.length}
                        label={b.word}
                        gloss={b.gloss}
                        id={`work:${slug}:unlinked:${b.id}`}
                        // their counts are the summary while its issues are open
                        defaultOpen={!openIssues}
                     >
                        <Truncated
                           cap={LIST_CAP}
                           id={`work:${slug}:unlinked:${b.id}`}
                           label="more PRs"
                        >
                           {b.list.map(pr => (
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
                  ))}
               </Rows>
            </section>
         )}
         {(page?.suggested.length ?? 0) > 0 && (
            <section className="mb-7">
               <GroupHeader title="Issues its PRs link" sub="not in this project yet" />
               <Rows>
                  <Truncated cap={LIST_CAP} id={`work:${slug}:suggested`} label="more issues">
                     {(page?.suggested ?? []).map(issue => (
                        <div
                           key={issueKey(issue)}
                           className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-secondary px-3.5 py-2.5 text-[13px] first:border-t-0"
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
               </Rows>
            </section>
         )}
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
                     onMouseEnter={() => setHeld(true)}
                     onMouseLeave={() => setHeld(false)}
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
                              // it leaves from under the pointer: no mouseleave comes
                              setHeld(false);
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
      </>
   );
}
