import { CRYO_KEY } from '../../../../shared/model/visibility';
import { setSettings, useSettings } from '../../settings';
import { QuietButton } from '../bits';
import { Popover } from '../Popover';
import { CheckboxField, FilterTrigger } from './shared';

/** Per-category sizes of everything the board hides by default — computed in
 * app.tsx beside the visibility filter itself so the two can't drift. */
interface HiddenCounts {
   /** PRs labeled Cryogenic Storage */
   parked: number;
   /** other people's drafts (yours always show) */
   drafts: number;
   /** PRs in repos you hid */
   hiddenRepos: number;
   /** PRs by people you hid */
   hiddenPeople: number;
   /** bot PRs on the board (the pool "Ignore bot PRs" would hide) */
   bots: number;
   /** PRs currently off the board, after session reveals */
   hiddenNow: number;
}

/**
 * The board's hidden-PR ledger: one quiet door at the end of the filter bar
 * that always says how many open PRs you are NOT seeing, and opens into the
 * why — parked, drafts, hidden repos and people — each with its count. The two
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
      counts.parked + counts.drafts + counts.hiddenRepos + counts.hiddenPeople > 0;
   // the bot toggle keeps the door reachable even when nothing else is hidden:
   // it's the one durable "hide a whole category" control that lives here
   if (!anythingHidden && !revealing && !counts.bots && !settings.hideBots) return null;

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
         <CheckboxField
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
            ariaLabel={label}
            className="flex items-center gap-2"
            textClassName="flex-1 text-[13px]"
            count={count}
         >
            {label}
         </CheckboxField>
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
               <FilterTrigger
                  t={t}
                  label="Hidden"
                  // standing info, not a narrowing you chose — the quiet tone.
                  // While revealing, the count falls as PRs surface and the
                  // brand text carries the "showing them for now" state.
                  badge={counts.hiddenNow ? String(counts.hiddenNow) : null}
                  badgeTone="quiet"
                  active={revealing}
                  title={
                     revealing
                        ? 'showing hidden PRs for now: what the board normally hides, and why'
                        : 'what the board is hiding, and why'
                  }
                  ariaLabel={
                     revealing
                        ? 'hidden PRs: showing them for now'
                        : `hidden PRs: ${counts.hiddenNow} off the board`
                  }
               />
            )}
         >
            {counts.parked > 0 &&
               toggleRow(
                  'parked',
                  'Show parked PRs',
                  counts.parked,
                  parkedShown,
                  settings.showCryo || showAll,
                  () => toggleReveal(CRYO_KEY),
                  'PRs labeled Cryogenic Storage: long-running work, set aside on purpose. Check the box to show them for this session.',
                  !settings.showCryo && reveal.includes(CRYO_KEY)
                     ? () => setSettings({ showCryo: true })
                     : undefined
               )}
            {counts.drafts > 0 &&
               toggleRow(
                  'drafts',
                  'Show drafts by others',
                  counts.drafts,
                  draftsShown,
                  showAll,
                  () => setDraftsMode(draftsMode === 'all' ? 'mine' : 'all'),
                  'Check the box to show other people’s drafts too; your own drafts always show.',
                  draftsMode !== settings.draftsMode ? () => setSettings({ draftsMode }) : undefined
               )}
            {counts.hiddenRepos > 0 &&
               infoRow(
                  'hidden-repos',
                  'In repos you hid',
                  counts.hiddenRepos,
                  'Show them again from the Repos filter.'
               )}
            {counts.hiddenPeople > 0 &&
               infoRow(
                  'hidden-people',
                  'By people you hid',
                  counts.hiddenPeople,
                  'Show them again from the People filter.'
               )}
            {(counts.bots > 0 || settings.hideBots) && (
               <div className="mt-1.5 border-t border-secondary px-1.5 pt-2 pb-1">
                  <CheckboxField
                     checked={settings.hideBots}
                     onChange={() => setSettings({ hideBots: !settings.hideBots })}
                     ariaLabel="Ignore bot PRs"
                     className="flex items-center gap-2"
                     textClassName="flex-1 text-[13px]"
                     count={settings.hideBots ? undefined : counts.bots || undefined}
                  >
                     Ignore bot PRs
                  </CheckboxField>
                  <p className="mt-0.5 pl-[22px] text-[11px] leading-snug text-ink-3">
                     Keep dependency-bump and other bot PRs off the board for good. A saved
                     preference; the Show everything toggle still reveals them.
                  </p>
               </div>
            )}
            <div className="mt-1.5 border-t border-secondary px-1.5 pt-2 pb-1">
               <CheckboxField
                  checked={showAll}
                  onChange={() => setShowAll(!showAll)}
                  ariaLabel="Show everything for now"
                  className="flex items-center gap-2"
                  textClassName="text-[13px]"
               >
                  Show everything for now
               </CheckboxField>
            </div>
            {/* the one-click undo for every session reveal lives in the
                panel now — a bar-level × that came and went moved the bar */}
            {revealing && (
               <div className="mt-1.5 border-t border-secondary pt-1.5">
                  <QuietButton onClick={resetReveals}>Hide them again</QuietButton>
               </div>
            )}
         </Popover>
      </span>
   );
}
