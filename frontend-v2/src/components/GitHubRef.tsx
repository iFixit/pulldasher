import {
   CircleCheck,
   CircleDot,
   CircleSlash,
   GitMerge,
   GitPullRequest,
   GitPullRequestClosed,
} from 'lucide-react';
import type { Ref } from 'react';
import { issueUrl, n, shortRepo } from '../../../shared/format';
import { Icon, type LucideComponent } from './Icon';
import { Avatar } from './identity';
import { Popover } from './Popover';

/**
 * An issue or PR named the way Claude and GitHub show one: a small link
 * (its state's icon, #number, repo) that opens it on GitHub, and on hover a
 * card with its state, repo and number, age, title, author, and for a PR
 * its size. Whatever isn't known is left off the card.
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
   /** a color token: green open, violet done or merged, slate closed */
   color: string;
}

const LOOKS: Record<string, Look> = {
   'issue:open': { icon: CircleDot, word: 'Open', color: 'var(--ok)' },
   'issue:done': { icon: CircleCheck, word: 'Done', color: 'var(--violet)' },
   'issue:dropped': { icon: CircleSlash, word: 'Dropped', color: 'var(--slate)' },
   'pr:open': { icon: GitPullRequest, word: 'Open', color: 'var(--ok)' },
   'pr:merged': { icon: GitMerge, word: 'Merged', color: 'var(--violet)' },
   'pr:closed': { icon: GitPullRequestClosed, word: 'Closed', color: 'var(--slate)' },
};

const lookOf = (ref: GitHubRefData): Look | null =>
   ref.state ? LOOKS[`${ref.kind}:${ref.state}`] ?? null : null;

/** "34m ago", "5h ago", "3d ago", "2mo ago", "1y ago". */
export function sinceWords(epochSecs: number, now: number = Date.now() / 1000): string {
   const s = Math.max(0, now - epochSecs);
   if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
   if (s < 48 * 3600) return `${Math.round(s / 3600)}h ago`;
   if (s < 60 * 86400) return `${Math.round(s / 86400)}d ago`;
   if (s < 730 * 86400) return `${Math.round(s / (30 * 86400))}mo ago`;
   return `${Math.round(s / (365 * 86400))}y ago`;
}

/** The state as a tinted pill: its icon and word. */
export function StatePill({ data }: { data: GitHubRefData }) {
   const look = lookOf(data);
   if (!look) return null;
   return (
      <span
         className="inline-flex flex-none items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
         style={{
            color: look.color,
            background: `color-mix(in oklch, ${look.color} 14%, transparent)`,
         }}
      >
         <Icon icon={look.icon} size={13} />
         {look.word}
      </span>
   );
}

/** The hover card: state, repo and number, age, title, author, PR size. */
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
            <span className="min-w-0 truncate">
               {data.repo} #{data.number}
            </span>
            {data.createdAt != null && (
               <span className="ml-auto flex-none">{sinceWords(data.createdAt)}</span>
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
 * The small link: the state's icon in its color, #number, and the repo; a
 * PR's says "PR" and its state too, so it reads without the card. A click
 * opens it on GitHub; a hover shows its card.
 */
export function RefChip({ data, repoShown = true }: { data: GitHubRefData; repoShown?: boolean }) {
   const look = lookOf(data);
   const fallback = data.kind === 'pr' ? GitPullRequest : CircleDot;
   return (
      <Popover
         label={`${data.repo} #${data.number}`}
         hover
         hoverTriggerOnly
         rootClass="relative inline-flex min-w-0"
         width="w-[320px] max-w-[calc(100vw-2rem)]"
         panelClass="p-3"
         // a click opens it on GitHub, so the card only opens on hover
         trigger={t => (
            <a
               ref={t.ref as unknown as Ref<HTMLAnchorElement>}
               onPointerEnter={t.onPointerEnter}
               onPointerLeave={t.onPointerLeave}
               href={issueUrl(data.repo, data.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="inline-flex min-w-0 items-baseline gap-1 rounded text-xs text-ink-3 hover:text-brand"
            >
               <Icon
                  icon={look?.icon ?? fallback}
                  size={12}
                  className="flex-none self-center"
                  style={look ? { color: look.color } : undefined}
               />
               <span className="font-medium text-ink-2 underline decoration-line underline-offset-2">
                  {data.kind === 'pr' ? 'PR ' : ''}#{data.number}
               </span>
               {repoShown && <span className="truncate">{shortRepo(data.repo)}</span>}
               {data.kind === 'pr' && look && <span>{look.word.toLowerCase()}</span>}
            </a>
         )}
      >
         <RefCard data={data} />
      </Popover>
   );
}
