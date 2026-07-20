import type { DerivedPull } from '../model/status';
import { ago, epoch, githubUrl, signatureUrl } from '../format';
import { Avatar } from './bits';
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
 * comments). Empty when the pull has nothing feedback-shaped to show, in
 * which case the caller renders plain text instead of a popover trigger.
 */
function feedbackSources(p: DerivedPull): FeedbackSource[] {
   const d = p.data;

   const blockSources: FeedbackSource[] = [...d.status.dev_block, ...d.status.deploy_block]
      .filter(s => s.data.active)
      .map(s => ({
         key: `block-${s.data.comment_id}`,
         login: s.data.user.login,
         stateWord: 'blocked',
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

/**
 * The context line, made drill-down-able: when a pull's context text has
 * feedback behind it (an active dev/deploy block, an unstamped review), the
 * text becomes a hover-preview trigger for who said what — the feedback
 * itself one hover away, instead of a screenful of clicking through to
 * GitHub. Falls back to the plain text (today's behavior) when there's
 * nothing to show, same as SigPips falls back to plain pips with no
 * signatures.
 */
export function FeedbackPopover({ pull, text }: { pull: DerivedPull; text: string }) {
   const sources = feedbackSources(pull);
   if (!sources.length) return <span className="text-ink-2">{text}</span>;

   return (
      <Popover
         label="Feedback"
         side="right"
         hover
         rootClass="relative inline-flex"
         width="w-max min-w-[220px] max-w-[320px]"
         panelClass="p-2 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               title="see the feedback behind this"
               className="border-0 bg-transparent p-0 text-left text-ink-2 hover:underline hover:decoration-dotted hover:underline-offset-2"
            >
               {text}
            </button>
         )}
      >
         <span className="block px-1 pb-1 font-semibold text-ink">Feedback</span>
         {sources.map(s => (
            <div
               key={s.key}
               className="flex flex-col gap-1 border-t border-secondary px-1 py-1.5 first:border-t-0"
            >
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
                  rel="noopener"
                  className="self-start text-brand hover:underline"
               >
                  View on GitHub →
               </a>
            </div>
         ))}
      </Popover>
   );
}
