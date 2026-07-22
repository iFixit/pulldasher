import { memo, useState, type ReactNode } from 'react';
import type { DerivedPull } from '../model/status';
import { isIterating, lastPushEpoch } from '../model/status';
import { type Claim, rowNote } from '../model/actions';
import { matchedRegions } from '../model/regions';
import type { ParentRef } from '../model/stack';
import { ago, epoch, pullKey, rowDomId, shortRepo } from '../format';
import {
   setRepoPref,
   toggleMutedPerson,
   togglePrimaryRepo,
   toggleStarredPerson,
   useSettings,
} from '../settings';
import {
   ackPull,
   claimFor,
   claimReview,
   isFresh,
   refreshPull,
   releaseReview,
   snoozePull,
   usePulldasher,
} from '../store';
import {
   AgeStamp,
   AgeBaseline,
   CiStatus,
   DiffSize,
   QuietButton,
   RepoRef,
   SigPips,
   WEIGHT_WORD,
   WeightMeter,
} from './bits';
import { CardShell } from './Card';
import { StatePopover } from './StatePopover';
import { Popover } from './Popover';

export interface RowOptions {
   /** compact density: one-line rows, smaller avatar, tighter spacing */
   compact?: boolean;
   /** rows a lane shows before folding; 0 = no cap. Falls back to the lane's
    * own default when unset (old saved settings). */
   laneCap?: number;
   me: string;
   lastSeen: number;
   /** pull key → epoch secs it was opened (clears the fresh dot until the
    * pull changes again; persisted per-browser) */
   acked: Readonly<Record<string, number>>;
   onPerson?: (login: string) => void;
   /** age thresholds from user settings (fall back to the model's) */
   ageWarnDays?: number;
   ageRotDays?: number;
   /** the board's longest-open pull, in days — the age baseline's full
    * track; every row's line is a fraction of the oldest */
   maxAgeDays?: number;
   /** toggle a weight bucket ('xs'..'xl' or 'unknown') in the session Weight
    * filter — the row-initiated twin of WeightFilter's own checkboxes */
   onWeightToggle?: (w: string) => void;
   /** whole-board parent lookup (model/stack.ts's buildParentLookup, memoized
    * once in app.tsx): resolves a dependent pull's parent even when it's
    * absent from the CURRENT list (a different lane, a muted repo, another
    * lens' scope), so the 'stacked' flag can name it instead of just saying
    * "based on <ref>". */
   parentOf?: (p: DerivedPull) => ParentRef | null;
   /** per-repo reviewer pool for the deterministic turn rotation
    * (model/rotation.ts), memoized once in app.tsx over the whole board. */
   pools?: ReadonlyMap<string, string[]>;
   /** pull key → whose turn it is (the best-fit reviewer for a starved,
    * unclaimed PR), computed once in app.tsx so the row just looks it up. */
   turns?: ReadonlyMap<string, string>;
   /** one plain-words line on why this pull sits where it does in a ranked
    * lane (Review's queue / Needs QA) — rendered in the state popover, never
    * inline on the card. */
   rankReason?: (p: DerivedPull) => string | null;
}

/**
 * A fresh row is a brand-new PR (solid dot) or an updated one (ring), and
 * opening it clears the mark for the session.
 */
function freshKind(p: DerivedPull, opts: RowOptions): 'new' | 'updated' | null {
   if (!isFresh(p.data, opts.lastSeen, opts.acked)) return null;
   return epoch(p.data.created_at) > opts.lastSeen ? 'new' : 'updated';
}

// The background flash runs once per pull per session, not on every lens
// switch that remounts the row. Recording during render is deliberate: memo
// keeps re-renders rare, and a double-record is harmless.
const flashed = new Set<string>();
function flashOnce(key: string, fresh: boolean): boolean {
   if (!fresh || flashed.has(key)) return false;
   flashed.add(key);
   return true;
}

