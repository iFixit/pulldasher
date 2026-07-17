import type { PullData } from '../types';
import { ago, githubUrl, shortRepo } from '../format';
import { Avatar } from './bits';

export function ClosedRow({ pull }: { pull: PullData }) {
   const merged = !!pull.merged_at;
   const closedAt = Date.parse(pull.closed_at ?? pull.updated_at) / 1000;
   return (
      <div className="flex items-center gap-2.5 border-t border-secondary py-2 pr-3.5 pl-[11px] first:border-t-0 hover:bg-muted">
         <span
            className={`badge ${merged ? 'badge-ready' : 'badge-cr'}`}
            title={merged ? 'merged' : 'closed without merging'}
         >
            {merged ? 'Merged' : 'Closed'}
         </span>
         <Avatar login={pull.user.login} />
         <span className="min-w-0 flex-1 text-sm break-words">
            <a
               className="font-medium hover:underline hover:underline-offset-2"
               href={githubUrl(pull.repo, pull.number)}
               target="_blank"
               rel="noopener noreferrer"
            >
               {pull.title}
            </a>
         </span>
         <span className="flex-none text-xs whitespace-nowrap text-ink-3">
            {shortRepo(pull.repo)}#{pull.number} · {ago(closedAt)} ago
         </span>
      </div>
   );
}
