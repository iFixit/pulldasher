import type { ReactNode } from 'react';
import { headStatuses, type DerivedPull } from '../../../shared/model/status';
// the small module, so the board's rows don't load the projects model
import { MISC_SLUG } from '../../../shared/model/projectLabel';
import type { Claim, RowNote } from '../model/actions';
import { askedAgo, askedOf, rowNote, selfReviewed } from '../model/actions';
import { projectOfPull, useProjectStanding } from '../model/standing';
import type { PullData } from '../../../shared/types';
import { ago, closedEpoch, epoch, githubUrl, issueUrl, signatureUrl } from '../../../shared/format';
import { usePulldasher } from '../store';
import { ClosedBadge, FactLink, STATUS_LABEL } from './bits';
import { Avatar } from './identity';
import { Popover } from './Popover';

interface FeedbackSource {
   key: string;
   login: string;
   /** "blocked" / "changes requested" / "commented" */
   stateWord: string;
   atEpoch: number;
   body?: string;
   url: string;
}

function reviewStateWord(state: string): string {
   return state === 'CHANGES_REQUESTED' ? 'changes requested' : 'commented';
}

/** CHANGES_REQUESTED sorts ahead of COMMENTED/DISMISSED — the harsher verdict
 * is the more actionable one to see first. */
function reviewRank(state: string): number {
   return state === 'CHANGES_REQUESTED' ? 0 : 1;
}

/**
 * Every feedback source behind a pull's context line, in the order they
 * should read: active dev/deploy blocks first (the reason the pull can't
 * move at all), then unstamped reviewers (changes-requested before mere
 * comments). Empty when the pull has nothing feedback-shaped to show.
 */
function feedbackSources(p: DerivedPull): FeedbackSource[] {
   const d = p.data;

   const blockSources: FeedbackSource[] = [...d.status.dev_block, ...d.status.deploy_block]
      .filter(s => s.data.active)
      .map(s => ({
         key: `block-${s.data.comment_id}`,
         login: s.data.user.login,
         stateWord: s.data.type === 'dev_block' ? 'dev blocked' : 'deploy blocked',
         atEpoch: epoch(s.data.created_at),
         url: signatureUrl(s),
      }));

   const reviewerSources: FeedbackSource[] = [...(d.status.unstamped_reviewers ?? [])]
      .sort((a, b) => reviewRank(a.state) - reviewRank(b.state))
      .map((r, i) => ({
         key: `review-${r.login}-${i}`,
         login: r.login,
         stateWord: reviewStateWord(r.state),
         atEpoch: r.date,
         body: r.body,
         url:
            r.review_id != null
               ? `${githubUrl(d.repo, d.number)}#pullrequestreview-${r.review_id}`
               : githubUrl(d.repo, d.number),
      }));

   return [...blockSources, ...reviewerSources];
}

/** The one-sentence gloss for a doOnly note (action set, context null) —
 * rowNote's context carries the explanation for every other case, but these
 * four never set one, so the popover restates the action in plain words
 * instead of leaving Section 1 blank. */
const ACTION_EXPLANATION: Record<string, string> = {
   Undraft: 'your draft; mark it ready on GitHub when you want review.',
   'Merge it': 'fully signed off and green, go ahead and merge.',
   'Finish QA': "you're already testing it, finish up and stamp.",
   'Re-QA': 'a push invalidated your QA stamp.',
};

function stateExplanation(pull: DerivedPull, note: RowNote): string {
   if (note.context) return note.context;
   if (note.action && ACTION_EXPLANATION[note.action]) return ACTION_EXPLANATION[note.action];
   return `${STATUS_LABEL[pull.status].toLowerCase()}.`;
}

/** Section 1: what this pull's badge means, restated in a sentence, plus the
 * viewer's own move when they have one. The claim flows into rowNote here
 * exactly as it does on the row itself, so the popover never asserts a next
 * step the row doesn't. */
function StateSection({
   pull,
   me,
   claim,
}: {
   pull: DerivedPull;
   me: string;
   claim?: Claim | null;
}) {
   const note = rowNote(pull, me, { claim });
   return (
      <div className="border-b border-secondary px-1 pb-2">
         <p className="font-semibold text-ink">{STATUS_LABEL[pull.status]}</p>
         <p className="mt-0.5 text-ink-2">{stateExplanation(pull, note)}</p>
         {note.action && (
            <p className="mt-1 font-medium text-brand">your next step: {note.action}</p>
         )}
      </div>
   );
}

/** Section 2: the sign-off/CI facts every row's rail hints at, spelled out,
 * plus who reviews it: who said they'd review it, who was asked, or the
 * author's own self-review. */