interface Flag {
   key: string;
   /** 'warn' = act on it (amber); 'note' = a neutral fact (muted) */
   tone: 'warn' | 'note';
   label: string;
   detail: ReactNode;
}

/**
 * The row's secondary annotations, gathered in one place: conflicts, stacked,
 * holds, in-flight CI, iterating. (Age lives on the row's baseline, not a
 * flag — one mark per fact.) They're not the status (the badge is)
 * and not your action (the note is), so they read as quiet colored labels,
 * not badges — amber only for the ones you act on, muted gray for plain facts.
 *
 * `depth` is the row's stack-nesting depth (model/stack.ts's groupIntoTree):
 * depth > 0 means the parent is already visible right above this row, so the
 * 'stacked' flag would be redundant — geometry already says it. At depth 0,
 * `orphanParent` (the whole-board lookup, when it resolves) upgrades the
 * flag to name the parent instead of only describing the base ref.
 */
function rowFlags(
   pull: DerivedPull,
   showIterating: boolean,
   depth: number,
   orphanParent: ParentRef | null
): Flag[] {
   const p = pull;
   const flags: Flag[] = [];
   if (p.conflict && p.status !== 'unmergeable')
      flags.push({
         key: 'conflicts',
         tone: 'warn',
         label: 'conflicts',
         detail: 'Merge conflicts with the base branch; the author needs to rebase.',
      });
   if (p.deployBlockedBy.length > 0 && p.status !== 'deploy_block')
      flags.push({
         key: 'deploy-block',
         tone: 'warn',
         label: 'deploy block',
         detail: `${p.deployBlockedBy.join(', ')} put a deploy block on it; don’t ship without asking.`,
      });
   if (p.externalBlock)
      flags.push({
         key: 'external',
         tone: 'warn',
         label: 'external',
         detail: 'Blocked on something outside this repo.',
      });
   if (p.dependent && p.status !== 'unmergeable' && depth === 0) {
      flags.push(
         orphanParent
            ? {
                 key: 'stacked',
                 tone: 'note',
                 label: `stacked on #${orphanParent.number}`,
                 detail: (
                    <>
                       Based on {p.data.base.ref}; lands with its parent,{' '}
                       <a
                          href={orphanParent.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand hover:underline"
                       >
                          “{orphanParent.title}” #{orphanParent.number}
                       </a>
                       .
                    </>
                 ),
              }
            : {
                 key: 'stacked',
                 tone: 'note',
                 label: 'stacked',
                 detail: `Based on ${p.data.base.ref}, not the main branch; it lands with its parent.`,
              }
      );
   }
   if (p.mergeUnknown && p.status === 'ready')
      flags.push({
         key: 'merge',
         tone: 'note',
         label: 'merge check',
         detail: 'GitHub hasn’t confirmed this merges cleanly yet.',
      });
   if (p.ci === 'pending' && p.status !== 'ci_pending')
      flags.push({ key: 'ci', tone: 'note', label: 'CI…', detail: 'CI is still running.' });
   if (showIterating) {
      const pushedAt = lastPushEpoch(p);
      flags.push({
         key: 'iterating',
         tone: 'note',
         label: 'recent changes',
         detail: `Pushed ${ago(pushedAt)} ago; it may still be moving, so hold off.`,
      });
   }
   return flags;
}

/**
 * The flag cluster's drill-down: labels inline for scanning, the plain-
 * English meaning one hover away — the same pattern the CR/QA pips use, so
 * no flag hides its meaning behind a native tooltip. Both densities show the
 * full label list (compact wraps rather than abbreviating); with no flags
 * there's nothing to explain and no trigger to show.
 */
function RowDetails({ flags }: { flags: Flag[] }) {
   if (!flags.length) return null;
   return (
      <Popover
         label="What these flags mean"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max max-w-[300px]"
         panelClass="p-1.5 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={`row details: ${flags.map(f => f.label).join(', ')}`}
               className="pd-raise pressable -my-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded px-0.5 py-2 hover:bg-secondary/60"
            >
               {flags.map(f => (
                  <span
                     key={f.key}
                     className={`whitespace-nowrap ${f.tone === 'warn' ? 'flag-warn' : 'flag-note'}`}
                  >
                     {f.label}
                  </span>
               ))}
            </button>
         )}
      >
         {flags.map(f => (
            <span key={f.key} className="flex items-start gap-1.5 px-1 py-[3px]">
               <span
                  aria-hidden
                  className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: f.tone === 'warn' ? 'var(--warn)' : 'var(--ink-3)' }}
               />
               <span className="text-ink-2">
                  <b className="font-medium text-ink">{f.label}</b> {f.detail}
               </span>
            </span>
         ))}
      </Popover>
   );
}

