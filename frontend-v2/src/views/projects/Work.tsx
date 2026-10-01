import { ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { issueUrl, n, shortRepo } from '../../../../shared/format';
import type { ClosedIssue } from '../../../../shared/model/decide';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import type { DerivedPull } from '../../../../shared/model/status';
import type { PullData } from '../../../../shared/types';
import {
   issueKey,
   type IssueHit,
   type IssuePull,
   type IssueRef,
   type ProjectIssue,
   type ProjectWork,
} from '../../../../shared/model/work';
import { LoadFailed } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { RefChip } from '../../components/GitHubRef';
import { Icon } from '../../components/Icon';
import { IssueSearch } from '../../components/IssueSearch';
import {
   Fold,
   GroupHeader,
   openFold,
   Rows,
   SubDoor,
   Truncated,
   useFoldChoices,
   useFoldState,
} from '../../components/Lane';
import { Row, type RowOptions } from '../../components/Row';
import { dayOf, dayWords } from '../../model/projectData';
import { changeProjectIssue, reloadProjectWork } from '../../model/projectWork';
import {
   addedLater,
   holderWords,
   issueStanding,
   lateWords,
   prStage,
   STAGE_ORDER,
   STAGE_WORDS,
   type IssueStage,
   type IssueStanding,
   type PrStage,
} from '../../model/stage';
import { byHandOnly } from '../../model/workData';
import { LAST_14_DAYS } from '../../model/words';
import type { Navigate } from './parts';

// a time as the day it fell on here, like the rest of the tab
const dayOfEpoch = (at: number) => dayWords(dayOf(new Date(at * 1000)));

/** a long list shows this many rows, then "+ N more" */
const LIST_CAP = 40;

/** how long a confirmation stays; an error stays until dismissed */
const NOTE_MS = 8000;

/** a word in a quiet line that goes somewhere when clicked */
const quietLink =
   'hit pressable rounded border-0 bg-transparent p-0 text-xs text-ink-2 underline decoration-line underline-offset-2 hover:text-brand';
/** an action in a section's header or on a line */
const actionLink =
   'hit pressable rounded border-0 bg-transparent p-0 text-xs font-medium text-brand hover:underline';

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

/** Which band of "PRs with no issue here" a PR sits in: an open one by
 * where it stands (one the board can't read counts as being worked on),
 * and the merged and closed ones together. */
const unlinkedBand = (pr: IssuePull, live: PullLookup['live']): PrStage | 'closed' => {
   const p = live(pr);
   return p ? prStage(p) : pr.state === 'open' ? 'work' : 'closed';
};

/** The store id that remembers whether an issue's PRs are shown. */
const prsFoldId = (slug: string, key: string) => `work:${slug}:prs:${key}`;

/**
 * Bring some of a page's PRs into view from its summary's counts: open the
 * bands and issue lines that hold them, then scroll to the first one on
 * the page and put focus on it.
 */
export function showPulls(
   slug: string,
   page: ProjectWork,
   live: PullLookup['live'],
   keys: ReadonlySet<string>
): void {
   for (const issue of page.issues) {
      if (!issue.prs.some(pr => keys.has(issueKey(pr)))) continue;
      openFold(`work:${slug}:${issueStanding(issue, live).stage}`);
      openFold(prsFoldId(slug, issueKey(issue.ref)));
   }
   for (const pr of page.unlinked) {
      if (keys.has(issueKey(pr))) openFold(`work:${slug}:unlinked:${unlinkedBand(pr, live)}`);
   }
   // once the folds have opened, so the rows are in place
   requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-pull]')].find(el =>
         keys.has(el.dataset.pull ?? '')
      );
      row?.scrollIntoView({ block: 'center' });
      row?.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
   });
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
 * The issues a PR does that other projects have, and where: "Does #35004,
 * in SSO approvals: the second path". The work may belong there, so each
 * project is a link to its page. `lead` when the words start the note.
 */