function FactsSection({
   pull,
   claim,
   onProject,
}: {
   pull: DerivedPull;
   claim?: Claim | null;
   /** open its project's page; unset on that page itself */
   onProject?: (slug: string) => void;
}) {
   const d = pull.data;
   // its project by the Projects tab's rule: its label, else the project
   // whose issue it links. The board has the slug, not the project's name
   // (that comes with the Projects tab's own fetch), so the link shows it
   const { projectLabelPrefix } = usePulldasher();
   const standing = useProjectStanding(projectLabelPrefix);
   const slug = projectLabelPrefix ? projectOfPull(pull, projectLabelPrefix, standing) : null;
   const crReq = d.status.cr_req;
   const qaReq = d.status.qa_req;
   const ciWord =
      pull.ci === 'failing'
         ? 'failing'
         : pull.ci === 'pending'
         ? 'running'
         : pull.ci === 'success'
         ? 'passed'
         : 'no checks required';
   // a failing check's name links straight to its run log (the status's
   // target_url) — "which check, and show me" without a GitHub detour
   const redLogs = new Map(
      headStatuses(d)
         .filter(s => s.data.state === 'failure' || s.data.state === 'error')
         .map(s => [s.data.context, s.data.target_url])
   );
   const srcLink = (href: string, word: string) => (
      <a
         href={href}
         target="_blank"
         rel="noopener noreferrer"
         className="text-brand hover:underline"
      >
         {word}
      </a>
   );
   return (
      <div className="flex flex-col gap-1 border-b border-secondary px-1 py-2 text-ink-2">
         {/* no "· updated X ago" here: it duplicated the "last commit X ago"
             the state line above already shows (same event, same timestamp) */}
         <p>
            opened {ago(epoch(d.created_at))} ago by{' '}
            <b className="font-medium text-ink">{d.user.login}</b>
         </p>
         {/* the one readable home for the branch name — the row's copy action
             only tucks it in a tooltip, and "which branch is this?" shouldn't
             need a trip to GitHub */}
         <p className="break-all">
            branch <b className="font-medium text-ink">{d.head.ref}</b>
            <span className="text-ink-3"> into {d.base.ref}</span>
         </p>
         {/* the conflict named and actionable in place: which branch it
             fights, and the door to GitHub's conflict editor */}
         {pull.conflict && (
            <p>
               <span style={{ color: 'var(--warn)' }}>conflicts with {d.base.ref}</span> ·{' '}
               {srcLink(`${githubUrl(d.repo, d.number)}/conflicts`, 'resolve on GitHub →')}
            </p>
         )}
         {d.closes != null && <p>closes {srcLink(issueUrl(d.repo, d.closes), `#${d.closes}`)}</p>}
         {d.connects != null && (
            <p>connects {srcLink(issueUrl(d.repo, d.connects), `#${d.connects}`)}</p>
         )}
         <p>
            CR {pull.crHave} of {crReq}
            {pull.crBy.length > 0 && <> · {pull.crBy.join(', ')}</>}
            {pull.recrBy.length > 0 && (
               <span style={{ color: 'var(--warn)' }}> · stale: {pull.recrBy.join(', ')}</span>
            )}
         </p>
         <p>
            QA {pull.qaHave} of {qaReq}
            {pull.qaBy.length > 0 && <> · {pull.qaBy.join(', ')}</>}
            {pull.qaingLogin && <> · {pull.qaingLogin} testing</>}
            {pull.reqaBy.length > 0 && (
               <span style={{ color: 'var(--warn)' }}> · stale: {pull.reqaBy.join(', ')}</span>
            )}
         </p>
         <p>
            CI: {ciWord}
            {pull.ci === 'failing' &&
               pull.ciFailing.map(ctx => (
                  <span key={ctx}>
                     {' · '}
                     {srcLink(redLogs.get(ctx) || `${githubUrl(d.repo, d.number)}/checks`, ctx)}
                  </span>
               ))}
         </p>
         {(d.status.comment_count ?? 0) > 0 && (
            <p>
               {d.status.comment_count} comment{d.status.comment_count === 1 ? '' : 's'}
               {d.status.last_comment_at && <> · last {ago(epoch(d.status.last_comment_at))} ago</>}
            </p>
         )}
         {(d.assignees?.length ?? 0) > 0 && <p>assigned to {d.assignees!.join(', ')}</p>}
         {d.milestone.title && (
            <p>
               milestone <b className="font-medium text-ink">{d.milestone.title}</b>
               {d.milestone.due_on && (
                  <span className="text-ink-3"> · due {d.milestone.due_on.slice(0, 10)}</span>
               )}
            </p>
         )}
         {slug && slug !== MISC_SLUG && (
            <p>
               project{' '}
               {onProject ? (
                  // through the app, so the board's filters stay
                  <FactLink
                     onClick={() => onProject(slug)}
                     aria-label={`${slug}: open its page on the Projects tab`}
                  >
                     {slug}
                  </FactLink>
               ) : (
                  <b className="font-medium text-ink">{slug}</b>
               )}
            </p>
         )}
         {claim && (
            <p>
               <b className="font-medium text-ink">{claim.login}</b> said they’d review it
               {claim.at != null && <> · {ago(claim.at)} ago</>}
            </p>
         )}
         {askedOf(pull).length > 0 ? (
            <p>
               review asked of <b className="font-medium text-ink">{askedOf(pull).join(', ')}</b>
               {askedAgo(pull) && <> · {askedAgo(pull)}</>}
            </p>
         ) : (
            !claim &&
            selfReviewed(pull) && <p>self-review: {d.user.login} stamps it, nobody was asked</p>
         )}
      </div>
   );
}