const ICON_COPY =
   'M5 1a1 1 0 0 0-1 1v1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V4.4L11.6 1H5Zm6 11v1H3V4h1v7a1 1 0 0 0 1 1h6Zm2-2H5V2h5v3h3v5Z';
const ICON_SNOOZE =
   'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-.75 2v4.06l3.1 1.86.77-1.28-2.37-1.42V4.5h-1.5Z';
const ICON_REFRESH =
   'M8 3a5 5 0 1 0 4.9 6h-1.55A3.5 3.5 0 1 1 8 4.5c.97 0 1.85.4 2.48 1.02L8.5 7.5H13V3l-1.46 1.46A4.98 4.98 0 0 0 8 3Z';
const ICON_KEBAB =
   'M8 4.4a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm0 5a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm0 5a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z';
// A raised hand: "I've got this one" — the claim toggle, like putting your
// hand up to take the review. Heroicons' solid hand-raised (24-unit viewBox,
// so this icon renders with box={24}). Brand-tinted when the claim is yours
// (below), muted otherwise, same glyph either way.
const ICON_HAND =
   'M10.5 1.875a1.125 1.125 0 0 1 2.25 0v8.219c.517.162 1.02.382 1.5.659V3.375a1.125 1.125 0 0 1 2.25 0v10.937a4.505 4.505 0 0 0-3.25 2.373 8.963 8.963 0 0 1 4-.935A.75.75 0 0 0 18 15v-2.266a3.368 3.368 0 0 1 .988-2.37 1.125 1.125 0 0 1 1.591 1.59 1.118 1.118 0 0 0-.329.79v3.006h.005a6 6 0 0 1-1.752 4.007l-1.736 1.736a6 6 0 0 1-4.242 1.757H10.5a7.5 7.5 0 0 1-7.5-7.5V6.375a1.125 1.125 0 0 1 2.25 0v5.519c.46-.452.965-.832 1.5-1.141V3.375a1.125 1.125 0 0 1 2.25 0v6.526c.495-.1.997-.151 1.5-.151V1.875Z';

function ActionIcon({ d, spin, box = 16 }: { d: string; spin?: boolean; box?: number }) {
   return (
      <svg
         viewBox={`0 0 ${box} ${box}`}
         aria-hidden
         className={`h-3.5 w-3.5 flex-none fill-current ${spin ? 'spin-once' : ''}`}
      >
         <path d={d} />
      </svg>
   );
}

/**
 * The per-row actions, shared by the desktop hover cluster and the mobile
 * kebab menu so the two surfaces can never disagree on behavior.
 */
function useRowActions(pull: DerivedPull) {
   const [copied, setCopied] = useState(false);
   const [spinning, setSpinning] = useState(false);
   return {
      copied,
      spinning,
      copy: () => {
         void navigator.clipboard.writeText(pull.data.head.ref);
         setCopied(true);
         setTimeout(() => setCopied(false), 1200);
      },
      snooze: () => snoozePull(pullKey(pull.data)),
      refresh: () => {
         refreshPull(pull.data.repo, pull.data.number);
         setSpinning(true);
         setTimeout(() => setSpinning(false), 600);
      },
      claim: () => claimReview(pull.data),
      release: () => releaseReview(pull.data),
   };
}

