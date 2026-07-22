import { ChevronDown, Pencil } from 'lucide-react';
import { Segmented } from '../bits';
import { Icon } from '../Icon';
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
                  <Icon icon={Pencil} />
                  <span className="hidden truncate sm:inline">{summary}</span>
                  <Icon icon={ChevronDown} className="ml-auto text-ink-3" />
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
