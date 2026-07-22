import { Segmented } from '../bits';
import { Popover } from '../Popover';

/**
 * The drafts toggle as a first-class filter control, sitting on the filter row
 * beside Repos/People/Weight/State instead of buried under the Repos popover's
 * "This session" fold. Binary (your own drafts always show; "all" adds everyone
 * else's), a session override of the `draftsMode` default in Settings — so the
 * trigger goes active only when it differs from that default.
 */
export function DraftsFilter({
   draftsMode,
   setDraftsMode,
   defaultMode,
}: {
   draftsMode: 'mine' | 'all';
   setDraftsMode: (m: 'mine' | 'all') => void;
   /** the Settings default this session value overrides */
   defaultMode: 'mine' | 'all';
}) {
   const active = draftsMode !== defaultMode;
   const summary = active ? `Drafts · ${draftsMode}` : 'Drafts';

   return (
      <div>
         <Popover
            label="Drafts filter"
            width="w-[240px]"
            panelClass="p-2.5"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <button
                  {...t}
                  type="button"
                  className={`pressable inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium ${
                     active
                        ? 'border-brand bg-brand-50 text-brand-700 hover:border-brand-700'
                        : 'border-line bg-surface text-ink-2 hover:text-brand'
                  }`}
                  title={summary}
                  aria-label={`drafts filter: ${summary}`}
               >
                  <svg
                     viewBox="0 0 16 16"
                     aria-hidden
                     className="h-3.5 w-3.5 flex-none fill-current"
                  >
                     <path d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-.46.26l-2.5.66a.5.5 0 0 1-.61-.61l.66-2.5a1 1 0 0 1 .26-.46l7.1-7.1Z" />
                  </svg>
                  <span className="hidden truncate sm:inline">{summary}</span>
                  <span aria-hidden className="ml-auto text-ink-3">
                     ▾
                  </span>
               </button>
            )}
         >
            <div className="flex items-center justify-between gap-2">
               <span className="text-[13px] text-ink-2">Show drafts</span>
               <Segmented
                  ariaLabel="which drafts to show"
                  value={draftsMode}
                  options={[
                     ['mine', 'Mine'],
                     ['all', 'All'],
                  ]}
                  onChange={setDraftsMode}
               />
            </div>
            <p className="mt-2 text-[11px] text-ink-3">
               Your own drafts always show. “All” adds everyone else’s.
            </p>
         </Popover>
      </div>
   );
}