/**
 * Hover/focus actions: copy the branch name, snooze, re-fetch from GitHub.
 * `overlay` (compact) floats them over the row's tail instead of reserving
 * rail width — .row-actions hides them with visibility, which still takes
 * layout space, and in a narrow column that standing ~70px tax comes straight
 * out of the title. Hidden below 720px, where RowActionsKebab takes over
 * (hover-reveal has no phone story).
 */
function RowActions({
   pull,
   overlay,
   me,
   claim,
}: {
   pull: DerivedPull;
   overlay?: boolean;
   me: string;
   claim: Claim | null;
}) {
   const a = useRowActions(pull);
   const btn =
      'hit pressable rounded border-0 bg-transparent px-1 text-xs text-ink-3 hover:text-brand';
   const mine = claim?.login === me;
   return (
      <>
         {/* always visible — not .row-actions — so a claim you hold doesn't
             vanish when the row loses hover; it's your commitment, not a
             hover affordance. */}
         {mine && (
            <button
               type="button"
               aria-label="release your claim"
               title="release your claim"
               className="hit pressable rounded border-0 bg-transparent px-1 text-xs text-brand"
               onClick={a.release}
            >
               <ActionIcon d={ICON_HAND} box={24} />
            </button>
         )}
         <span
            className={`row-actions hidden items-center gap-1 [@media(hover:hover)_and_(min-width:720px)]:inline-flex ${
               overlay
                  ? 'absolute right-full top-1/2 z-10 mr-1 -translate-y-1/2 rounded-md bg-muted px-1'
                  : 'flex-none'
            }`}
         >
            <button
               type="button"
               aria-label={`copy branch name ${pull.data.head.ref}`}
               title={`copy branch: ${pull.data.head.ref}`}
               className={btn}
               onClick={a.copy}
            >
               {a.copied ? (
                  <span className="chip-in" style={{ color: 'var(--ok)' }}>
                     copied
                  </span>
               ) : (
                  <ActionIcon d={ICON_COPY} />
               )}
            </button>
            <button
               type="button"
               aria-label="snooze: hide until tomorrow or until it changes"
               title="snooze: hide until tomorrow or until it changes"
               className={btn}
               onClick={a.snooze}
            >
               <ActionIcon d={ICON_SNOOZE} />
            </button>
            <button
               type="button"
               aria-label="re-fetch this PR from GitHub"
               title="re-fetch this PR from GitHub"
               className={btn}
               onClick={a.refresh}
            >
               <ActionIcon d={ICON_REFRESH} spin={a.spinning} />
            </button>
            {/* never offered on your own pull — you don't review yourself,
                but the slot's width is reserved so the rail (and the age
                numeral's right edge in the meta line) stays one column
                whether or not a row is claimable. In wide lanes this cluster
                is in-flow (visibility:hidden keeps layout), so a missing
                button would shift everything left of it. Once it's yours,
                the always-visible hand above (outside .row-actions) takes
                over so the claim doesn't disappear on hover-out. */}
            {pull.data.user.login === me && <span aria-hidden className="w-[22px] flex-none" />}
            {pull.data.user.login !== me && !mine && (
               <button
                  type="button"
                  aria-label="claim this review"
                  title={
                     claim
                        ? `claim review, currently ${claim.login}'s`
                        : "claim this review, flags that you're reading it"
                  }
                  className={btn}
                  onClick={a.claim}
               >
                  <ActionIcon d={ICON_HAND} box={24} />
               </button>
            )}
         </span>
      </>
   );
}

/**
 * The star/mute glyph every kebab star item shares: a fixed-width slot the
 * same size as the SVG action icons, so the menu's leading column still
 * lines up even though these two rows use a text glyph instead of a path.
 */
