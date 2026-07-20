import { useState } from 'react';
import { ago, githubUrl } from '../format';
import type { ToastRecord } from '../toasts';
import { Popover } from './Popover';

// A plain outline bell (16-unit viewBox) — the clapper is a second subpath.
const BELL =
   'M8 1.5A2.5 2.5 0 0 0 5.5 4v.28C4.03 4.9 3 6.36 3 8.06V11l-1.2 1.2A.5.5 0 0 0 2.15 13H13.85a.5.5 0 0 0 .35-.85L13 11V8.06c0-1.7-1.03-3.16-2.5-3.78V4A2.5 2.5 0 0 0 8 1.5Zm1.5 12.5a1.5 1.5 0 0 1-3 0h3Z';

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
export function NotificationPanel({ records }: { records: ToastRecord[] }) {
   // session-only "last opened" — toasts are session-only too, so there's
   // nothing to persist. Everything fired after this counts as unseen.
   const [lastSeen, setLastSeen] = useState(0);
   const unseen = records.filter(r => r.at > lastSeen).length;

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
               // opening marks everything seen; aria-expanded says which way
               // this click goes (the toggle itself is the house Popover's)
               onClick={() => {
                  const wasOpen = t['aria-expanded'];
                  t.onClick();
                  if (!wasOpen) setLastSeen(Date.now());
               }}
               className="pressable relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 hover:text-brand"
            >
               <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 fill-current">
                  <path d={BELL} />
               </svg>
               {unseen > 0 && (
                  <span className="absolute -top-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-surface">
                     {unseen > 9 ? '9+' : unseen}
                  </span>
               )}
            </button>
         )}
      >
         <span className="block border-b border-secondary px-3 py-2 text-[13px] font-semibold text-ink">
            Recent nudges
         </span>
         {records.length === 0 ? (
            <div className="p-3 text-ink-3">No nudges yet.</div>
         ) : (
            <ul className="m-0 flex list-none flex-col p-1">
               {records.map(r => (
                  <li
                     key={r.id}
                     className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted"
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
                  </li>
               ))}
            </ul>
         )}
      </Popover>
   );
}
