import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { clearStoredPrefs } from '../storage';
import { clearSnoozes, markAllSeen, refreshAll, usePulldasher } from '../store';
import {
   addCodeRegion,
   removeCodeRegion,
   setLaneCapForLens,
   type Settings as SettingsShape,
   setSettings,
   useSettings,
} from '../settings';
import { QuietButton, Segmented } from './bits';
import { Icon } from './Icon';
import { Explainer, Field, Group, NumberField } from './SettingsBits';

const LENS_OPTIONS: [string, string][] = [
   ['review', 'Review'],
   ['mine', 'My work'],
   ['team', 'Team'],
   ['people', 'People'],
   ['classic', 'Classic'],
   ['ci', 'CI'],
   ['stats', 'Stats'],
];

// Stats has no lanes, so it's left out of the per-lens lane-length list
// (unlike LENS_OPTIONS above, which covers every tab including Stats).
const LANE_CAP_LENS_OPTIONS: [string, string][] = [
   ['review', 'Review'],
   ['mine', 'My work'],
   ['team', 'Team'],
   ['people', 'People'],
   ['classic', 'Classic'],
   ['ci', 'CI'],
];

const LANE_CAP_OPTIONS: [string, string][] = [
   ['default', 'Default'],
   ['10', '10'],
   ['25', '25'],
   ['50', '50'],
   ['0', 'No cap'],
];

/** One lens' lane-length override row, inside the "Different length per view"
 * disclosure. "Default" clears the override so the lens falls back to the
 * global Lane length above. */
function LaneCapByLensRow({ lensId, label }: { lensId: string; label: string }) {
   const cap = useSettings().laneCapByLens[lensId];
   return (
      <div className="flex items-center justify-between gap-2">
         <span className="text-[13px] text-ink-2">{label}</span>
         <Segmented
            ariaLabel={`lane length for ${label}`}
            value={cap == null ? 'default' : String(cap)}
            options={LANE_CAP_OPTIONS}
            onChange={v => setLaneCapForLens(lensId, v === 'default' ? null : Number(v))}
         />
      </div>
   );
}

/** Free-text editor for the code regions that float matching PRs to the top of
 * the review queue. Arbitrary strings (not a known set), so it's a plain input
 * plus removable chips, not a candidate picker. */
function CodeRegionsGroup() {
   const regions = useSettings().codeRegions;
   const [draft, setDraft] = useState('');
   const add = () => {
      addCodeRegion(draft);
      setDraft('');
   };
   return (
      <Group title="Code regions">
         <span className="text-xs text-ink-3">
            Areas you own or care about. A PR whose title, description, labels, branch, or repo
            contains one floats to the top of your review queue.
         </span>
         <div className="flex gap-2">
            <input
               value={draft}
               onChange={e => setDraft(e.target.value)}
               onKeyDown={e => {
                  if (e.key === 'Enter') {
                     e.preventDefault();
                     add();
                  }
               }}
               placeholder="e.g. Growthbook, Shopify, Diagrams"
               aria-label="add a code region"
               className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus-visible:border-brand"
            />
            <QuietButton size="md" onClick={add}>
               Add
            </QuietButton>
         </div>
         {regions.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
               {regions.map(r => (
                  <li key={r}>
                     <span className="chip-in inline-flex items-center gap-1 rounded bg-brand-50 py-0.5 pr-1 pl-2 text-[13px] font-medium text-brand-700">
                        {r}
                        <button
                           type="button"
                           aria-label={`remove code region ${r}`}
                           title="remove"
                           onClick={() => removeCodeRegion(r)}
                           className="hit pressable rounded p-0.5 text-brand-700/60 hover:text-brand-700"
                        >
                           <Icon icon={X} size={12} />
                        </button>
                     </span>
                  </li>
               ))}
            </ul>
         )}
      </Group>
   );
}