function StarGlyph({ on }: { on: boolean }) {
   return (
      <span aria-hidden className="inline-block h-3.5 w-3.5 flex-none text-center leading-[14px]">
         {on ? '★' : '☆'}
      </span>
   );
}

/**
 * The touch-only row menu: below 720px the hover cluster (RowActions) doesn't
 * exist, so every row keeps a quiet, always-visible kebab that opens a
 * tap-friendly labeled menu (the house click-to-open popover — no hover in the
 * path). It's hidden at and above 720px: everything it offers has a desktop
 * home already — copy/snooze/re-fetch/claim in the hover cluster, and repo/
 * person star/mute in Settings' repo manager and the People lens — so on a
 * pointer device the kebab was pure redundancy.
 */
function RowActionsKebab({ pull, claim }: { pull: DerivedPull; claim: Claim | null }) {
   const a = useRowActions(pull);
   const settings = useSettings();
   const { me } = usePulldasher();
   const repo = pull.data.repo;
   const author = pull.data.user.login;
   const repoLabel = shortRepo(repo);
   const isPrimaryRepo = settings.primaryRepos.includes(repo);
   const isMutedRepo = settings.repoPrefs[repo] === 'mute';
   const isStarredAuthor = settings.starredPeople.includes(author);
   const claimedByMe = claim?.login === me;
   const item =
      'flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-2 text-left text-xs text-ink-2 hover:bg-muted';
   return (
      <Popover
         label="Row actions"
         side="right"
         rootClass="relative inline-flex [@media(hover:hover)_and_(min-width:720px)]:hidden"
         // capped to the viewport: w-max would size to the branch name and
         // push the panel off a phone screen — the branch truncates instead
         width="w-max min-w-[190px] max-w-[min(280px,calc(100vw-16px))]"
         panelClass="p-1 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label="row actions"
               className="hit pressable -my-2 rounded border-0 bg-transparent px-0.5 py-2 text-ink-3 hover:text-brand"
            >
               <ActionIcon d={ICON_KEBAB} />
            </button>
         )}
      >
         <button type="button" className={item} onClick={a.copy}>
            <ActionIcon d={ICON_COPY} />
            {a.copied ? (
               <span style={{ color: 'var(--ok)' }}>Copied!</span>
            ) : (
               <>
                  Copy branch name
                  <span className="min-w-0 flex-1 truncate text-right text-ink-3">
                     {pull.data.head.ref}
                  </span>
               </>
            )}
         </button>
         <button type="button" className={item} onClick={a.snooze}>
            <ActionIcon d={ICON_SNOOZE} />
            Snooze until tomorrow
         </button>
         <button type="button" className={item} onClick={a.refresh}>
            <ActionIcon d={ICON_REFRESH} spin={a.spinning} />
            Re-fetch from GitHub
         </button>
         {/* never offered on your own pull — you don't review yourself */}
         {author !== me && (
            <button
               type="button"
               className={item}
               onClick={claimedByMe ? a.release : a.claim}
               aria-pressed={claimedByMe}
               title={
                  claimedByMe
                     ? 'release your claim'
                     : claim
                       ? `claim review, currently ${claim.login}'s`
                       : "claim this review, flags that you're reading it"
               }
            >
               <ActionIcon d={ICON_HAND} box={24} />
               {claimedByMe ? 'Release claim' : 'Claim review'}
            </button>
         )}
         <div aria-hidden className="my-1 border-t border-secondary" />
         <button
            type="button"
            className={item}
            onClick={() => togglePrimaryRepo(repo, !isPrimaryRepo)}
            aria-pressed={isPrimaryRepo}
            title={
               isPrimaryRepo
                  ? `remove ${repoLabel} from your primary repos`
                  : `mark ${repoLabel} a primary repo, leads your review queue`
            }
         >
            <StarGlyph on={isPrimaryRepo} />
            {isPrimaryRepo ? `Unstar ${repoLabel}` : `Star ${repoLabel}`}
         </button>
         <button
            type="button"
            className={item}
            onClick={() => setRepoPref(repo, isMutedRepo ? null : 'mute')}
            aria-pressed={isMutedRepo}
            title={
               isMutedRepo
                  ? `unmute ${repoLabel}, show it on your board again`
                  : `mute ${repoLabel}, hide it on your board`
            }
         >
            {isMutedRepo ? `Unmute ${repoLabel}` : `Mute ${repoLabel}`}
         </button>
         <button
            type="button"
            className={item}
            onClick={() => toggleStarredPerson(author, !isStarredAuthor)}
            aria-pressed={isStarredAuthor}
            title={
               isStarredAuthor
                  ? `unstar ${author}`
                  : `star ${author}, floats their pulls to the front of your queues`
            }
         >
            <StarGlyph on={isStarredAuthor} />
            {isStarredAuthor ? `Unstar ${author}` : `Star ${author}`}
         </button>
         {/* never offered for your own pulls — you can't mute yourself off
             your own board */}
         {author !== me && (
            <button
               type="button"
               className={item}
               onClick={() => toggleMutedPerson(author, true)}
               title={`mute ${author}, hide their pulls on your board`}
            >
               Mute {author}
            </button>
         )}
      </Popover>
   );
}

