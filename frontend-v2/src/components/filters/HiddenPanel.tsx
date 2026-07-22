import { ChevronDown, X } from 'lucide-react';
import { CRYO_KEY } from '../../model/visibility';
import { setSettings, useSettings } from '../../settings';
import { QuietButton } from '../bits';
import { Icon } from '../Icon';
import { Popover } from '../Popover';

/** Per-category sizes of everything the board hides by default — computed in
 * app.tsx beside the visibility filter itself so the two can't drift. */
export interface HiddenCounts {
   /** PRs labeled Cryogenic Storage */
   parked: number;
   /** other people's drafts (yours always show) */
   drafts: number;
   /** PRs in repos you muted or the org hides by default */
   mutedRepos: number;
   /** PRs by people you muted */
   mutedPeople: number;
   /** PRs currently off the board, after session reveals */
   hiddenNow: number;
}

/**
 * The board's hidden-PR ledger: one quiet door at the end of the filter bar
 * that always says how many open PRs you are NOT seeing, and opens into the
 * why — parked, drafts, muted, snoozed — each with its count. The two
 * categories with clean session toggles (parked, drafts) toggle right here;
 * the durable ones say where their controls live instead of duplicating
 * them. Replaces the parked-PRs checkbox that hid at the bottom of the Repos
 * popover: what the board withholds is board-level information, not a repo
 * setting, and a count you can always see is what makes hiding trustworthy.
 */
export function HiddenPanel({
   counts,
   showAll,
   setShowAll,
   reveal,
   toggleReveal,
   draftsMode,
   setDraftsMode,
}: {
   counts: HiddenCounts;
   showAll: boolean;
   setShowAll: (next: boolean) => void;
   reveal: string[];
   toggleReveal: (key: string) => void;
   draftsMode: 'mine' | 'all';
   setDraftsMode: (m: 'mine' | 'all') => void;
}) {
   const settings = useSettings();
   const parkedShown = settings.showCryo || reveal.includes(CRYO_KEY) || showAll;
   const draftsShown = draftsMode === 'all' || showAll;
   // session reveals in effect — the trigger flips to "showing hidden ×" so
   // the undo is one click, mirroring how an active filter clears
   const revealing = showAll || reveal.length > 0 || draftsMode !== settings.draftsMode;
   const anythingHidden =
      counts.parked + counts.drafts + counts.mutedRepos + counts.mutedPeople > 0;
   if (!anythingHidden && !revealing) return null;

   const resetReveals = () => {
      setShowAll(false);
      for (const k of reveal) toggleReveal(k);
      setDraftsMode(settings.draftsMode);
   };

   const toggleRow = (
      key: string,
      label: string,
      count: number,
      checked: boolean,
      disabled: boolean,
      onToggle: () => void,
      gloss: string,
      makeDefault?: () => void
   ) => (
      <div key={key} className="px-1.5 py-1">
         <label className="flex items-center gap-2">
            <input
               type="checkbox"
               className="m-0 disabled:opacity-40"
               checked={checked}
               disabled={disabled}
               onChange={onToggle}
            />
            <span className="flex-1 text-[13px]">{label}</span>
            <span className="text-[11px] text-ink-3 tabular-nums">{count}</span>
         </label>
         <p className="mt-0.5 pl-[22px] text-[11px] leading-snug text-ink-3">{gloss}</p>
         {makeDefault && (
            <div className="mt-1 pl-[22px]">
               <QuietButton size="sm" onClick={makeDefault}>
                  Make this my default
               </QuietButton>
            </div>
         )}
      </div>
   );

   const infoRow = (key: string, label: string, count: number, hint: string) => (
      <div key={key} className="px-1.5 py-1">
         <div className="flex items-center gap-2 pl-[22px]">
            <span className="flex-1 text-[13px] text-ink-2">{label}</span>
            <span className="text-[11px] text-ink-3 tabular-nums">{count}</span>
         </div>
         <p className="mt-0.5 pl-[22px] text-[11px] leading-snug text-ink-3">{hint}</p>
      </div>
   );

   return (
      <span className="inline-flex items-center">
         <Popover
            label="Hidden PRs"
            width="w-[280px]"
            panelClass="p-2"
            rootClass="relative inline-flex items-center"
            trigger={t => (
               <button
                  {...t}
                  type="button"
                  title="what the board is hiding, and why"
                  aria-label={
                     revealing
                        ? 'hidden PRs: showing them for now'
                        : `hidden PRs: ${counts.hiddenNow} off the board`
                  }
                  className="hit pressable inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-ink-3 hover:text-ink"
               >
                  {revealing ? (
                     <span className="font-medium text-ink">showing hidden</span>
                  ) : (
                     <span className="tabular-nums">{counts.hiddenNow} hidden</span>
                  )}
                  <Icon icon={ChevronDown} size={12} className="flex-none" />
               </button>
            )}
         >
            {counts.parked > 0 &&
               toggleRow(
                  'parked',
                  'Parked PRs',
                  counts.parked,
                  parkedShown,
                  settings.showCryo || showAll,
                  () => toggleReveal(CRYO_KEY),
                  'Labeled Cryogenic Storage: long-running work, set aside on purpose.',
                  !settings.showCryo && reveal.includes(CRYO_KEY)
                     ? () => setSettings({ showCryo: true })
                     : undefined
               )}
            {counts.drafts > 0 &&
               toggleRow(
                  'drafts',
                  'Drafts by others',
                  counts.drafts,
                  draftsShown,
                  showAll,
                  () => setDraftsMode(draftsMode === 'all' ? 'mine' : 'all'),
                  'Your own drafts always show.',
                  draftsMode !== settings.draftsMode ? () => setSettings({ draftsMode }) : undefined
               )}
            {counts.mutedRepos > 0 &&
               infoRow(
                  'muted-repos',
                  'In repos you muted',
                  counts.mutedRepos,
                  'Show or unmute them under Repos.'
               )}
            {counts.mutedPeople > 0 &&
               infoRow(
                  'muted-people',
                  'By people you muted',
                  counts.mutedPeople,
                  'Unmute them under People.'
               )}
            <div className="mt-1.5 border-t border-secondary px-1.5 pt-2 pb-1">
               <label className="flex items-center gap-2">
                  <input
                     type="checkbox"
                     className="m-0"
                     checked={showAll}
                     onChange={() => setShowAll(!showAll)}
                  />
                  <span className="text-[13px]">Show everything for now</span>
               </label>
            </div>
         </Popover>
         {revealing && (
            <button
               type="button"
               onClick={resetReveals}
               aria-label="hide them again"
               title="hide them again"
               className="hit pressable -ml-0.5 rounded px-0.5 text-ink-3 hover:text-brand"
            >
               <Icon icon={X} size={12} />
            </button>
         )}
      </span>
   );
}
