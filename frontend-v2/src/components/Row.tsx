import { memo, useState, type ReactNode } from 'react';
import { AlarmClock, Copy, Diamond, EllipsisVertical, Hand, RefreshCw, Star } from 'lucide-react';
import type { DerivedPull } from '../model/status';
import { isIterating, lastPushEpoch, weightFilterKey } from '../model/status';
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
   StarMark,
   WEIGHT_WORD,
} from './bits';
import { CardShell } from './Card';
import { Icon } from './Icon';
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
   /** which clock the age numeral shows (settings.ageDisplay) */
   ageDisplay?: 'opened' | 'updated';
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
   /** the two "In your code regions" lanes (Review, Team) set this true on
    * their own rows: the lane header already says "this is your region," so
    * the region mark would be redundant on every card inside it. */
   hideRegionMark?: boolean;
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

/** "a, b, and c" for the region-match popover sentence — plain-English list,
 * no Oxford-comma debate for the two-item case. */
function joinAnd(items: string[]): string {
   if (items.length <= 1) return items.join('');
   if (items.length === 2) return `${items[0]} and ${items[1]}`;
   return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
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
               <Icon icon={Hand} />
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
                  <Icon icon={Copy} />
               )}
            </button>
            <button
               type="button"
               aria-label="snooze: off your Review lens until tomorrow or until it changes"
               title="snooze: off your Review lens until tomorrow or until it changes"
               className={btn}
               onClick={a.snooze}
            >
               <Icon icon={AlarmClock} />
            </button>
            <button
               type="button"
               aria-label="re-fetch this PR from GitHub"
               title="re-fetch this PR from GitHub"
               className={btn}
               onClick={a.refresh}
            >
               <Icon icon={RefreshCw} className={a.spinning ? 'spin-once' : undefined} />
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
                        : 'claim this review: adds you as a reviewer on the PR itself, so GitHub and the board both show you’re on it'
                  }
                  className={btn}
                  onClick={a.claim}
               >
                  <Icon icon={Hand} />
               </button>
            )}
         </span>
      </>
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
               <Icon icon={EllipsisVertical} />
            </button>
         )}
      >
         <button type="button" className={item} onClick={a.copy}>
            <Icon icon={Copy} />
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
            <Icon icon={AlarmClock} />
            Snooze until tomorrow
         </button>
         <button type="button" className={item} onClick={a.refresh}>
            <Icon icon={RefreshCw} className={a.spinning ? 'spin-once' : undefined} />
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
               <Icon icon={Hand} />
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
            <StarMark on={isPrimaryRepo} />
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
            <StarMark on={isStarredAuthor} />
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
 * The fixed-width label a rail slot leads with — CI, CR, QA, and the weight
 * letter all share this exact 18px/11px/font-medium slot, so whichever ones
 * a row shows still land at the same x down a board. aria-hidden: the
 * interactive mark beside it (a pip cluster or a popover trigger) carries
 * the accessible name.
 */
function RailLabel({ children }: { children: ReactNode }) {
   return (
      <span aria-hidden className="w-[18px] text-left text-[11px] font-medium text-ink-3">
         {children}
      </span>
   );
}

/**
 * The weight drill-down, now a section of the CR ledger panel (one popover
 * for the whole CR cluster — label, letter, and pips are a single door).
 * Content is the old standalone weight popover's: the effort word, the exact
 * diff, how the letter is decided, and the filter action.
 */
function WeightPanelSection({ pull, opts }: { pull: DerivedPull; opts: RowOptions }) {
   const { weight, sizeKnown } = pull;
   const d = pull.data;
   return (
      <div className="mt-1 border-t border-secondary px-1 pt-1.5">
         <span className="block text-ink-2">
            review effort:{' '}
            <b className="font-medium text-ink">{WEIGHT_WORD[weight]}</b>
            {sizeKnown ? '' : ' (estimated)'}
         </span>
         {sizeKnown && (
            <span className="mt-1 block">
               <DiffSize additions={d.additions ?? 0} deletions={d.deletions ?? 0} />
            </span>
         )}
         <span className="mt-1 block max-w-[230px] text-ink-3">
            {sizeKnown
               ? 'From the org’s size label when the PR has one, else the diff: 50 / 150 / 600 / 1500 lines step XS through XL, one class up past 15 files. A pointer, not a verdict.'
               : 'A guess: the wire sent no diff size.'}
         </span>
         {opts.onWeightToggle && (
            <span className="mt-1.5 block">
               <QuietButton onClick={() => opts.onWeightToggle?.(weightFilterKey(pull))}>
                  Filter to {sizeKnown ? weight : 'unknown-size'} PRs
               </QuietButton>
            </span>
         )}
      </div>
   );
}