export function Settings({
   snoozedCount,
   onGoToTeam,
}: {
   /** pulls currently hidden by a row snooze */
   snoozedCount: number;
   /** switch the board to the Team lens and close this panel — the "Edited
    * on the board" pointer line's action. The team picker and repo manager
    * embeds are gone (Team view and the header's Repos filter own those
    * now), so this is the only cross-surface wiring this panel needs. */
   onGoToTeam: () => void;
}) {
   const [open, setOpen] = useState(false);
   const s = useSettings();
   const { refreshProgress } = usePulldasher();
   const panelRef = useRef<HTMLDivElement>(null);
   const triggerRef = useRef<HTMLButtonElement>(null);
   const [seenNote, setSeenNote] = useState(false);
   const [refreshNote, setRefreshNote] = useState('');
   const [armReset, setArmReset] = useState(false);

   // open on demand — the code-regions tip's "Set them up" action dispatches
   // this so a reader can jump straight here from the board
   useEffect(() => {
      const openIt = () => setOpen(true);
      window.addEventListener('pd2:open-settings', openIt);
      return () => window.removeEventListener('pd2:open-settings', openIt);
   }, []);

   useEffect(() => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => {
         if (e.key === 'Escape') setOpen(false);
         // aria-modal promises a focus trap; without this, Tab walks out of
         // the dialog into the live board behind the scrim
         if (e.key === 'Tab' && panelRef.current) {
            const focusables = panelRef.current.querySelectorAll<HTMLElement>(
               'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
            );
            if (!focusables.length) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && (active === first || active === panelRef.current)) {
               e.preventDefault();
               last.focus();
            } else if (!e.shiftKey && active === last) {
               e.preventDefault();
               first.focus();
            }
         }
      };
      document.addEventListener('keydown', onKey);
      // a modal locks the page behind it: the scrim already blocks clicks,
      // this blocks scroll
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      // focus the panel so Escape and tabbing land inside it
      panelRef.current?.focus();
      return () => {
         document.removeEventListener('keydown', onKey);
         document.body.style.overflow = prevOverflow;
      };
   }, [open]);

   // return focus to the cog when the panel closes
   useEffect(() => {
      if (!open) triggerRef.current?.focus?.();
   }, [open]);

   const set = (patch: Partial<SettingsShape>) => setSettings(patch);

   return (
      <>
         <button
            ref={triggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label="settings"
            title="settings"
            onClick={() => setOpen(o => !o)}
            className="pressable inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:text-brand"
         >
            <Icon icon={SettingsIcon} size={16} />
         </button>
         {open &&
            createPortal(
               <div className="fixed inset-0 z-[100]">
                  <div
                     className="settings-scrim absolute inset-0 bg-black/30"
                     onClick={() => setOpen(false)}
                     aria-hidden
                  />
                  <div
                     ref={panelRef}
                     role="dialog"
                     aria-label="Settings"
                     aria-modal="true"
                     tabIndex={-1}
                     className="settings-panel absolute top-0 right-0 flex h-full w-[min(360px,100vw)] flex-col overflow-y-auto border-l border-line bg-surface shadow-xl outline-none"
                  >
                     {/* z-10: children further down the panel (avatars, star
                         buttons, the code-regions Add button — anything
                         position:relative via .hit/.pressable) paint above a
                         sticky header with no z-index of its own once they
                         scroll under it. The overlay above is already
                         z-[100], so z-10 in here only has to beat panel
                         content. */}
                     <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
                        <span className="text-sm font-semibold text-ink">Settings</span>
                        <button
                           type="button"
                           aria-label="close settings"
                           onClick={() => setOpen(false)}
                           className="pressable inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-muted hover:text-ink"
                        >
                           <Icon icon={X} size={14} />
                        </button>
                     </div>

                     <Group title="Look">
                        <Field label="Theme">
                           <Segmented
                              ariaLabel="theme"
                              value={s.theme}
                              options={[
                                 ['system', 'System'],
                                 ['light', 'Light'],
                                 ['dark', 'Dark'],
                              ]}
                              onChange={theme => set({ theme })}
                           />
                        </Field>
                        <Field
                           label="Density"
                           hint="Compact tightens each row to fit more on screen."
                        >
                           <Segmented
                              ariaLabel="density"
                              value={s.density}
                              options={[
                                 ['comfortable', 'Comfortable'],
                                 ['compact', 'Compact'],
                              ]}
                              onChange={density => set({ density })}
                           />
                        </Field>
                        <Field label="Default view" hint="The tab a bare pulldasher link opens.">
                           <Segmented
                              ariaLabel="default view"
                              value={s.defaultLens}
                              options={LENS_OPTIONS}
                              onChange={defaultLens => set({ defaultLens })}
                           />
                        </Field>
                     </Group>

                     <Group title="Board">
                        <Field
                           label="Lane length"
                           hint="How many rows a lane shows before folding into “+N more”."
                        >
                           <Segmented
                              ariaLabel="lane length"
                              value={String(s.laneCap)}
                              options={[
                                 ['10', '10'],
                                 ['25', '25'],
                                 ['50', '50'],
                                 ['0', 'No cap'],
                              ]}
                              onChange={v => set({ laneCap: Number(v) })}
                           />
                        </Field>
                        <Explainer summary="Different length per view">
                           <span className="block text-ink-2">
                              Classic can show everything while Review stays short.
                           </span>
                           <div className="flex flex-col gap-2 pt-1">
                              {LANE_CAP_LENS_OPTIONS.map(([id, label]) => (
                                 <LaneCapByLensRow key={id} lensId={id} label={label} />
                              ))}
                           </div>
                        </Explainer>
                        <Field
                           label="Age line appears"
                           hint="When the age line appears and waiting starts counting against a pull. This floats it up the review queue, not just draws the line. The heaviest text tier follows automatically, at about 2.5x this."
                        >
                           <NumberField
                              value={s.ageWarnDays}
                              min={1}
                              max={48}
                              suffix="days"
                              onChange={ageWarnDays => set({ ageWarnDays })}
                           />
                        </Field>
                        <Field
                           label="Getting QA is a to-do"
                           hint="For teams that self-review, no separate CR gate means lining up QA is the real stall, so “Find a QA-er” on your own PRs shows in Waiting on you. Off keeps it in My work only."
                        >
                           <Segmented
                              ariaLabel="getting QA is a to-do"
                              value={s.selfReview ? 'on' : 'off'}
                              options={[
                                 ['off', 'Off'],
                                 ['on', 'On'],
                              ]}
                              onChange={v => set({ selfReview: v === 'on' })}
                           />
                        </Field>
                        <Field
                           label="Nudge me about a claim"
                           hint="When an unfinished claim of yours starts nagging you to finish it or hand it back. Claims themselves don't expire on a timer; they clear when the review is submitted, released, or removed on GitHub."
                        >
                           <Segmented
                              ariaLabel="claim warning time"
                              value={String(s.claimWarnMins)}
                              options={[
                                 ['30', '30m'],
                                 ['60', '1h'],
                                 ['120', '2h'],
                                 ['240', '4h'],
                              ]}
                              onChange={v => set({ claimWarnMins: Number(v) })}
                           />
                        </Field>
                        <Field
                           label="Open a PR in"
                           hint="Clicking a card opens the PR. A new tab keeps the board here behind you."
                        >
                           <Segmented
                              ariaLabel="open a PR in"
                              value={s.openPrsNewTab ? 'new' : 'same'}
                              options={[
                                 ['same', 'This tab'],
                                 ['new', 'New tab'],
                              ]}
                              onChange={v => set({ openPrsNewTab: v === 'new' })}
                           />
                        </Field>
                        <Field
                           label="Hover delay"
                           hint="How long the cursor rests on a card's tooltips (state, sign-off, CI, age) before they open. Off opens them instantly; a click always does."
                        >
                           <Segmented
                              ariaLabel="hover tooltip delay"
                              value={String(s.hoverDelayMs)}
                              options={[
                                 ['0', 'Off'],
                                 ['150', '150ms'],
                                 ['250', '250ms'],
                                 ['500', '500ms'],
                              ]}
                              onChange={v => set({ hoverDelayMs: Number(v) })}
                           />
                        </Field>
                     </Group>

                     <CodeRegionsGroup />

                     <Group title="Edited on the board">
                        <div className="flex items-center justify-between gap-3">
                           <span className="text-[13px] text-ink-2">
                              Your team: edit it on the Team view.
                           </span>
                           <QuietButton
                              size="md"
                              onClick={() => {
                                 onGoToTeam();
                                 setOpen(false);
                              }}
                           >
                              Open Team view
                           </QuietButton>
                        </div>
                        <span className="text-[13px] text-ink-2">
                           Repos: star and mute from the Repos filter in the header.
                        </span>
                     </Group>

                     <section className="border-t border-secondary px-4 py-3.5">
                        <Explainer summary="Advanced">
                           <span className="block text-ink-2">
                              Re-fetch every open PR from GitHub now, instead of waiting for the
                              next webhook. The board updates as each one comes back.
                           </span>
                           <div className="flex items-center gap-3 pt-1">
                              <QuietButton
                                 size="md"
                                 disabled={!!refreshProgress}
                                 onClick={() => {
                                    // live progress (store.refreshProgress) takes over
                                    // from here; the local note only covers the no-op
                                    if (refreshAll() === 0) {
                                       setRefreshNote('nothing to refresh');
                                       setTimeout(() => setRefreshNote(''), 2500);
                                    }
                                 }}
                              >
                                 Refresh all
                              </QuietButton>
                              {/* role=status stays mounted so the announcement fires
                                  when the text lands — a screen reader hears the
                                  confirmation, not just sighted users */}
                              <span role="status" className="text-xs text-ink-3 tabular-nums">
                                 {refreshProgress
                                    ? refreshProgress.done === refreshProgress.total
                                       ? `refreshed ${refreshProgress.total}`
                                       : `refreshing ${refreshProgress.done} of ${refreshProgress.total}…`
                                    : refreshNote}
                              </span>
                           </div>

                           <span className="mt-2 block text-ink-2">
                              A snoozed row hides for a day, or until the PR changes.
                           </span>
                           <div className="flex items-center gap-3 pt-1">
                              <QuietButton
                                 size="md"
                                 disabled={!snoozedCount}
                                 onClick={() => clearSnoozes()}
                              >
                                 Bring back snoozed
                              </QuietButton>
                              <span className="text-xs text-ink-3 tabular-nums">
                                 {snoozedCount} hidden now
                              </span>
                           </div>

                           <div className="pt-2">
                              <Field
                                 label="Mark the board seen after"
                                 hint="How long it must stay open, in view, before leaving counts as a look. A quick glance won’t clear the new-and-updated marks."
                              >
                                 <NumberField
                                    value={s.seenAfterSecs}
                                    min={0}
                                    max={600}
                                    suffix="sec"
                                    onChange={seenAfterSecs => set({ seenAfterSecs })}
                                 />
                              </Field>
                           </div>
                           <div className="flex items-center gap-3 pt-1">
                              <QuietButton
                                 size="md"
                                 onClick={() => {
                                    markAllSeen();
                                    setSeenNote(true);
                                    setTimeout(() => setSeenNote(false), 1600);
                                 }}
                              >
                                 Mark everything as seen
                              </QuietButton>
                              <span
                                 role="status"
                                 className="text-xs"
                                 style={{ color: 'var(--ok)' }}
                              >
                                 {seenNote ? 'done' : ''}
                              </span>
                           </div>

                           <span className="mt-2 block text-ink-2">
                              Reset every preference on this browser (theme, filters, muted repos,
                              last-seen marker) back to defaults. This can’t be undone.
                           </span>
                           <div className="flex items-center gap-3 pt-1">
                              <button
                                 type="button"
                                 onClick={() => {
                                    if (!armReset) {
                                       setArmReset(true);
                                       setTimeout(() => setArmReset(false), 4000);
                                       return;
                                    }
                                    clearStoredPrefs();
                                    window.location.reload();
                                 }}
                                 className={`pressable inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-medium ${
                                    armReset
                                       ? 'border-bad bg-bad/10 text-bad hover:bg-bad/20'
                                       : 'border-line bg-surface text-ink-2 hover:text-bad'
                                 }`}
                              >
                                 {armReset ? 'Click again to confirm' : 'Clear settings'}
                              </button>
                           </div>
                        </Explainer>
                     </section>
                  </div>
               </div>,
               document.body
            )}
      </>
   );
}
