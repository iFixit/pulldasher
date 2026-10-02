import { ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { githubUrl, issueUrl, n, shortRepo } from '../../../../shared/format';
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
   type SuggestedIssue,
} from '../../../../shared/model/work';
import { ClosedBadge, FactLink, LoadFailed, TextButton } from '../../components/bits';
import { ClosedRow } from '../../components/ClosedRow';
import { RefChip } from '../../components/GitHubRef';
import { Icon } from '../../components/Icon';
import { IssueSearch } from '../../components/IssueSearch';
import {
   Fold,
   foldDomId,
   GroupHeader,
   openFold,
   Rows,
   SubDoor,
   Truncated,
   useFoldChoices,
   useFoldState,
} from '../../components/Lane';
import { Row, type RowOptions } from '../../components/Row';
import { useRowKeys } from '../../components/useRowKeys';
import { usePageKey } from '../../hooks';
import { changeProjectIssue, reloadProjectWork } from '../../model/projectWork';
import {
   addedLater,
   dateWords,
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
import { removable } from '../../model/workData';
import { LAST_14_DAYS } from '../../model/words';
import type { Navigate } from './parts';

/** a long list shows this many rows, then "+ N more" */
const LIST_CAP = 40;

/** a PR on an issue's line that another project's label (or link) claims */
const COUNTED_ELSEWHERE = 'counted in another project';
const upperFirst = (s: string) => s[0].toUpperCase() + s.slice(1);

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
 * where it stands (one the board can't read counts as in development),
 * and the merged and closed ones together. */
const unlinkedBand = (pr: IssuePull, live: PullLookup['live']): PrStage | 'closed' => {
   const p = live(pr);
   return p ? prStage(p) : pr.state === 'open' ? 'work' : 'closed';
};

/** The store id that remembers whether an issue's PRs are shown. */
const prsFoldId = (slug: string, key: string) => `work:${slug}:prs:${key}`;

/** A row the page points at flashes once, the way a just-added issue does
 * (by hand, as the board's own fold flash does: React draws the row). */
function flash(el: HTMLElement) {
   el.classList.add('row-fresh');
   setTimeout(() => el.classList.remove('row-fresh'), 1100);
}

/**
 * Bring some of a page's PRs into view from its summary's counts: open the
 * bands and issue lines that hold them, and a list's "+ N more" when one
 * is past it, then scroll to the first, put focus on it, and flash them
 * all, so the ones further down say they were counted too.
 */
export function showPulls(
   slug: string,
   page: ProjectWork,
   live: PullLookup['live'],
   keys: ReadonlySet<string>
): void {
   const folds = new Set<string>();
   for (const issue of page.issues) {
      if (!issue.prs.some(pr => keys.has(issueKey(pr)))) continue;
      folds.add(`work:${slug}:${issueStanding(issue, live).stage}`);
      openFold(prsFoldId(slug, issueKey(issue.ref)));
   }
   for (const pr of page.unlinked) {
      if (keys.has(issueKey(pr))) folds.add(`work:${slug}:unlinked:${unlinkedBand(pr, live)}`);
   }
   for (const id of folds) openFold(id);
   const rows = () =>
      [...document.querySelectorAll<HTMLElement>('[data-pull]')].filter(el =>
         keys.has(el.dataset.pull ?? '')
      );
   // once the folds have opened, so the rows are in place; a row past its
   // list's cap needs that list's "+ N more" first, and the PRs under an
   // issue line it shows need one more frame
   const land = (tries: number) =>
      requestAnimationFrame(() => {
         const found = rows();
         const missing = new Set(found.map(el => el.dataset.pull)).size < keys.size;
         const more = missing
            ? [...folds].flatMap(id => [
                 ...(document
                    .getElementById(foldDomId(id))
                    ?.querySelectorAll<HTMLElement>('[data-row-more]') ?? []),
              ])
            : [];
         if (more.length && tries > 0) {
            for (const button of more) button.click();
            land(tries - 1);
            return;
         }
         found[0]?.scrollIntoView({ block: 'center' });
         found[0]?.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
         found.forEach(flash);
      });
   land(2);
}

/** A PR the board hasn't read (it closed long ago, or it's in a repo the
 * board doesn't track), or one drawn in full elsewhere on the page: its
 * chip, title, author and day, as far as known. */
function PullLine({ pr, repoShown }: { pr: IssuePull; repoShown: boolean }) {
   return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-1.5 text-[13px]">
         {pr.title ? (
            <>
               {/* the title is the way in for a keyboard; the chip's card is a glance */}
               <RefChip data={{ kind: 'pr', ...pr }} repoShown={repoShown} tabStop={false} />
               <a
                  href={githubUrl(pr.repo, pr.number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 break-words text-ink hover:text-brand hover:underline"
               >
                  {pr.title}
               </a>
            </>
         ) : (
            // nothing more is known of it than its number, so that's the way to it
            <a
               href={githubUrl(pr.repo, pr.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="text-xs font-medium text-ink-2 hover:text-brand hover:underline"
            >
               PR #{pr.number}
               {repoShown && ` in ${shortRepo(pr.repo)}`}
            </a>
         )}
         <span className="text-xs text-ink-3">
            {[pr.author, pr.createdAt != null ? `opened ${dateWords(pr.createdAt)}` : '']
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
                     {/* over the row's click layer, which opens the PR */}
                     <FactLink onClick={() => navigate({ project: slug })} className="pd-raise">
                        {nameOf(slug)}
                     </FactLink>
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
 * for one the board hasn't read. Its footnote adds what the row can't say:
 * whose turn it is or what holds it, why it stands out against the plan,
 * and the issues it does in other projects.
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
   // who holds an open one, in the words the issue's line uses, less what
   // the row shows itself (the face, a flag, the age), starting the note: a
   // login never takes a capital
   const parts: ReactNode[] = [];
   const who =
      live && !whoSaid ? holderWords(live, { turns: opts.turns, line: true, onRow: true }) : '';
   if (who) parts.push(who);
   if (late) parts.push(parts.length ? late : upperFirst(late));
   // a person's PR this page's counts leave out, the way every view does
   if (pr.outside && (live || known)) {
      parts.push(parts.length ? COUNTED_ELSEWHERE : upperFirst(COUNTED_ELSEWHERE));
   }
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
      // summary's counts, and j and k, find the row by its key
      <div
         data-pull={issueKey(pr)}
         className="scroll-mt-36 scroll-mb-4 border-t border-secondary first:border-t-0"
      >
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
                     className={`m-0 -mt-1 flex gap-2.5 pb-1.5 pr-3.5 text-xs text-ink-3 ${
                        known ? 'pl-[11px]' : 'pl-3.5'
                     }`}
                  >
                     {known && (
                        // stand-ins as wide as the row's badge and face, so the
                        // note starts under its title as a row's footnote does
                        <span aria-hidden className="invisible flex flex-none gap-2.5">
                           <ClosedBadge merged={!!known.merged_at} inline />
                           <span className="w-[22px]" />
                        </span>
                     )}
                     <span className="min-w-0">{note}</span>
                  </p>
               )}
            </>
         )}
      </div>
   );
}

/** A PR named in a line's words, by its number, to open on GitHub. */
function PullRef({ pr, repoShown }: { pr: IssueRef; repoShown: boolean }) {
   return (
      <a
         href={githubUrl(pr.repo, pr.number)}
         target="_blank"
         rel="noopener noreferrer"
         className="text-ink-2 underline decoration-line underline-offset-2 hover:text-brand"
      >
         PR #{pr.number}
         {repoShown && ` in ${shortRepo(pr.repo)}`}
      </a>
   );
}

/**
 * How an issue came to be here, when that's worth a word: joined by a link
 * from one of its PRs (always said, since no person put it here), added by
 * hand, and by whom when that's known, or added after its plan took effect
 * (scope that grew along the way, with when). Nothing for one its label
 * brought before the plan, the usual case the section's sub-line explains.
 */
function addedWords(
   issue: ProjectIssue,
   planned: number | null,
   repoShown: (ref: IssueRef) => boolean
): ReactNode {
   const hand = issue.via.includes('hand');
   const later = addedLater(issue, planned);
   const labeled = issue.via.includes('label');
   // with the label too, taking it off here wouldn't take it out
   const andLabel = labeled ? ', and has the label' : '';
   if (issue.via.includes('link') && issue.linkedBy) {
      return (
         <>
            linked by <PullRef pr={issue.linkedBy} repoShown={repoShown(issue.linkedBy)} />
            {later && issue.attachedAt != null && ` on ${dateWords(issue.attachedAt)}`}
            {andLabel}
         </>
      );
   }
   if (!hand && !later) return null;
   const when = issue.attachedAt != null ? ` ${dateWords(issue.attachedAt)}` : hand ? ' here' : '';
   const added = `added${when}${issue.addedBy ? ` by ${issue.addedBy}` : ''}`;
   return hand ? `${added}${andLabel}` : added;
}

/** The other projects an issue is in, each a link to its page: "also in"
 * one this project has, "in" one it doesn't. */
function AlsoIn({
   slugs,
   nameOf,
   navigate,
   lead = 'also in',
}: {
   slugs: string[];
   nameOf: (slug: string) => string;
   navigate: Navigate;
   lead?: string;
}) {
   if (!slugs.length) return null;
   return (
      <span className="text-xs text-ink-3">
         {lead}{' '}
         {slugs.map((slug, i) => (
            <Fragment key={slug}>
               {i > 0 && ', '}
               <FactLink onClick={() => navigate({ project: slug })}>{nameOf(slug)}</FactLink>
            </Fragment>
         ))}
      </span>
   );
}

/**
 * A change said where it was made: what happened and the way back, or why
 * it didn't save and the way to try again. Its first button takes the
 * focus when the button clicked went with the change.
 */
function Receipt({
   words,
   onUndo,
   undoLabel,
   onRetry,
   onCancel,
   focus,
}: {
   words: string;
   onUndo?: () => void;
   undoLabel?: string;
   onRetry?: () => void;
   onCancel?: () => void;
   focus: boolean;
}) {
   return (
      // a screen reader hears it from the section's live line, once
      <p className="m-0 flex max-w-[70ch] flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-2">
         <span aria-hidden>{words}</span>
         {onUndo && (
            <TextButton autoFocus={focus} onClick={onUndo} aria-label={undoLabel}>
               Undo
            </TextButton>
         )}
         {onRetry && (
            <TextButton autoFocus={focus} onClick={onRetry}>
               Try again
            </TextButton>
         )}
         {onCancel && (
            <TextButton tone="quiet" onClick={onCancel}>
               Cancel
            </TextButton>
         )}
      </p>
   );
}

/**
 * One issue on one line: what it is, who holds it now, and how many PRs do
 * it. Its PRs, as the board draws them, are one click away: the count, or
 * anywhere on the line that isn't a link. A line just taken off stays
 * where it was, faded, saying so, so the next line never slides under the
 * pointer.
 */
function IssueLine({
   slug,
   label,
   issue,
   standing,
   pulls,
   lateOf,
   planned,
   fresh,
   onRemove,
   receipt,
   gone,
   focusRemove,
   opts,
   repoShown,
   nameOf,
   navigate,
   rowOwner,
   all,
}: {
   slug: string;
   /** the project's label in full */
   label: string;
   issue: ProjectIssue;
   standing: IssueStanding;
   pulls: PullLookup;
   /** why each PR stands out against the plan (lateWords), or null */
   lateOf: (pr: IssuePull) => string | null;
   /** when its plan took effect; null with no plan */
   planned: number | null;
   /** just added: it flashes once */
   fresh: boolean;
   /** take it off the project; only for one added here or by a link, not
    * labeled */
   onRemove: (() => void) | null;
   /** a change made on this line, said under it in place of Remove */
   receipt: ReactNode;
   /** taken off (or being): faded, kept until the next change */
   gone: boolean;
   /** Remove is back after an Undo: the focus goes to it */
   focusRemove: boolean;
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
   const has = issue.prs.length > 0 && !gone;
   useEffect(() => {
      if (all && has && shown !== all.open) setShown(all.open);
   }, [all]);
   const added = addedWords(issue, planned, repoShown);
   // one with the label comes off by the label, which is GitHub's
   const offOnGitHub = !onRemove && issue.via.includes('label');
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
            // j and k land here, below the sticky headers
            data-issue-row
            onClick={lineClick}
            className={`group/issue grid scroll-mt-36 scroll-mb-4 gap-x-4 gap-y-1 px-3.5 py-2.5 @min-[720px]:grid-cols-[minmax(0,1fr)_13rem_10rem] @min-[720px]:items-baseline @min-[960px]:grid-cols-[minmax(0,1fr)_17rem_14rem] ${
               has ? 'cursor-pointer hover:bg-muted/40' : ''
            } ${gone ? 'opacity-60' : ''}`}
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
                  // the title and the PR count are the line's ways in
                  tabStop={false}
               />
               <a
                  href={issueUrl(issue.ref.repo, issue.ref.number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  // j and k's stop when there's no PR count to land on
                  data-row-focus={has ? undefined : ''}
                  className="min-w-0 break-words text-sm font-medium text-ink hover:text-brand hover:underline"
               >
                  {issue.title}
               </a>
               {(added || offOnGitHub) && (
                  <span className="text-xs text-ink-3">
                     {added}
                     {onRemove && !receipt && (
                        // beside the words that say how it came, away from who
                        // holds it; it shows on this line's hover or focus, as
                        // a row's verbs do, and always on touch and narrow
                        // screens
                        <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/issue:opacity-100 max-[719px]:opacity-100 [@media(hover:none)]:opacity-100">
                           <span aria-hidden> · </span>
                           <TextButton
                              onClick={onRemove}
                              autoFocus={focusRemove}
                              aria-label={`Remove #${issue.ref.number} from this project`}
                           >
                              Remove
                           </TextButton>
                        </span>
                     )}
                     {offOnGitHub && (
                        // where Remove would be, on hover or focus: its label
                        // is GitHub's. The title goes to the same page and the
                        // list's door says how, for keyboards, touch and
                        // screen readers.
                        <span className="opacity-0 transition-opacity group-focus-within/issue:opacity-100 group-hover/issue:opacity-100 max-[719px]:hidden [@media(hover:none)]:hidden">
                           {added && <span aria-hidden> · </span>}
                           <a
                              href={issueUrl(issue.ref.repo, issue.ref.number)}
                              target="_blank"
                              rel="noopener noreferrer"
                              tabIndex={-1}
                              aria-hidden
                              title={`Take the ${label} label off it there`}
                              className="font-medium text-brand hover:underline"
                           >
                              Remove on GitHub
                           </a>
                        </span>
                     )}
                  </span>
               )}
               <AlsoIn slugs={issue.alsoIn} nameOf={nameOf} navigate={navigate} />
               {issue.state !== 'open' && issue.closedAt != null && (
                  <span className="text-xs text-ink-3">
                     {issue.state} {dateWords(issue.closedAt)}
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
               <FactLink
                  aria-expanded={shown}
                  // named for its issue, since a list of "1 PR" buttons can't be
                  // told apart out of context
                  aria-label={`${door}, for #${issue.ref.number} ${issue.title}`}
                  data-row-focus
                  onClick={() => setShown(!shown)}
                  className="inline-flex items-center gap-1 justify-self-start text-xs @min-[720px]:justify-self-end"
               >
                  <Icon
                     icon={ChevronRight}
                     size={12}
                     className={`flex-none transition-[rotate] duration-150 ${
                        shown ? 'rotate-90' : ''
                     }`}
                  />
                  {door}
               </FactLink>
            ) : (
               <span />
            )}
         </div>
         {receipt && <div className="-mt-1 px-3.5 pb-2.5">{receipt}</div>}
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

/** A line the list no longer has, kept where it was until the next change:
 * an issue taken off, or one added from "Issues linked from its PRs". */
type Kept =
   | { issue: ProjectIssue; stage: IssueStage; after: string | null }
   | { suggested: SuggestedIssue; after: string | null };

/**
 * A change to the project's issues, said where it was made (DESIGN.md: a
 * save confirms in place): under the search box, on the issue's line, or
 * on its line under "Issues linked from its PRs".
 */
interface Change {
   ref: IssueRef;
   /** what the click did: added it, or took it off */
   add: boolean;
   at: 'box' | 'issues' | 'suggested';
   /** saving or failing is the click's change until Undo, then the undo's */
   state: 'saving' | 'saved' | 'failed' | 'undoing' | 'undo-failed' | 'undone';
   error?: string;
   kept?: Kept;
   /** tells this change from a later one, whose save may land first */
   token: number;
}

/** Put a kept line back in its list, after the line it followed. */
function withKept<T>(list: T[], keyOf: (item: T) => string, item: T, after: string | null): T[] {
   if (list.some(i => keyOf(i) === keyOf(item))) return list;
   const at = after == null ? 0 : list.findIndex(i => keyOf(i) === after) + 1;
   return [...list.slice(0, at), item, ...list.slice(at)];
}

/**
 * A project's work, in three sections. Its issues, each on one line, in
 * bands by stage: what's nearest to shipping first, then what's waiting,
 * then what isn't started, then the closed ones; each issue's PRs one click
 * away. Its PRs that link none of its issues, in bands by stage too. And
 * the issues its PRs link that aren't in it, to add. j and k move down the
 * issue lines and the PRs shown under them.
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
   const [change, setChange] = useState<Change | null>(null);
   const tokens = useRef(0);
   const [adding, setAdding] = useState(false);
   const boxRef = useRef<HTMLDivElement>(null);
   // the issue just added, to flash once it shows
   const [landed, setLanded] = useState<string | null>(null);
   const opened = useRef<string | null>(null);
   // the last "Show all PRs" or "Hide all PRs"
   const [all, setAll] = useState<{ open: boolean } | null>(null);
   const choices = useFoldChoices();
   // an issue line lands on its PR count (or its title), a PR on its title
   useRowKeys('[data-issue-row], [data-pull]', '[data-row-focus], a[href*="/pull/"]');
   // "a" opens Add an issue from anywhere on the page, its box in view: in
   // the middle, clear of the sticky headers above it at any width
   usePageKey('a', () => {
      setAdding(true);
      requestAnimationFrame(() => {
         boxRef.current?.scrollIntoView({ block: 'center' });
         boxRef.current?.querySelector('input')?.focus({ preventScroll: true });
      });
   });
   const mine = (plans ?? []).filter(p => p.project === slug);
   const lateOf = (pr: IssuePull) => lateWords(pr.createdAt, mine, closed);
   /** Save `add` for a change's issue: the click's own change, or, when it
    * goes the other way, its Undo. An add's Undo forgets it, so a
    * suggestion goes back to being one, where a Remove keeps it off. */
   const save = ({ ref, add: did, at, kept }: Omit<Change, 'state' | 'token'>, add: boolean) => {
      const undo = add !== did;
      const token = ++tokens.current;
      const c = { ref, add: did, at, kept, token };
      setChange({ ...c, state: undo ? 'undoing' : 'saving' });
      if (!undo) setLanded(null);
      const issue = { repo: ref.repo, number: ref.number };
      void changeProjectIssue(slug, issue, add, { forget: undo && !add }).then(r => {
         // a later change has the floor
         if (tokens.current !== token) return;
         if ('error' in r) {
            setChange({ ...c, state: undo ? 'undo-failed' : 'failed', error: r.error });
            return;
         }
         if (add && !undo) setLanded(issueKey(ref));
         setChange({ ...c, state: undo ? 'undone' : 'saved' });
      });
   };
   // after an Undo from the box, the focus goes back in it, ready for the next
   useEffect(() => {
      if (change?.at === 'box' && change.state === 'undone') {
         boxRef.current?.querySelector('input')?.focus();
      }
   }, [change]);
   // an added issue: open the band it's in, where it leads and flashes; the
   // page doesn't move, so the box keeps its place under the pointer
   useEffect(() => {
      if (!landed || opened.current === landed) return;
      const row = document.querySelector(`[data-issue="${CSS.escape(landed)}"]`);
      if (!row) return;
      opened.current = landed;
      const fold = row.closest('details');
      if (fold) fold.open = true;
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
   const key = change && issueKey(change.ref);
   /** What a change did, in words: a saved add names the band it went to,
    * once the page shows it there. */
   const words = (c: Change) => {
      const name = `#${c.ref.number}`;
      const doing = c.state === 'undoing' || c.state === 'undo-failed' ? !c.add : c.add;
      const stage = standings.get(issueKey(c.ref))?.stage;
      switch (c.state) {
         case 'saving':
         case 'undoing':
            return `${doing ? 'Adding' : 'Removing'} ${name}…`;
         case 'failed':
         case 'undo-failed':
            return c.error ?? '';
         case 'saved':
            if (!c.add) return `Removed ${name} from this project.`;
            return stage ? `Added ${name} to ${STAGE_WORDS[stage]}.` : `Adding ${name}…`;
         case 'undone':
            return c.add ? `Took ${name} off again.` : `Put ${name} back.`;
      }
   };
   /** The change's receipt, for the place it was made. */
   const receiptAt = (at: Change['at'], k?: string) => {
      if (!change || change.at !== at || (k != null && k !== key) || change.state === 'undone') {
         return null;
      }
      const c = change;
      const failed = c.state === 'failed' || c.state === 'undo-failed';
      return (
         <Receipt
            words={words(c)}
            // the box keeps the focus for the next search; a line's button
            // went with the change, so the receipt's takes it
            focus={at !== 'box'}
            onUndo={c.state === 'saved' ? () => save(c, !c.add) : undefined}
            undoLabel={`Undo ${c.add ? 'adding' : 'removing'} #${c.ref.number}`}
            onRetry={failed ? () => save(c, c.state === 'undo-failed' ? !c.add : c.add) : undefined}
            onCancel={failed ? () => setChange(null) : undefined}
         />
      );
   };
   // a line taken off stays in its band until the next change
   const keptIssue = change?.kept && 'issue' in change.kept ? change.kept : null;
   // a just-added issue leads its band, so a long one can't hide it
   const ordered = (stage: IssueStage, list: ProjectIssue[]) => {
      const lead = landed
         ? [
              ...list.filter(i => issueKey(i.ref) === landed),
              ...list.filter(i => issueKey(i.ref) !== landed),
           ]
         : list;
      return keptIssue?.stage === stage
         ? withKept(lead, i => issueKey(i.ref), keptIssue.issue, keptIssue.after)
         : lead;
   };
   const bands = STAGE_ORDER.map(stage => ({
      stage,
      list: ordered(
         stage,
         issues.filter(i => stageOf(i) === stage)
      ),
   })).filter(b => b.list.length > 0);
   // a PR linking two issues is drawn in full under the first one shown, in
   // the page's order, and as a plain line under any other
   const rowOwner = new Map<string, string>();
   for (const { list } of bands) {
      for (const issue of list) {
         const k = issueKey(issue.ref);
         if (!(choices[prsFoldId(slug, k)] ?? false)) continue;
         for (const pr of issue.prs) {
            if (!rowOwner.has(issueKey(pr))) rowOwner.set(issueKey(pr), k);
         }
      }
   }
   // every issue's PRs at once, once two or more issues have any; while
   // they're all shown, so is every line, past a band's 40 too
   const withPrs = issues.filter(i => i.prs.length > 0);
   const allShown = withPrs.every(i => choices[prsFoldId(slug, issueKey(i.ref))] ?? false);
   const isOpenPr = (pr: IssuePull) => (pulls.live(pr) ? true : pr.state === 'open');
   // taken off from the click on, until an Undo has put it back
   const removing = (k: string) =>
      change?.at === 'issues' &&
      !change.add &&
      key === k &&
      change.state !== 'failed' &&
      change.state !== 'undone';
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
            <Truncated
               cap={all?.open ? Number.POSITIVE_INFINITY : LIST_CAP}
               id={`work:${slug}:${stage}`}
               label="more issues"
            >
               {list.map((issue, i) => {
                  const k = issueKey(issue.ref);
                  // the line stays where it was, after the one it followed
                  const kept = { issue, stage, after: i ? issueKey(list[i - 1].ref) : null };
                  return (
                     <IssueLine
                        key={k}
                        slug={slug}
                        label={label}
                        issue={issue}
                        standing={standings.get(k) ?? { stage, pull: null }}
                        pulls={pulls}
                        lateOf={lateOf}
                        planned={planned}
                        fresh={landed === k}
                        onRemove={
                           removable(issue)
                              ? () =>
                                   save({ ref: issue.ref, add: false, at: 'issues', kept }, false)
                              : null
                        }
                        receipt={receiptAt('issues', k)}
                        gone={removing(k)}
                        focusRemove={
                           change?.state === 'undone' && change.at === 'issues' && key === k
                        }
                        opts={opts}
                        repoShown={repoShown}
                        nameOf={nameOf}
                        navigate={navigate}
                        rowOwner={rowOwner}
                        all={all}
                     />
                  );
               })}
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
         window: undefined as string | undefined,
      })),
      {
         id: 'closed' as const,
         word: 'Merged or closed',
         gloss: `Its PRs that merged or closed in the ${LAST_14_DAYS}`,
         // the window in plain words beside the band, not in its capitals
         window: `in the ${LAST_14_DAYS}`,
      },
   ]
      .map(b => ({ ...b, list: unlinked.filter(pr => unlinkedBand(pr, pulls.live) === b.id) }))
      .filter(b => b.list.length > 0);
   const unlinkedOpen = unlinked.filter(isOpenPr).length;
   // an issue added from "Issues linked from its PRs" stays on its line there
   const keptSuggested = change?.kept && 'suggested' in change.kept ? change.kept : null;
   const suggested = keptSuggested
      ? withKept(page?.suggested ?? [], issueKey, keptSuggested.suggested, keptSuggested.after)
      : page?.suggested ?? [];
   return (
      <>
         {/* what the last change did, for a screen reader, said once */}
         <p role="status" aria-live="polite" className="sr-only">
            {change ? words(change) : ''}
         </p>
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
                           Its issues are the ones with the {label} label on GitHub, the ones added
                           here, and the ones its PRs link that no other project has, which join on
                           their own. One added after its plan started says when.
                        </p>
                        <p className="m-0">
                           Remove takes one off for good: a link never brings it back. One with the
                           label comes off when the label does, on GitHub.
                        </p>
                        <p className="m-0">
                           Each one is as far along as its least finished open PR: ready to merge,
                           on hold, waiting on review, or in development. Click an issue to see its
                           PRs. j and k move down the list.
                        </p>
                     </SubDoor>
                  ) : undefined
               }
               headerExtra={
                  <span className="flex items-center gap-4 text-xs">
                     {withPrs.length > 1 && (
                        <TextButton onClick={() => setAll({ open: !allShown })}>
                           {allShown ? 'Hide all PRs' : 'Show all PRs'}
                        </TextButton>
                     )}
                     <TextButton
                        tone={adding ? 'quiet' : 'action'}
                        onClick={() => setAdding(!adding)}
                        aria-expanded={adding}
                        aria-keyshortcuts={adding ? undefined : 'a'}
                     >
                        {adding ? 'Close' : 'Add an issue'}
                     </TextButton>
                  </span>
               }
            />
            {adding && (
               <div ref={boxRef} className="mb-3 flex flex-col gap-1.5">
                  <IssueSearch
                     label="Add an issue to this project"
                     placeholder="Find an issue: title words, #123, or a link"
                     // the box stays, ready for the next one: focus stays in it
                     onPick={hit => save({ ref: hit, add: true, at: 'box' }, true)}
                     taken={new Set(issues.map(i => issueKey(i.ref)))}
                     takenWords="in this project already"
                     whereIs={whereIs}
                     autoFocus
                  />
                  {receiptAt('box')}
               </div>
            )}
            {page === undefined ? (
               <p className="m-0 text-[13px] text-ink-3">Loading its issues…</p>
            ) : page === null ? (
               <LoadFailed what="its issues and PRs" onRetry={reloadProjectWork} />
            ) : bands.length ? (
               <Rows>{bands.map(band)}</Rows>
            ) : (
               <p className="m-0 max-w-[70ch] text-[13px] text-ink-3">
                  No issues yet.{' '}
                  {adding ? (
                     'Find one above, or'
                  ) : (
                     <>
                        <TextButton onClick={() => setAdding(true)}>Add one</TextButton>, or
                     </>
                  )}{' '}
                  give an issue the {label} label on GitHub: the label that puts PRs in this
                  project. An issue its PRs link (“Parts of #N”) joins on its own.
               </p>
            )}
         </section>
         {unlinkedBands.length > 0 && (
            <section id="project-unlinked" className="mb-7 scroll-mt-28">
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
                              Name the issue each one does (“Parts of #N” in its description) and
                              the issue joins on its own, or check it belongs here. One that does an
                              issue of another project says which.
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
                        detail={b.window}
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
         {suggested.length > 0 && (
            <section className="mb-7">
               <GroupHeader
                  level={3}
                  title="Issues linked from its PRs"
                  sub={
                     <SubDoor label="Why these didn’t join" text="not in this project yet">
                        <p className="m-0">
                           An issue its PRs link joins on its own within the hour. One waits here
                           instead when another project has it, another project’s PRs link it too,
                           or the PR linking it is here only by an issue that joined that way.
                        </p>
                     </SubDoor>
                  }
               />
               <Rows>
                  <Truncated cap={LIST_CAP} id={`work:${slug}:suggested`} label="more issues">
                     {suggested.map((issue, i) => {
                        const k = issueKey(issue);
                        const receipt = receiptAt('suggested', k);
                        return (
                           <div
                              key={k}
                              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-secondary px-3.5 py-2.5 text-[13px] first:border-t-0"
                           >
                              <span
                                 className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 ${
                                    receipt && change?.state !== 'failed' ? 'opacity-60' : ''
                                 }`}
                              >
                                 <RefChip
                                    data={{ kind: 'issue', ...issue }}
                                    repoShown={repoShown(issue)}
                                    tabStop={!issue.title}
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
                                 {/* where it is now, which is why it didn't join */}
                                 <AlsoIn
                                    slugs={issue.alsoIn}
                                    nameOf={nameOf}
                                    navigate={navigate}
                                    lead="in"
                                 />
                                 <span className="text-xs text-ink-3">
                                    linked by{' '}
                                    {issue.linkedBy.map((pr, j) => (
                                       <Fragment key={issueKey(pr)}>
                                          {j > 0 && ', '}
                                          <PullRef pr={pr} repoShown={pr.repo !== issue.repo} />
                                       </Fragment>
                                    ))}
                                 </span>
                              </span>
                              <span className="ml-auto">
                                 {receipt ?? (
                                    <TextButton
                                       // its line stays, saying it was added, and
                                       // the focus moves to its Undo
                                       onClick={() =>
                                          save(
                                             {
                                                ref: { repo: issue.repo, number: issue.number },
                                                add: true,
                                                at: 'suggested',
                                                kept: {
                                                   suggested: issue,
                                                   after: i > 0 ? issueKey(suggested[i - 1]) : null,
                                                },
                                             },
                                             true
                                          )
                                       }
                                       autoFocus={
                                          change?.state === 'undone' &&
                                          change.at === 'suggested' &&
                                          key === k
                                       }
                                       aria-label={`Add #${issue.number} to this project`}
                                       className="text-xs"
                                    >
                                       Add
                                    </TextButton>
                                 )}
                              </span>
                           </div>
                        );
                     })}
                  </Truncated>
               </Rows>
            </section>
         )}
      </>
   );
}