/**
 * The metric rail every row ends on, in one order everywhere: CI, then CR
 * (label, weight letter, sign-off pips), then QA (label, pips). One line,
 * vertically centered — the weight ruler that used to run underneath is
 * gone; the letter says the same thing inside the CR cluster instead.
 * Age lives on the row's own baseline, not in the rail (see RowImpl). Right-
 * anchored and fixed-geometry, so it reads as vertical columns down any
 * lens. Raised above the card's click layer so the sign-off popovers still
 * open.
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
         {/* one instrument, humans first: CR (label, weight letter, pips —
             one door into one panel), then QA, then the machine's circle at
             the rail's end, where its optional render (green only on hover)
             can't shift the human marks, and last the age numeral capping
             the row. */}
         <SigPips
            label="CR"
            have={pull.crHave}
            req={d.status.cr_req}
            by={pull.crBy}
            staleBy={pull.recrBy}
            me={me}
            sigs={d.status.allCR}
            lead={
               <>
                  <RailLabel>CR</RailLabel>
                  {/* the owner's sketch was "CR · S ✓✓": the middot keeps the
                      label and the size letter from fusing at 11px */}
                  <span aria-hidden className="flex-none text-[11px] text-ink-3">
                     ·
                  </span>
                  <span
                     aria-hidden
                     className={`w-[18px] flex-none text-left text-[11px] font-medium tabular-nums text-ink-3 ${
                        pull.sizeKnown ? '' : 'opacity-60'
                     }`}
                  >
                     {pull.sizeKnown ? pull.weight : '?'}
                  </span>
               </>
            }
            panelExtra={<WeightPanelSection pull={pull} opts={opts} />}
         />
         <SigPips
            label="QA"
            have={pull.qaHave}
            req={d.status.qa_req}
            by={pull.qaBy}
            staleBy={pull.reqaBy}
            me={me}
            sigs={d.status.allQA}
            lead={<RailLabel>QA</RailLabel>}
         />
         <CiStatus pull={pull} />
         {/* the age numeral caps the rail — the row's far-right column, a
             whisper in the age line's own tint until the row is hovered
             (styles.css .pd-age-num). Which clock it shows is the user's
             call (settings.ageDisplay); both clocks stay in its popover. */}
         <AgeStamp
            ageDays={pull.ageDays}
            createdAt={epoch(d.created_at)}
            updatedAt={epoch(d.updated_at)}
            quiet={['draft', 'dev_block', 'deploy_block'].includes(pull.status)}
            warnDays={opts.ageWarnDays}
            rotDays={opts.ageRotDays}
            display={opts.ageDisplay}
         />
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
         stackStub={pull.dependent && depth === 0}
         className={`${flashOnce(key, !!fresh) ? 'row-fresh' : ''} transition-[background-color] duration-150 ease-out motion-reduce:transition-none`}
         avatarBadge={
            starredAuthor && (
               <span
                  title={`${d.user.login} is starred`}
                  className="absolute -right-0.5 -bottom-0.5 text-brand"
               >
                  <Icon icon={Star} size={9} fill="currentColor" />
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
               {regions.length > 0 && !opts.hideRegionMark && (
                  // a bare hover-door mark, not a chip: region-match is soft
                  // personalization, not urgency, and inside the "In your code
                  // regions" lanes it would only repeat what the lane header
                  // already says — a filled brand chip diluted "blue = your
                  // move" (color audit), and naming every region inline
                  // out-weighed a 10px glyph (2026-07 icon pass)
                  <Popover
                     label="Code region match"
                     hover
                     side="right"
                     rootClass="relative inline-flex flex-none"
                     width="w-max max-w-[260px]"
                     panelClass="p-2 text-xs"
                     trigger={t => (
                        <button
                           {...t}
                           type="button"
                           aria-label={`in your code ${regions.length > 1 ? 'regions' : 'region'}: ${regions.join(', ')}`}
                           className="pressable -my-2 flex-none rounded px-0.5 py-2 text-brand hover:bg-secondary/60"
                        >
                           <Icon icon={Diamond} size={10} fill="currentColor" />
                        </button>
                     )}
                  >
                     <span className="block text-ink-2">
                        Touches {joinAnd(regions)},{' '}
                        {regions.length > 1 ? 'code regions' : 'a code region'} you flagged in
                        Settings.
                     </span>
                  </Popover>
               )}
               <RowDetails flags={rowFlags(pull, showIterating, depth, orphanParent)} />
            </>
         }
         rail={<MetricRail pull={pull} opts={opts} claim={claim} />}
         edge={
            <AgeBaseline
               ageDays={pull.ageDays}
               createdAt={epoch(d.created_at)}
               updatedAt={epoch(d.updated_at)}
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
      a.opts.ageDisplay === b.opts.ageDisplay &&
      a.opts.onWeightToggle === b.opts.onWeightToggle &&
      a.opts.parentOf === b.opts.parentOf &&
      a.opts.pools === b.opts.pools &&
      a.opts.turns === b.opts.turns
);
