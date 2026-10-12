import {
   CircleCheck,
   CircleDot,
   CircleSlash,
   GitMerge,
   GitPullRequest,
   GitPullRequestClosed,
} from 'lucide-react';
import { issueUrl, n, shortRepo } from '../../../shared/format';
import { dateWords } from '../model/stage';
import { Icon, type LucideComponent } from './Icon';
import { Avatar } from './identity';
import { Popover } from './Popover';

/**
 * An issue or PR named the way Claude and GitHub show one: a small chip
 * (its state's icon, #number, repo) that opens a card with its state, repo
 * and number, the day it opened, title, author, and for a PR its size, the
 * way a board row's repo#number opens its state. The card links it on
 * GitHub. Whatever isn't known is left off the card.
 */

export interface GitHubRefData {
   kind: 'issue' | 'pr';
   repo: string;
   number: number;
   title?: string | null;
   /** an issue: open, done or dropped; a PR: open, merged or closed */
   state?: 'open' | 'done' | 'dropped' | 'merged' | 'closed' | null;
   author?: string | null;
   /** epoch secs it was opened */
   createdAt?: number | null;
   additions?: number | null;
   deletions?: number | null;
   files?: number | null;
}

interface Look {
   icon: LucideComponent;
   word: string;
   /** a color token, by the board's one color rule (DESIGN.md): green is
    * the quiet confirmation (done, merged), ink everything else */
   color: string;
}

const LOOKS: Record<string, Look> = {
   'issue:open': { icon: CircleDot, word: 'Open', color: 'var(--ink-2)' },
   'issue:done': { icon: CircleCheck, word: 'Done', color: 'var(--ok)' },
   'issue:dropped': { icon: CircleSlash, word: 'Dropped', color: 'var(--ink-3)' },
   'pr:open': { icon: GitPullRequest, word: 'Open', color: 'var(--ink-2)' },
   'pr:merged': { icon: GitMerge, word: 'Merged', color: 'var(--ok)' },
   'pr:closed': { icon: GitPullRequestClosed, word: 'Closed', color: 'var(--ink-3)' },
};

const lookOf = (ref: GitHubRefData): Look | null =>
   ref.state ? LOOKS[`${ref.kind}:${ref.state}`] ?? null : null;

/** When it was opened, as the tab says a day: "opened Sep 21". */
export const openedWords = (epochSecs: number) => `opened ${dateWords(epochSecs)}`;

/** The state in words, with its icon; no wash behind it (a filled area
 * outshouts the title). */
export function StatePill({ data }: { data: GitHubRefData }) {
   const look = lookOf(data);
   if (!look) return null;
   return (
      <span
         className="inline-flex flex-none items-center gap-1 text-xs font-medium"
         style={{ color: look.color }}
      >
         <Icon icon={look.icon} size={13} />
         {look.word}
      </span>
   );
}

/** The hover card: state, repo and number, the day it opened, title,
 * author, PR size. */
export function RefCard({ data }: { data: GitHubRefData }) {
   const size =
      data.kind === 'pr' && data.additions != null && data.deletions != null ? (
         <span className="ml-auto flex flex-none items-center gap-1.5 tabular-nums">
            <span className="rounded px-1 text-ok">+{data.additions.toLocaleString()}</span>
            <span className="rounded px-1 text-bad">−{data.deletions.toLocaleString()}</span>
            {data.files != null && (
               <span className="rounded bg-muted px-1.5">{n(data.files, 'file')}</span>
            )}
         </span>
      ) : null;
   return (
      <span className="block text-left">
         <span className="flex items-center gap-2 text-xs text-ink-3">
            <StatePill data={data} />
            {/* the way to it on GitHub, whether or not its title is known */}
            <a
               href={issueUrl(data.repo, data.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="min-w-0 truncate hover:text-brand hover:underline"
            >
               {data.repo} #{data.number}
            </a>
            {data.createdAt != null && (
               <span className="ml-auto flex-none">{openedWords(data.createdAt)}</span>
            )}
         </span>
         {data.title && (
            <a
               href={issueUrl(data.repo, data.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="mt-2 block text-[13px] font-semibold leading-snug text-ink hover:text-brand hover:underline"
            >
               {data.title}
            </a>
         )}
         {(data.author || size) && (
            <span className="mt-2.5 flex items-center gap-2 text-xs text-ink-3">
               {data.author && (
                  <>
                     <Avatar login={data.author} size={18} />
                     <span>{data.author}</span>
                  </>
               )}
               {size}
            </span>
         )}
      </span>
   );
}

/**
 * The small chip: the state's icon, #number, and the repo when it isn't
 * the page's usual one; a PR's says "PR" and its state too, so it reads
 * without the card. The icon's shape tells the state; where it sits (an
 * Open or Done fold) already says so, so it stays ink. Like a row's
 * repo#number, hovering shows its card and a click pins it; the title
 * beside it is what opens it on GitHub. `tabStop` false where that title
 * is the line's way in for a keyboard: one stop for the issue, not two.
 */
export function RefChip({
   data,
   repoShown = true,
   tabStop = true,
}: {
   data: GitHubRefData;
   repoShown?: boolean;
   tabStop?: boolean;
}) {
   const look = lookOf(data);
   const fallback = data.kind === 'pr' ? GitPullRequest : CircleDot;
   return (
      <Popover
         label={`${data.kind === 'pr' ? 'PR' : 'Issue'} ${data.repo} #${data.number}`}
         hover
         rootClass="relative inline-flex min-w-0"
         width="w-[320px] max-w-[calc(100vw-2rem)]"
         panelClass="p-3"
         trigger={t => (
            <button
               {...t}
               type="button"
               tabIndex={tabStop ? undefined : -1}
               className="group/ref hit pressable inline-flex min-w-0 items-baseline gap-1 rounded border-0 bg-transparent p-0 text-left text-xs text-ink-3 hover:text-ink-2"
            >
               <Icon icon={look?.icon ?? fallback} size={12} className="flex-none self-center" />
               {/* the row's door look: no underline until hovered, then dotted */}
               <span className="font-medium text-ink-2 underline-offset-2 group-hover/ref:underline group-hover/ref:decoration-dotted">
                  {data.kind === 'pr' ? 'PR ' : ''}#{data.number}
               </span>
               {repoShown && <span className="truncate">{shortRepo(data.repo)}</span>}
               {data.kind === 'pr' && look && <span>{look.word.toLowerCase()}</span>}
            </button>
         )}
      >
         <RefCard data={data} />
      </Popover>
   );
}
