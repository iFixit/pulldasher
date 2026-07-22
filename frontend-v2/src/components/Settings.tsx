import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clearStoredPrefs } from '../storage';
import {
   notificationsSupported,
   notifyPermission,
   requestNotifyPermission,
   testNotification,
   unlockSound,
} from '../notifications';
import { type CheerGroup, CONFIGURABLE_TOASTS } from '../model/cheers';
import { clearSnoozes, markAllSeen, refreshAll, usePulldasher } from '../store';
import {
   addCodeRegion,
   removeCodeRegion,
   type Settings as SettingsShape,
   setRepoPref,
   setSettings,
   toggleCheerKind,
   togglePrimaryRepo,
   useSettings,
} from '../settings';
import { QuietButton, Segmented, Switch } from './bits';
import { RepoManagerGroup } from './RepoManager';
import { TeamPickerGroup } from './TeamPicker';

const LENS_OPTIONS: [string, string][] = [
   ['review', 'Review'],
   ['mine', 'My work'],
   ['team', 'Team'],
   ['people', 'People'],
   ['classic', 'Classic'],
   ['ci', 'CI'],
   ['stats', 'Stats'],
];

/** A labelled group of controls inside the panel. */
function Group({ title, children }: { title: string; children: ReactNode }) {
   return (
      <section className="border-t border-secondary px-4 py-3.5 first:border-t-0">
         <h3 className="m-0 mb-2.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            {title}
         </h3>
         <div className="flex flex-col gap-3.5">{children}</div>
      </section>
   );
}

/** A collapsible "how it works" note, mirroring the legend's disclosures so the
 * explanation reads the same wherever it appears. Closed by default: it's there
 * when you go looking, not in the way when you aren't. */
function Explainer({ summary, children }: { summary: string; children: ReactNode }) {
   return (
      <details className="group/exp -mt-1">
         <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 text-xs font-medium text-ink-3 hover:text-ink-2">
            <span aria-hidden className="transition-transform group-open/exp:rotate-90">
               ▸
            </span>
            {summary}
         </summary>
         <div className="space-y-1.5 pt-1 pb-0.5 pl-3 text-xs text-ink-2">{children}</div>
      </details>
   );
}

const CHEER_GROUPS: { group: CheerGroup; title: string }[] = [
   { group: 'reward', title: 'Rewards' },
   { group: 'nudge', title: 'Nudges' },
   { group: 'author', title: 'Your PRs' },
];

/** The per-kind list: every cheer/nudge, grouped, each a one-line explanation
 * with its own switch. The master "Cheers & nudges" toggle still gates the
 * whole system; these pick which kinds fire when it's on, so they read as
 * disabled while it's off. */
function CheerToggles({ disabled }: { disabled: boolean }) {
   const muted = new Set(useSettings().mutedCheers);
   return (
      <div className="flex flex-col gap-3">
         {CHEER_GROUPS.map(({ group, title }) => (
            <div key={group} className="flex flex-col gap-2">
               <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                  {title}
               </span>
               {CONFIGURABLE_TOASTS.filter(c => c.group === group).map(c => (
                  <div key={c.kind} className="flex items-start gap-2.5">
                     <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-ink">{c.label}</span>
                        <span className="block text-xs text-ink-3">{c.hint}</span>
                     </span>
                     <Switch
                        checked={!muted.has(c.kind)}
                        disabled={disabled}
                        ariaLabel={c.label}
                        onChange={next => toggleCheerKind(c.kind, next)}
                     />
                  </div>
               ))}
            </div>
         ))}
      </div>
   );
}

/** One setting: a label (+ optional hint) over its control. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
   return (
      <div className="flex flex-col gap-1.5">
         <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">{label}</span>
            {children}
         </div>
         {hint && <span className="text-xs text-ink-3">{hint}</span>}
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
                           <svg
                              viewBox="0 0 16 16"
                              className="h-3 w-3"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                           >
                              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                           </svg>
                        </button>
                     </span>
                  </li>
               ))}
            </ul>
         )}
      </Group>
   );
}

/** A small bounded number stepper (days, seconds). */
function NumberField({
   value,
   min,
   max,
   suffix,
   onChange,
}: {
   value: number;
   min: number;
   max: number;
   suffix: string;
   onChange: (next: number) => void;
}) {
   return (
      <span className="inline-flex items-center gap-1.5">
         <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={e => {
               const n = Number(e.target.value);
               if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
            }}
            className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-right text-[13px] tabular-nums"
         />
         <span className="text-xs text-ink-3">{suffix}</span>
      </span>
   );
}