/** Section 3: the existing feedback excerpts, unchanged — just relocated
 * into the universal popover instead of their own mini one. */
function FeedbackSection({ pull }: { pull: DerivedPull }) {
   const sources = feedbackSources(pull);
   if (!sources.length) return null;
   return (
      <div className="flex flex-col gap-1.5 border-b border-secondary px-1 py-2">
         {sources.map(s => (
            <div key={s.key} className="flex flex-col gap-1">
               <span className="flex items-center gap-1.5">
                  <Avatar login={s.login} size={18} />
                  <b className="min-w-0 font-medium break-all text-ink">{s.login}</b>
                  <span className="text-ink-3">{s.stateWord}</span>
                  <span className="ml-auto pl-2 whitespace-nowrap text-ink-3 tabular-nums">
                     {ago(s.atEpoch)} ago
                  </span>
               </span>
               {s.body && <p className="line-clamp-2 text-ink-2">{s.body}</p>}
               <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start text-brand hover:underline"
               >
                  View on GitHub →
               </a>
            </div>
         ))}
      </div>
   );
}

function StatePopoverBody({
   pull,
   me,
   claim,
   whyHere,
   onProject,
}: {
   pull: DerivedPull;
   me: string;
   claim?: Claim | null;
   whyHere?: string | null;
   onProject?: (slug: string) => void;
}) {
   return (
      <>
         <StateSection pull={pull} me={me} claim={claim} />
         <FactsSection pull={pull} claim={claim} onProject={onProject} />
         <FeedbackSection pull={pull} />
         {/* ranked lanes explain their pick per-card here — behind the same
             door as everything else, never inline on the row */}
         {whyHere && (
            <p className="border-b border-secondary px-1 py-2 text-ink-3">
               <span className="font-medium text-ink-2">why it’s up next: </span>
               {whyHere}
            </p>
         )}
         <a
            href={githubUrl(pull.data.repo, pull.data.number)}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-1 pt-2 font-medium text-brand hover:underline"
         >
            View PR on GitHub →
         </a>
      </>
   );
}

// pd-raise: every trigger here sits inside a row whose title link stretches
// an invisible click-through layer over the whole card (see styles.css) —
// without it, none of these would be clickable at all.
const TRIGGER_HINT =
   'pd-raise border-0 bg-transparent p-0 hover:underline hover:decoration-dotted hover:underline-offset-2';

/**
 * The reusable door into the full-state popover: wrap any inline trigger
 * content (the status badge, a do-pill, the repo#number ref) and it opens the
 * same hover-pin panel — status restated, the sign-off/CI facts the rail only
 * hints at, and (when present) the feedback behind it. Extracted so that when
 * the status badge is suppressed as redundant with its container (see Row.tsx),
 * the drill-down entry point can move onto whatever the card DOES still show,
 * instead of vanishing with the badge.
 */
export function StatePopover({
   pull,
   me,
   claim,
   whyHere,
   onProject,
   title = 'see the full state',
   children,
}: {
   pull: DerivedPull;
   me: string;
   claim?: Claim | null;
   /** a ranked lane's one-line reason this pull sits where it does */
   whyHere?: string | null;
   /** open the PR's project page (RowOptions.onProject) */
   onProject?: (slug: string) => void;
   title?: string;
   children: ReactNode;
}) {
   return (
      <Popover
         label="Pull state"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max min-w-[240px] max-w-[340px]"
         panelClass="p-2 text-xs"
         trigger={t => (
            <button {...t} type="button" title={title} className={TRIGGER_HINT}>
               {children}
            </button>
         )}
      >
         <StatePopoverBody
            pull={pull}
            me={me}
            claim={claim}
            whyHere={whyHere}
            onProject={onProject}
         />
      </Popover>
   );
}

/**
 * The closed-row receipt: same trigger pattern, a much shorter panel — a
 * merged/closed pull has no state to restate, no facts left to owe anyone,
 * just when it landed and a link to the record.
 */
export function ClosedBadgeTrigger({ pull }: { pull: PullData }) {
   const merged = !!pull.merged_at;
   const closedAt = closedEpoch(pull);
   return (
      <Popover
         label="Pull state"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max min-w-[220px]"
         panelClass="p-2 text-xs"
         trigger={t => (
            <button {...t} type="button" title="see when this shipped" className={TRIGGER_HINT}>
               <ClosedBadge merged={merged} inline />
            </button>
         )}
      >
         <p className="px-1 text-ink-2">
            {merged ? 'merged' : 'closed'} {ago(closedAt)} ago by{' '}
            <b className="font-medium text-ink">{pull.user.login}</b>
         </p>
         <a
            href={githubUrl(pull.repo, pull.number)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block px-1 font-medium text-brand hover:underline"
         >
            View PR on GitHub →
         </a>
      </Popover>
   );
}