function Elsewhere({
   pr,
   lead,
   repoShown,
   nameOf,
   navigate,
}: {
   pr: IssuePull;
   lead: boolean;
   repoShown: (ref: IssueRef) => boolean;
   nameOf: (slug: string) => string;
   navigate: Navigate;
}) {
   return (
      <>
         {(pr.elsewhere ?? []).map(({ ref, projects }, i) => (
            <Fragment key={issueKey(ref)}>
               {i > 0 ? '; ' : lead ? 'Does ' : 'does '}
               {repoShown(ref) ? shortRepo(ref.repo) : ''}#{ref.number}, in{' '}
               {projects.map((slug, j) => (
                  <Fragment key={slug}>
                     {j > 0 && ', '}
                     <button
                        type="button"
                        onClick={() => navigate({ project: slug })}
                        // over the row's click layer, which opens the PR
                        className={`pd-raise ${quietLink}`}
                     >
                        {nameOf(slug)}
                     </button>
                  </Fragment>
               ))}
            </Fragment>
         ))}
      </>
   );
}

/**
 * A PR as the board draws it everywhere else: its row while it's open, its
 * closed row once it merged or closed in the last 14 days, or a plain line
 * for one the board hasn't read. Its footnote says who holds it, why it
 * stands out against the plan, and the issues it does in other projects.
 */
function PullItem({
   pr,
   pulls,
   late,
   opts,
   repoShown,
   nameOf,
   navigate,
   asRow = true,
   whoSaid = false,
}: {
   pr: IssuePull;
   pulls: PullLookup;
   /** why it stands out against its plan (lateWords), or null */
   late: string | null;
   opts: RowOptions;
   repoShown: (ref: IssueRef) => boolean;
   nameOf: (slug: string) => string;
   navigate: Navigate;
   /** the issue's line above it says who holds it already */
   whoSaid?: boolean;
   /** false where it's a second sighting (it links two issues here): the
    * board's row, with its id and actions, is drawn once a page */
   asRow?: boolean;
}) {
   const live = asRow ? pulls.live(pr) : undefined;
   const known = live || !asRow ? undefined : pulls.known(pr);
   // who holds an open one, in the words the issue's line uses, starting
   // the note: a login never takes a capital
   const parts: ReactNode[] = [];
   if (live && !whoSaid) {
      parts.push(
         holderWords(live, { turns: opts.turns, ageWarnDays: opts.ageWarnDays, line: true })
      );
   }
   if (late) parts.push(parts.length ? late : late[0].toUpperCase() + late.slice(1));
   if (pr.elsewhere?.length) {
      parts.push(
         <Elsewhere
            key="elsewhere"
            pr={pr}
            lead={!parts.length}
            repoShown={repoShown}
            nameOf={nameOf}
            navigate={navigate}
         />
      );
   }
   const note = parts.length
      ? parts.map((part, i) => (
           <Fragment key={i}>
              {i > 0 && ' · '}
              {part}
           </Fragment>
        ))
      : null;
   return (
      // the divider rides on this wrapper, so a note stays with its row; the
      // summary's counts find the row by its key
      <div data-pull={issueKey(pr)} className="border-t border-secondary first:border-t-0">
         {live ? (
            <Row pull={live} opts={opts} footnote={note} />
         ) : (
            <>
               {known ? (
                  <ClosedRow pull={known} lastSeen={opts.lastSeen} />
               ) : (
                  <PullLine pr={pr} repoShown={repoShown(pr)} />
               )}
               {/* these have no age line to keep clear of */}
               {note && (
                  <p
                     className={`m-0 -mt-1 pb-1.5 pr-3.5 text-xs text-ink-3 ${
                        known ? 'pl-[45px]' : 'pl-3.5'
                     }`}
                  >
                     {note}
                  </p>
               )}
            </>
         )}
      </div>
   );
}

/**
 * How an issue came to be here, when that's worth a word: added after its
 * plan took effect (scope that grew along the way), or added by hand, and
 * by whom when that's known. Nothing for one its label brought before the
 * plan, the usual case the section's sub-line explains.
 */