/**
 * The weight chip as both a filter toggle and a hover preview: click adds/
 * removes that size class from the session Weight filter — the same bucket
 * WeightFilter's own checkboxes drive, just row-initiated — while hovering
 * previews the exact +/− diff size the letter is standing in for. Falls back
 * to a plain, non-interactive trigger (still inside the same popover) when no
 * callback is wired up (e.g. a lens that hasn't threaded
 * RowOptions.onWeightToggle).
 */
function WeightChip({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const meter = <WeightMeter weight={pull.weight} known={pull.sizeKnown} wide />;
   const onWeightToggle = opts.onWeightToggle;
   const key = pull.sizeKnown ? pull.weight.toLowerCase() : 'unknown';
   const d = pull.data;
   return (
      <Popover
         label="review effort"
         hover
         side="right"
         rootClass="relative flex"
         width="w-max"
         panelClass="p-2 text-xs"
         // the trigger keeps the shared pin contract ({...t}'s own click) so
         // tap and Enter open the SAME panel hover gets — an explicit onClick
         // here once overwrote the toggle and locked this popover to
         // mouse-hover only, an information blackout for touch and keyboard.
         // The filter action lives inside the panel instead.
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={`review effort: ${WEIGHT_WORD[pull.weight]}`}
               className="pressable hit block w-full rounded border-0 bg-transparent p-0"
            >
               <span aria-hidden className="contents">
                  {meter}
               </span>
            </button>
         )}
      >
         <span className="block font-medium text-ink">
            review effort: {WEIGHT_WORD[pull.weight]}
         </span>
         {pull.sizeKnown && (
            <span className="mt-1 block">
               <DiffSize additions={d.additions ?? 0} deletions={d.deletions ?? 0} />
            </span>
         )}
         <span className="mt-1 block text-ink-3">
            {pull.sizeKnown ? 'from diff size' : 'size estimated'}
         </span>
         {onWeightToggle && (
            <span className="mt-1.5 block">
               <QuietButton onClick={() => onWeightToggle(key)}>
                  Filter to {pull.sizeKnown ? pull.weight : 'unknown-size'} PRs
               </QuietButton>
            </span>
         )}
      </Popover>
   );
}

/**
 * The metric rail every row ends on, in one order everywhere: CI, then the CR
 * and QA sign-off pips, then how heavy to review — weight is the rightmost
 * anchor now, the "can I fit this in" scan column reviewers hunt first. Age
 * moved to the meta line (see RowImpl): it's a fact about the pull, not a
 * per-row action like the rest of this rail. Right-anchored and
 * fixed-geometry, so it reads as vertical columns down any lens. Raised above
 * the card's click layer so the sign-off popovers still open.
 */
