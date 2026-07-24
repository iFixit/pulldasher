import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings as SettingsIcon, Trash2, X } from 'lucide-react';
import { clearStoredPrefs } from '../storage';
import { refreshAll, usePulldasher } from '../store';
import {
   addCodeRegion,
   removeCodeRegion,
   setLaneCapForLens,
   type Settings as SettingsShape,
   setSettings,
   useSettings,
} from '../settings';
import { LENS_LABELS, type Lens } from '../lens';
import { HeaderIconButton, QuietButton, Segmented } from './bits';
import { Icon } from './Icon';
import { Explainer, Field, Group, NumberField } from './SettingsBits';
import { useArmedConfirm } from './useArmedConfirm';
import { commitKeyHandler } from './useCommitOnEnter';

const LENS_OPTIONS: [string, string][] = Object.entries(LENS_LABELS);

// Stats has no lanes, so it's left out of the per-lens lane-length list
// (unlike LENS_OPTIONS above, which covers every tab including Stats) — the
// membership stays its own explicit list, but each label still comes from
// the shared map so it can't drift from LENS_OPTIONS' wording.
const LANE_CAP_LENSES: Lens[] = ['review', 'mine', 'team', 'classic', 'ci'];
const LANE_CAP_LENS_OPTIONS: [string, string][] = LANE_CAP_LENSES.map(id => [id, LENS_LABELS[id]]);

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
      <Field label={label}>
         <Segmented
            ariaLabel={`lane length for ${label}`}
            value={cap == null ? 'default' : String(cap)}
            options={LANE_CAP_OPTIONS}
            onChange={v => setLaneCapForLens(lensId, v === 'default' ? null : Number(v))}
         />
      </Field>
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
               onKeyDown={commitKeyHandler({ onCommit: add, onCancel: () => setDraft('') })}
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
                           aria-label={`delete code region ${r}`}
                           title="delete"
                           onClick={() => removeCodeRegion(r)}
                           className="hit pressable rounded p-0.5 text-brand-700/60 hover:text-brand-700"
                        >
                           <Icon icon={Trash2} size={12} />
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
   onGoToTeam,
}: {
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
   const [refreshNote, setRefreshNote] = useState('');
   const { armed: armReset, run: runReset } = useArmedConfirm();

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
         <HeaderIconButton
            ref={triggerRef}
            aria-haspopup="dialog"
            aria-expanded={open}
            icon={SettingsIcon}
            label="settings"
            onClick={() => setOpen(o => !o)}
         />
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
                     {/* z-10: children further down the panel (avatars, the
                         code-regions Add button — anything position:relative
                         via .hit/.pressable) paint above a sticky header with
                         no z-index of its own once they scroll under it. The
                         overlay above is already z-[100], so z-10 in here
                         only has to beat panel content. */}
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
                           label="Repo cap in the queue"
                           hint="Rows each repo shows in the review queue before folding into “+N more”: one busy repo can’t take the whole screen. Reorder the repos themselves by dragging in the Repos filter."
                        >
                           <Segmented
                              ariaLabel="rows per repo before folding"
                              value={String(s.repoQueueCap)}
                              options={[
                                 ['15', '15'],
                                 ['30', '30'],
                                 ['50', '50'],
                                 ['0', 'No cap'],
                              ]}
                              onChange={v => set({ repoQueueCap: Number(v) })}
                           />
                        </Field>
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
                           label="Age number shows"
                           hint="Which clock the quiet number at a row’s right edge reads: days since the PR opened, or days since its last update. Hover the number for both."
                        >
                           <Segmented
                              ariaLabel="which clock the age number shows"
                              value={s.ageDisplay}
                              options={[
                                 ['opened', 'Opened'],
                                 ['updated', 'Last update'],
                              ]}
                              onChange={ageDisplay => set({ ageDisplay })}
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
                              Teams: build your rosters on the Team view.
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
                           Repos: hide and reveal from the Repos filter in the header.
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
                              Reset every preference on this browser (theme, filters, hidden repos
                              and people, last-seen marker) back to defaults. This can’t be undone.
                           </span>
                           <div className="flex items-center gap-3 pt-1">
                              <button
                                 type="button"
                                 onClick={() =>
                                    runReset(() => {
                                       clearStoredPrefs();
                                       window.location.reload();
                                    })
                                 }
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