function addedWords(issue: ProjectIssue, planned: number | null): string {
   const hand = issue.via.includes('hand');
   if (!hand && !addedLater(issue, planned)) return '';
   const when = issue.attachedAt != null ? ` ${dayOfEpoch(issue.attachedAt)}` : hand ? ' here' : '';
   const added = `added${when}${issue.addedBy ? ` by ${issue.addedBy}` : ''}`;
   // with the label too, taking it off here wouldn't take it out
   return hand && issue.via.includes('label') ? `${added}, and has the label` : added;
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
                  className={quietLink}
               >
                  {nameOf(slug)}
               </button>
            </Fragment>
         ))}
      </span>
   );
}

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
   lateOf,
   planned,
   fresh,
   onRemove,
   opts,
   repoShown,
   nameOf,
   navigate,
   rowOwner,
   all,
}: {
   slug: string;
   issue: ProjectIssue;
   standing: IssueStanding;
   pulls: PullLookup;
   /** why each PR stands out against the plan (lateWords), or null */
   lateOf: (pr: IssuePull) => string | null;
   /** when its plan took effect; null with no plan */
   planned: number | null;
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
   /** the section's last "Show all PRs" or "Hide all PRs", which every
    * line follows */
   all: { open: boolean } | null;
}) {
   const key = issueKey(issue.ref);
   const [shown, setShown] = useFoldState(prsFoldId(slug, key), false);
   const has = issue.prs.length > 0;
   useEffect(() => {
      if (all && has && shown !== all.open) setShown(all.open);
   }, [all]);
   const added = addedWords(issue, planned);
   // its PRs that opened late, counted by why
   const late = new Map<string, number>();
   for (const pr of issue.prs) {
      const words = lateOf(pr);
      if (words) late.set(words, (late.get(words) ?? 0) + 1);
   }
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
               {added && (
                  <span className="text-xs text-ink-3">
                     {added}
                     {onRemove && (
                        // beside the words that say it was added by hand, away
                        // from who holds it; it shows on this line's hover or
                        // focus, as a row's verbs do, and always on touch and
                        // narrow screens
                        <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/issue:opacity-100 max-[719px]:opacity-100 [@media(hover:none)]:opacity-100">
                           <span aria-hidden> · </span>
                           <button
                              type="button"
                              onClick={onRemove}
                              aria-label={`Remove #${issue.ref.number} from this project`}
                              className={actionLink}
                           >
                              Remove
                           </button>
                        </span>
                     )}
                  </span>
               )}
               <AlsoIn slugs={issue.alsoIn} nameOf={nameOf} navigate={navigate} />
               {issue.state !== 'open' && issue.closedAt != null && (
                  <span className="text-xs text-ink-3">
                     {issue.state} {dayOfEpoch(issue.closedAt)}
                  </span>
               )}
               {[...late].map(([words, count]) => (
                  <span key={words} className="text-xs text-ink-3">
                     {n(count, 'PR')} {words}
                  </span>
               ))}
            </div>
            <span className="text-xs text-ink-2">{who}</span>
            {has ? (
               <button
                  type="button"
                  aria-expanded={shown}
                  // named for its issue, since a list of "1 PR" buttons can't be
                  // told apart out of context
                  aria-label={`${door}, for #${issue.ref.number} ${issue.title}`}
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
                        late={lateOf(pr)}
                        opts={opts}
                        repoShown={repoShown}
                        nameOf={nameOf}
                        navigate={navigate}
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
   /** still saving: it stays */
   busy?: boolean;
   undo?: () => void;
   /** what Undo undoes, for its name */
   undoLabel?: string;
   /** it failed: the same change again (an error stays until dismissed) */
   retry?: () => void;
   /** the button that made the change went with it, so focus moves here */
   focus?: boolean;
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
   planned,
   closed,
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
   /** when its plan took effect (model/stage.ts plannedAt); null with no plan */
   planned: number | null;
   /** its project's issue, when it's closed: a finish of its own */
   closed: ClosedIssue | null;
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
   // the note waits while the pointer or the focus is on it
   const [hovered, setHovered] = useState(false);
   const [focused, setFocused] = useState(false);
   const noteRef = useRef<HTMLSpanElement>(null);
   const [adding, setAdding] = useState(false);
   // the issue just added, to bring into view and flash once it shows
   const [landed, setLanded] = useState<string | null>(null);
   const scrolled = useRef<string | null>(null);
   // the last "Show all PRs" or "Hide all PRs"
   const [all, setAll] = useState<{ open: boolean } | null>(null);
   const choices = useFoldChoices();
   const mine = (plans ?? []).filter(p => p.project === slug);
   const lateOf = (pr: IssuePull) => lateWords(pr.createdAt, mine, closed);
   /** Add an issue or take it off. `focus` when the button clicked goes
    * with the change (Remove takes its line along), so focus moves to the
    * note's own button. */
   const change = (ref: IssueRef, add: boolean, focus: boolean) => {
      const name = `#${ref.number}`;
      setLanded(null);
      scrolled.current = null;
      setNote({ text: `${add ? 'Adding' : 'Removing'} ${name}…`, busy: true });
      void changeProjectIssue(slug, { repo: ref.repo, number: ref.number }, add).then(r => {
         if ('error' in r) {
            setNote({ text: r.error, retry: () => change(ref, add, focus), focus });
            return;
         }
         if (add) setLanded(issueKey(ref));
         setNote({
            text: `${add ? 'Added' : 'Removed'} ${name}.`,
            undo: () => change(ref, !add, true),
            undoLabel: `Undo ${add ? 'adding' : 'removing'} ${name}`,
            focus,
         });
      });
   };
   useEffect(() => {
      if (!note || note.busy || note.retry || hovered || focused) return;
      const wait = setTimeout(() => setNote(null), NOTE_MS);
      return () => clearTimeout(wait);
   }, [note, hovered, focused]);
   useEffect(() => {
      if (note?.focus) noteRef.current?.querySelector('button')?.focus();
   }, [note]);
   // a button in the note takes the note away, from under the pointer and
   // the focus alike: neither says it left
   const act = (then?: () => void) => () => {
      setNote(null);
      setHovered(false);
      setFocused(false);
      then?.();
   };
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
   // every issue's PRs at once, once two or more issues have any
   // ponytail: a line past its band's cap isn't drawn, so it follows the
   // click only once "+ N more" shows it; until then the toggle offers Show
   const withPrs = issues.filter(i => i.prs.length > 0);
   const allShown = withPrs.every(i => choices[prsFoldId(slug, issueKey(i.ref))] ?? false);
   const isOpenPr = (pr: IssuePull) => (pulls.live(pr) ? true : pr.state === 'open');
   const band = ({ stage, list }: { stage: IssueStage; list: ProjectIssue[] }) => {
      // a closed issue with a PR still open is work still moving, so its
      // band starts open and says so; a PR under two of them counts once
      const isClosed = stage === 'done' || stage === 'dropped';
      const open = isClosed
         ? new Set(list.flatMap(i => i.prs.filter(isOpenPr).map(issueKey))).size
         : 0;
      return (
         <Fold
            key={stage}
            count={list.length}
            label={STAGE_WORDS[stage]}
            gloss={STAGE_GLOSS[stage]}
            id={`work:${slug}:${stage}`}
            defaultOpen={!isClosed || open > 0}
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
                     lateOf={lateOf}
                     planned={planned}
                     fresh={landed === issueKey(issue.ref)}
                     onRemove={byHandOnly(issue) ? () => change(issue.ref, false, true) : null}
                     opts={opts}
                     repoShown={repoShown}
                     nameOf={nameOf}
                     navigate={navigate}
                     rowOwner={rowOwner}
                     all={all}
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
   const unlinkedBands = [
      ...(['ready', 'hold', 'review', 'work'] as PrStage[]).map(stage => ({
         id: stage as PrStage | 'closed',
         word: STAGE_WORDS[stage],
         gloss: PR_GLOSS[stage],
      })),
      {
         id: 'closed' as const,
         word: `Merged or closed in the ${LAST_14_DAYS}`,
         gloss: `Its PRs that merged or closed in the ${LAST_14_DAYS}`,
      },
   ]
      .map(b => ({ ...b, list: unlinked.filter(pr => unlinkedBand(pr, pulls.live) === b.id) }))
      .filter(b => b.list.length > 0);
   const unlinkedOpen = unlinked.filter(isOpenPr).length;
   return (
      <>
         <section id="project-issues" className="mb-7 scroll-mt-28">
            <GroupHeader
               level={3}
               title="Issues"
               sub={
                  // the sub-line is the door to how the list is built; an empty
                  // list says how below
                  counts?.total ? (
                     <SubDoor label="What’s on this list" text="by where they stand">
                        <p className="m-0">
                           Its issues are the ones with the {label} label on GitHub and the ones
                           added here. One added after its plan started says when.
                        </p>
                        <p className="m-0">
                           Each one is as far along as its least finished open PR: ready to merge,
                           on hold, waiting on review, or being worked on. Click an issue to see its
                           PRs.
                        </p>
                     </SubDoor>
                  ) : undefined
               }
               headerExtra={
                  <span className="flex items-center gap-4">
                     {withPrs.length > 1 && (
                        <button
                           type="button"
                           onClick={() => setAll({ open: !allShown })}
                           className={actionLink}
                        >
                           {allShown ? 'Hide all PRs' : 'Show all PRs'}
                        </button>
                     )}
                     <button
                        type="button"
                        onClick={() => setAdding(!adding)}
                        aria-expanded={adding}
                        className={actionLink}
                     >
                        {adding ? 'Done adding' : 'Add an issue'}
                     </button>
                  </span>
               }
            />
            {adding && (
               <div className="mb-3">
                  <IssueSearch
                     label="Add an issue to this project"
                     placeholder="Find an issue: title words, #123, or a link"
                     // the box stays, ready for the next one: focus stays in it
                     onPick={hit => change(hit, true, false)}
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
               <LoadFailed what="its issues and PRs" onRetry={reloadProjectWork} />
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
                  level={3}
                  title={issues.length ? 'PRs with no issue here' : 'Its PRs'}
                  sub={
                     <SubDoor
                        label="Which PRs are here"
                        text={[
                           unlinkedOpen ? `${unlinkedOpen} open` : '',
                           unlinked.length - unlinkedOpen
                              ? `${
                                   unlinked.length - unlinkedOpen
                                } merged or closed in the ${LAST_14_DAYS}`
                              : '',
                        ]
                           .filter(Boolean)
                           .join(' · ')}
                     >
                        <p className="m-0">
                           The PRs with the {label} label
                           {issues.length ? ' that link none of its issues' : ''}: the open ones,
                           and the ones merged or closed in the {LAST_14_DAYS}.
                        </p>
                        {issues.length > 0 && (
                           <p className="m-0">
                              Add the issue each one does (“Parts of #N” in its description), or
                              check it belongs here. One that does an issue of another project says
                              which.
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
                                 late={lateOf(pr)}
                                 opts={opts}
                                 repoShown={repoShown}
                                 nameOf={nameOf}
                                 navigate={navigate}
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
               <GroupHeader
                  level={3}
                  title="Issues linked from its PRs"
                  sub="not in this project yet"
               />
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
                           <button
                              type="button"
                              // its line goes once it's added, so focus moves to the note
                              onClick={() => change(issue, true, true)}
                              aria-label={`Add #${issue.number} to this project`}
                              className={`ml-auto ${actionLink}`}
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
                     ref={noteRef}
                     onMouseEnter={() => setHovered(true)}
                     onMouseLeave={() => setHovered(false)}
                     onFocus={() => setFocused(true)}
                     onBlur={e => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                           setFocused(false);
                        }
                     }}
                     // ink, never red: a failed save is nobody's alarm
                     className="pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink shadow-md"
                  >
                     <span>{note.text}</span>
                     {note.undo && (
                        <button
                           type="button"
                           onClick={act(note.undo)}
                           aria-label={note.undoLabel}
                           className={`flex-none ${actionLink}`}
                        >
                           Undo
                        </button>
                     )}
                     {note.retry && (
                        <>
                           <button
                              type="button"
                              onClick={act(note.retry)}
                              className={`flex-none ${actionLink}`}
                           >
                              Try again
                           </button>
                           <button
                              type="button"
                              onClick={act()}
                              className="hit pressable flex-none rounded border-0 bg-transparent p-0 text-xs text-ink-3 hover:text-ink"
                           >
                              Dismiss
                           </button>
                        </>
                     )}
                  </span>
               )}
            </div>,
            document.body
         )}
      </>
   );
}