function MetricRail({
   pull,
   opts,
   claim,
}: {
   pull: DerivedPull;
   opts: RowOptions;
   claim: Claim | null;
}) {
   const d = pull.data;
   const me = opts.me;
   return (
      <span
         className={`pd-rail pd-raise ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 ${
            opts.compact ? 'relative' : ''
         }`}
      >
         <RowActions pull={pull} overlay={!!opts.compact} me={me} claim={claim} />
         <RowActionsKebab pull={pull} claim={claim} />
         {/* one instrument: the three reviewers' marks in a row — machine
             first, then the humans — with the weight strip underneath. CI is
             invisible at rest unless failing (revealed on row hover), in a
             reserved slot so nothing shifts. Age lives on the row's
             baseline, not in the rail. */}
         <span className="flex flex-col items-stretch gap-[3px]">
            <span className="flex items-center gap-2">
               <CiStatus pull={pull} />
               <SigPips
                  label="CR"
                  have={pull.crHave}
                  req={d.status.cr_req}
                  by={pull.crBy}
                  staleBy={pull.recrBy}
                  me={me}
                  sigs={d.status.allCR}
               />
               <SigPips
                  label="QA"
                  have={pull.qaHave}
                  req={d.status.qa_req}
                  by={pull.qaBy}
                  staleBy={pull.reqaBy}
                  me={me}
                  sigs={d.status.allQA}
               />
            </span>
            <WeightChip pull={pull} opts={opts} />
         </span>
      </span>
   );
}

