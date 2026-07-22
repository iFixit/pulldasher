import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { ago, githubUrl } from '../format';
import { useSettings } from '../settings';
import type { ToastRecord } from '../toasts';
import { Icon } from './Icon';
import { onOpen, Popover } from './Popover';

/** Tone → medallion tint, matching the toast card's own vocabulary so a nudge
 * reads the same in the panel as it did when it flashed. */
const MEDALLION: Record<ToastRecord['toast']['tone'], string> = {
   reward: 'bg-brand-50 text-brand',
   info: 'bg-brand-50 text-brand',
   nag: 'bg-secondary text-ink-2',
};

/**
 * The recent-nudges panel: toasts are deliberately non-sticky, so this is
 * where a nudge you missed (or dismissed) stays recoverable — the same list
 * the toast stack fired, newest first, each still linking its PR. A brand dot
 * on the bell counts what's landed since you last opened it.
 */
export function NotificationPanel({
   records,
   onClear,
   onDismiss,
}: {
   records: ToastRecord[];
   /** wipe the whole log */
   onClear: () => void;
   /** drop a single entry */
   onDismiss: (id: number) => void;
}) {
   // session-only "last opened" — toasts are session-only too, so there's
   // nothing to persist. Everything fired after this counts as unseen.
   const [lastSeen, setLastSeen] = useState(0);
   const unseen = records.filter(r => r.at > lastSeen).length;
   const badge = useSettings().notifyBadge;
   const flag = unseen > 0 && badge !== 'none';

   return (
      <Popover
         label="Recent nudges"
         side="right"
         width="w-[320px]"
         panelClass="max-h-[70vh] overflow-auto p-0 text-xs"
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={unseen > 0 ? `recent nudges, ${unseen} new` : 'recent nudges'}
               title="recent nudges"
               // opening marks everything seen
               onClick={onOpen(t, () => setLastSeen(Date.now()))}
               className="pressable relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 hover:text-brand"
            >
               <Icon icon={Bell} size={16} />
               {flag &&
                  (badge === 'dot' ? (
                     <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-surface" />
                  ) : (
                     <span className="absolute -top-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-surface">
                        {unseen > 9 ? '9+' : unseen}
                     </span>
                  ))}
            </button>
         )}
      >
         <div className="flex items-center gap-2 border-b border-secondary px-3 py-2">
            <span className="flex-1 text-[13px] font-semibold text-ink">Recent nudges</span>
            {records.length > 0 && (
               <button
                  type="button"
                  onClick={onClear}
                  className="pressable rounded px-1 text-[11px] font-medium text-ink-3 hover:text-brand"
               >
                  Clear
               </button>
            )}
         </div>
         {records.length === 0 ? (
            <div className="p-3 text-ink-3">No nudges yet.</div>
         ) : (
            <ul className="m-0 flex list-none flex-col p-1">
               {records.map(r => (
                  <li
                     key={r.id}
                     className="group/n flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted"
                  >
                     <span
                        aria-hidden
                        className={`grid h-6 w-6 flex-none place-items-center rounded-full text-sm ${MEDALLION[r.toast.tone]}`}
                     >
                        {r.toast.icon}
                     </span>
                     <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                           <span className="truncate font-semibold text-ink">{r.toast.title}</span>
                           <span className="flex-none text-[10px] text-ink-3 tabular-nums">
                              {ago(r.at / 1000)}
                           </span>
                        </span>
                        {r.toast.pull && (
                           <a
                              href={githubUrl(r.toast.pull.repo, r.toast.pull.number)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-0.5 block truncate font-medium text-brand hover:underline"
                           >
                              #{r.toast.pull.number}
                              {r.toast.pull.title ? ` ${r.toast.pull.title}` : ''}
                           </a>
                        )}
                        {r.toast.body && (
                           <span className="mt-0.5 block text-ink-2">{r.toast.body}</span>
                        )}
                     </span>
                     <button
                        type="button"
                        aria-label="dismiss this nudge"
                        onClick={() => onDismiss(r.id)}
                        className="hit pressable -m-1 flex-none rounded p-1 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover/n:opacity-100 focus-visible:opacity-100"
                     >
                        <Icon icon={X} size={12} />
                     </button>
                  </li>
               ))}
            </ul>
         )}
      </Popover>
   );
}