export function Settings({
   repos,
   orgHidden,
   snoozedCount,
   extraBots,
}: {
   /** every known repo with its open-PR count, for the repo manager */
   repos: { name: string; count: number }[];
   orgHidden: ReadonlySet<string>;
   /** pulls currently hidden by a row snooze */
   snoozedCount: number;
   /** config.json's named bots, so the team picker's suggestions leave them out */
   extraBots: ReadonlySet<string>;
}) {
   const [open, setOpen] = useState(false);
   const s = useSettings();
   const { refreshProgress } = usePulldasher();
   const panelRef = useRef<HTMLDivElement>(null);
   const triggerRef = useRef<HTMLButtonElement>(null);
   const [seenNote, setSeenNote] = useState(false);
   const [refreshNote, setRefreshNote] = useState('');
   const [armReset, setArmReset] = useState(false);
   const [perm, setPerm] = useState(notifyPermission());

   const toggleNotify = async (on: boolean) => {
      if (!on) {
         setSettings({ notify: false });
         return;
      }
      let p = notifyPermission();
      if (p === 'default') p = await requestNotifyPermission();
      setPerm(p);
      // this handler runs from the toggle click, so unlock audio now while we
      // still have the gesture, in case Sound is already on
      if (p === 'granted') unlockSound();
      setSettings({ notify: p === 'granted' });
   };

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
            <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 fill-current">
               <path d="M11.5 1.5a.6.6 0 0 1 .59.49l.24 1.42a6.6 6.6 0 0 1 1.36.79l1.34-.53a.6.6 0 0 1 .74.27l1.5 2.6a.6.6 0 0 1-.15.76l-1.11.9c.05.26.07.53.07.8s-.02.54-.07.8l1.11.9a.6.6 0 0 1 .15.76l-1.5 2.6a.6.6 0 0 1-.74.27l-1.34-.53c-.42.33-.88.6-1.36.79l-.24 1.42a.6.6 0 0 1-.59.49h-3a.6.6 0 0 1-.59-.49l-.24-1.42a6.6 6.6 0 0 1-1.36-.79l-1.34.53a.6.6 0 0 1-.74-.27l-1.5-2.6a.6.6 0 0 1 .15-.76l1.11-.9a6.7 6.7 0 0 1 0-1.6l-1.11-.9a.6.6 0 0 1-.15-.76l1.5-2.6a.6.6 0 0 1 .74-.27l1.34.53c.42-.33.88-.6 1.36-.79l.24-1.42a.6.6 0 0 1 .59-.49h3ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
            </svg>
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
                     <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
                        <span className="text-sm font-semibold text-ink">Settings</span>
                        <button
                           type="button"
                           aria-label="close settings"
                           onClick={() => setOpen(false)}
                           className="pressable inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-muted hover:text-ink"
                        >
                           ✕
                        </button>
                     </div>

                     <Group title="Appearance">
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
                     </Group>

                     <Group title="Board">
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
                        <Field label="Default view" hint="The tab a bare pulldasher link opens.">
                           <Segmented
                              ariaLabel="default view"
                              value={s.defaultLens}
                              options={LENS_OPTIONS}
                              onChange={defaultLens => set({ defaultLens })}
                           />
                        </Field>
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
                        <Field
                           label="Age line appears"
                           hint="When the age line appears and waiting starts counting against a pull. This floats it up the review queue, not just draws the line."
                        >
                           <NumberField
                              value={s.ageWarnDays}
                              min={1}
                              max={s.ageRotDays - 1}
                              suffix="days"
                              onChange={ageWarnDays => set({ ageWarnDays })}
                           />
                        </Field>
                        <Field
                           label="Age counts as rotting"
                           hint="Bolds the day count at its heaviest and sets the rot tier in stats. The age line itself scales to the board's oldest pull."
                        >
                           <NumberField
                              value={s.ageRotDays}
                              min={s.ageWarnDays + 1}
                              max={120}
                              suffix="days"
                              onChange={ageRotDays => set({ ageRotDays })}
                           />
                        </Field>
                        <Field
                           label="Claim length"
                           hint="How long your review claims hold before they expire on their own."
                        >
                           <Segmented
                              ariaLabel="claim length"
                              value={String(s.claimLengthMins)}
                              options={[
                                 ['60', '1h'],
                                 ['120', '2h'],
                                 ['240', '4h'],
                                 ['480', '8h'],
                              ]}
                              onChange={v => set({ claimLengthMins: Number(v) })}
                           />
                        </Field>
                        <Field
                           label="Nudge me about a claim"
                           hint="When an unfinished claim of yours starts nagging you to finish it or hand it back."
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
                           label="Other people’s drafts"
                           hint="Your own drafts always show. This is the default; a session can override it."
                        >
                           <Segmented
                              ariaLabel="drafts default"
                              value={s.draftsMode}
                              options={[
                                 ['mine', 'Hide'],
                                 ['all', 'Show'],
                              ]}
                              onChange={draftsMode => set({ draftsMode })}
                           />
                        </Field>
                        <Field label="Parked (Cryogenic) PRs">
                           <Segmented
                              ariaLabel="cryo default"
                              value={s.showCryo ? 'show' : 'hide'}
                              options={[
                                 ['hide', 'Hide'],
                                 ['show', 'Show'],
                              ]}
                              onChange={v => set({ showCryo: v === 'show' })}
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

                     <TeamPickerGroup extraBots={extraBots} />

                     <CodeRegionsGroup />

                     <Group title="Notifications">
                        <Field
                           label="Cheers & nudges"
                           hint="Rewards when your reviews land, nudges when they pile up. Fires while you’re on the board."
                        >
                           <Segmented
                              ariaLabel="cheers and nudges"
                              value={s.cheers ? 'on' : 'off'}
                              options={[
                                 ['off', 'Off'],
                                 ['on', 'On'],
                              ]}
                              onChange={v => set({ cheers: v === 'on' })}
                           />
                        </Field>
                        <Explainer summary="Choose which cheers & nudges fire">
                           <CheerToggles disabled={!s.cheers} />
                        </Explainer>
                        <Field
                           label="How long they stay"
                           hint="How long a cheer or nudge lingers before it slides away. Sticky keeps it until you dismiss it."
                        >
                           <Segmented
                              ariaLabel="how long nudges stay"
                              value={String(s.cheerDwell)}
                              options={[
                                 ['3000', '3s'],
                                 ['5000', '5s'],
                                 ['8000', '8s'],
                                 ['12000', '12s'],
                                 ['sticky', 'Sticky'],
                              ]}
                              onChange={v =>
                                 set({ cheerDwell: v === 'sticky' ? 'sticky' : Number(v) })
                              }
                           />
                        </Field>
                        <Field
                           label="Bell badge"
                           hint="What the bell shows for nudges that landed since you last opened it: the count, a plain dot, or nothing."
                        >
                           <Segmented
                              ariaLabel="bell badge"
                              value={s.notifyBadge}
                              options={[
                                 ['count', 'Count'],
                                 ['dot', 'Dot'],
                                 ['none', 'Off'],
                              ]}
                              onChange={notifyBadge => set({ notifyBadge })}
                           />
                        </Field>
                        {notificationsSupported ? (
                           <>
                              <Field
                                 label="Desktop notifications"
                                 hint="Nudge you when a PR needs you: yours going mergeable, breaking CI or getting feedback, or a re-review falling to you. Only while this tab isn’t focused."
                              >
                                 <Segmented
                                    ariaLabel="desktop notifications"
                                    value={s.notify && perm === 'granted' ? 'on' : 'off'}
                                    options={[
                                       ['off', 'Off'],
                                       ['on', 'On'],
                                    ]}
                                    onChange={v => void toggleNotify(v === 'on')}
                                 />
                              </Field>
                              {perm === 'denied' && (
                                 <span className="text-xs text-bad">
                                    Blocked in your browser settings; allow notifications for this
                                    site to turn them on.
                                 </span>
                              )}
                              <Field
                                 label="Sound"
                                 hint="Play a short chime with each notification."
                              >
                                 <Segmented
                                    ariaLabel="notification sound"
                                    value={s.notifySound ? 'on' : 'off'}
                                    options={[
                                       ['off', 'Off'],
                                       ['on', 'On'],
                                    ]}
                                    onChange={v => {
                                       // a toggle click is the gesture that unlocks audio
                                       if (v === 'on') unlockSound();
                                       set({ notifySound: v === 'on' });
                                    }}
                                 />
                              </Field>
                              {s.notify && perm === 'granted' && (
                                 <QuietButton size="md" onClick={() => testNotification()}>
                                    Send a test notification
                                 </QuietButton>
                              )}
                           </>
                        ) : (
                           <span className="text-xs text-ink-3">
                              This browser doesn’t support desktop notifications.
                           </span>
                        )}
                     </Group>

                     <RepoManagerGroup
                        repos={repos}
                        orgHidden={orgHidden}
                        prefs={s.repoPrefs}
                        onRepoPref={setRepoPref}
                        primaryRepos={s.primaryRepos}
                        onPrimary={togglePrimaryRepo}
                     />

                     <Group title="Data">
                        <span className="text-xs text-ink-3">
                           Re-fetch every open PR from GitHub now, instead of waiting for the next
                           webhook. The board updates as each one comes back.
                        </span>
                        <div className="flex items-center gap-3">
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

                        <span className="mt-1 text-xs text-ink-3">
                           A snoozed row hides for a day, or until the PR changes.
                        </span>
                        <div className="flex items-center gap-3">
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

                        <span className="mt-1 text-xs text-ink-3">
                           Reset every preference on this browser (theme, filters, muted repos,
                           last-seen marker) back to defaults. This can’t be undone.
                        </span>
                        <div className="flex items-center gap-3">
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
                     </Group>

                     <Group title="Changed since your last look">
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
                        <div className="flex items-center gap-3">
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
                           <span role="status" className="text-xs" style={{ color: 'var(--ok)' }}>
                              {seenNote ? 'done' : ''}
                           </span>
                        </div>
                     </Group>
                  </div>
               </div>,
               document.body
            )}
      </>
   );
}