function RowImpl({
   pull,
   opts,
   depth = 0,
}: {
   pull: DerivedPull;
   opts: RowOptions;
   /** stack-nesting depth from model/stack.ts's groupIntoTree (0 = top-level
    * or not rendered through a stack-aware list). Per-row data, not an
    * option — it varies row to row within the same list. */
   depth?: number;
}) {
   const d = pull.data;
   const key = pullKey(d);
   const fresh = freshKind(pull, opts);
   // who's claimed to review this pull, and whose turn the rotation names —
   // both optional, so a lens that hasn't threaded them (yet) just sees null
   // and rowNote falls back to its base (pre-coordination) note
   const claim = claimFor(d);
   const turn = opts.turns?.get(key) ?? null;
   const poolSize = opts.pools?.get(d.repo)?.length ?? 0;
   // the viewer-relative note (model/actions.ts): never both-null for an open
   // pull, so the one badge below always has something to say
   const note = rowNote(pull, opts.me, { claim, turn });
   // the wait badge may itself carry a "last commit …" — don't say it twice
   const showIterating = isIterating(pull) && !(note.context ?? '').includes('last commit');
   // the smallest clean marker for a starred author: a tiny ★ over their
   // avatar, so the row itself says "you follow this person" without a
   // trip to the kebab menu
   const settings = useSettings();
   const starredAuthor = settings.starredPeople.includes(d.user.login);
   // which of your code regions this pull matched (why it floated to the top)
   const regions = matchedRegions(pull, settings.codeRegions);
   // only worth asking the whole-board lookup when this row is stacked but
   // rendering flat (its parent isn't visible right above it already)
   const orphanParent = pull.dependent && depth === 0 ? (opts.parentOf?.(pull) ?? null) : null;
   return (
      <CardShell
         login={d.user.login}
         onPerson={opts.onPerson}
         repo={d.repo}
         number={d.number}
         title={d.title}
         onOpen={() => ackPull(key)}
         id={rowDomId(d)}
         compact={opts.compact}
         depth={depth}
         className={`${flashOnce(key, !!fresh) ? 'row-fresh' : ''} transition-[background-color] duration-150 ease-out motion-reduce:transition-none`}
         avatarBadge={
            starredAuthor && (
               <span
                  aria-hidden
                  title={`${d.user.login} is starred`}
                  className="absolute -right-0.5 -bottom-0.5 text-[9px] leading-none text-brand"
               >
                  ★
               </span>
            )
         }
         meta={
            // ONE badge per card: your move (brand pill) when you have one, the
            // wait-reason (muted pill) when you don't — never both, never a
            // separate status badge. Everything the old chips said (status,
            // fresh/updated, "review requested", the context sentence) lives one
            // hover away in the state popover the badge opens. The goal is a
            // one-glance "can I act on this?" scan down any column.
            <>
               {/* the badge is gone — lists group by rowWord instead — so the
                   repo#number ref is now the card's one door into the full
                   state popover: a stable position, always present, unlike a
                   badge that could be either color or absent. */}
               <StatePopover
                  pull={pull}
                  me={opts.me}
                  claim={claim}
                  turn={turn}
                  poolSize={poolSize}
                  whyHere={opts.rankReason?.(pull) ?? null}
                  title="see the full state"
               >
                  <RepoRef repo={d.repo} number={d.number} />
               </StatePopover>
               {regions.length > 0 && (
                  // a neutral chip, only the ◆ in brand: region-match is soft
                  // personalization, not urgency — a filled brand chip diluted
                  // "blue = your move" (color audit)
                  <span
                     title={`in your code ${regions.length > 1 ? 'regions' : 'region'}: ${regions.join(', ')}`}
                     className="pd-chip-optional chip-in inline-flex flex-none items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] leading-none font-medium text-ink-2"
                  >
                     <span aria-hidden className="text-brand">
                        ◆
                     </span>
                     {regions.slice(0, 2).join(', ')}
                     {regions.length > 2 && ` +${regions.length - 2}`}
                  </span>
               )}
               <RowDetails flags={rowFlags(pull, showIterating, depth, orphanParent)} />
               {/* the age numeral floats right, capping the baseline track —
                   a quiet timestamp column, mail-client style */}
               <span className="ml-auto flex-none pr-0.5">
                  <AgeStamp
                     ageDays={pull.ageDays}
                     createdAt={epoch(d.created_at)}
                     updatedAt={epoch(d.updated_at)}
                     quiet={['draft', 'dev_block', 'deploy_block'].includes(pull.status)}
                     warnDays={opts.ageWarnDays}
                     rotDays={opts.ageRotDays}
                     inline
                  />
               </span>
            </>
         }
         rail={<MetricRail pull={pull} opts={opts} claim={claim} />}
         edge={
            <AgeBaseline
               ageDays={pull.ageDays}
               warnDays={opts.ageWarnDays}
               maxAgeDays={opts.maxAgeDays}
               quiet={['draft', 'dev_block', 'deploy_block'].includes(pull.status)}
            />
         }
      />
   );
}

/**
 * Rows re-render only when their pull is re-derived (the store caches
 * derive() per PullData reference) or an option actually changes — a burst
 * of pullChange events must not reconcile 180 untouched rows. There's no
 * separate opts.claims to check any more: a claim lives on the pull itself
 * (review_requests), so claiming/releasing arrives as a new pull reference
 * (a.pull !== b.pull) and the row re-renders through that, same as any other
 * pull update.
 */
export const Row = memo(
   RowImpl,
   (a, b) =>
      a.pull === b.pull &&
      a.depth === b.depth &&
      a.opts.compact === b.opts.compact &&
      a.opts.me === b.opts.me &&
      a.opts.lastSeen === b.opts.lastSeen &&
      a.opts.acked === b.opts.acked &&
      a.opts.onPerson === b.opts.onPerson &&
      a.opts.ageWarnDays === b.opts.ageWarnDays &&
      a.opts.maxAgeDays === b.opts.maxAgeDays &&
      a.opts.ageRotDays === b.opts.ageRotDays &&
      a.opts.onWeightToggle === b.opts.onWeightToggle &&
      a.opts.parentOf === b.opts.parentOf &&
      a.opts.pools === b.opts.pools &&
      a.opts.turns === b.opts.turns
);
