import { useState } from 'react';
import { ArrowLeft, Bell, Settings as SettingsIcon, X } from 'lucide-react';
import { ago, githubUrl } from '../../../shared/format';
import { type CheerGroup, CONFIGURABLE_TOASTS } from '../model/cheers';
import {
   type Settings as SettingsShape,
   setSettings,
   toggleCheerKind,
   useSettings,
} from '../settings';
import {
   notificationsSupported,
   notifyPermission,
   requestNotifyPermission,
   testNotification,
   unlockSound,
} from '../notifications';
import type { ToastRecord } from '../toasts';
import { QuietButton, Segmented, Switch } from './bits';
import { Icon } from './Icon';
import { onOpen, Popover } from './Popover';
import { Explainer, Field } from './SettingsBits';

/** Tone → medallion tint, matching the toast card's own vocabulary so a nudge
 * reads the same in the panel as it did when it flashed. */
const MEDALLION: Record<ToastRecord['toast']['tone'], string> = {
   reward: 'bg-brand-50 text-brand',
   info: 'bg-brand-50 text-brand',
   nag: 'bg-secondary text-ink-2',
};

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

/**
 * The "Nudge settings" view: everything the Settings panel's old
 * Notifications group held, moved here so notification preferences live
 * behind the bell they govern instead of a separate drawer. Renders through
 * the same Field/Explainer/Segmented primitives Settings.tsx uses, so the
 * controls read identically in both places.
 */
function NudgeSettingsView() {
   const s = useSettings();
   const [perm, setPerm] = useState(notifyPermission());
   const set = (patch: Partial<SettingsShape>) => setSettings(patch);

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

   return (
      <div className="flex flex-col gap-3.5 p-3">
         <Field
            label="Cheers & nudges"
            hint="Rewards when your reviews land, nudges when they pile up. Fires while you’re on the board."
         >
            <SegmentedOnOff value={s.cheers} onChange={cheers => set({ cheers })} />
         </Field>
         <Explainer summary="Choose which cheers & nudges fire">
            <CheerToggles disabled={!s.cheers} />
         </Explainer>
         <Field
            label="How long they stay"
            hint="How long a cheer or nudge lingers before it slides away. Sticky keeps it until you dismiss it."
         >
            <DwellSegmented value={s.cheerDwell} onChange={cheerDwell => set({ cheerDwell })} />
         </Field>
         <Field
            label="Bell badge"
            hint="What the bell shows for nudges that landed since you last opened it: the count, a plain dot, or nothing."
         >
            <BadgeSegmented value={s.notifyBadge} onChange={notifyBadge => set({ notifyBadge })} />
         </Field>
         {notificationsSupported ? (
            <>
               <Field
                  label="Desktop notifications"
                  hint="Nudge you when a PR needs you: yours going mergeable, breaking CI or getting feedback, or a re-review falling to you. Only while this tab isn’t focused."
               >
                  <SegmentedOnOff
                     value={s.notify && perm === 'granted'}
                     onChange={v => void toggleNotify(v)}
                  />
               </Field>
               {perm === 'denied' && (
                  <span className="text-xs text-bad">
                     Blocked in your browser settings; allow notifications for this site to turn
                     them on.
                  </span>
               )}
               <Field label="Sound" hint="Play a short chime with each notification.">
                  <SegmentedOnOff
                     value={s.notifySound}
                     onChange={notifySound => {
                        // a toggle click is the gesture that unlocks audio
                        if (notifySound) unlockSound();
                        set({ notifySound });
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
      </div>
   );
}

// Small typed wrappers around the house Segmented control, so each field
// above stays a one-liner instead of re-spelling its options inline.
function SegmentedOnOff({
   value,
   onChange,
}: {
   value: boolean;
   onChange: (next: boolean) => void;
}) {
   return (
      <Segmented
         ariaLabel="on or off"
         value={value ? 'on' : 'off'}
         options={[
            ['off', 'Off'],
            ['on', 'On'],
         ]}
         onChange={v => onChange(v === 'on')}
      />
   );
}

function DwellSegmented({
   value,
   onChange,
}: {
   value: number | 'sticky';
   onChange: (next: number | 'sticky') => void;
}) {
   return (
      <Segmented
         ariaLabel="how long nudges stay"
         value={String(value)}
         options={[
            ['3000', '3s'],
            ['5000', '5s'],
            ['8000', '8s'],
            ['12000', '12s'],
            ['sticky', 'Sticky'],
         ]}
         onChange={v => onChange(v === 'sticky' ? 'sticky' : Number(v))}
      />
   );
}

function BadgeSegmented({
   value,
   onChange,
}: {
   value: 'count' | 'dot' | 'none';
   onChange: (next: 'count' | 'dot' | 'none') => void;
}) {
   return (
      <Segmented
         ariaLabel="bell badge"
         value={value}
         options={[
            ['count', 'Count'],
            ['dot', 'Dot'],
            ['none', 'Off'],
         ]}
         onChange={onChange}
      />
   );
}

/**
 * The recent-nudges panel: toasts are deliberately non-sticky, so this is
 * where a nudge you missed (or dismissed) stays recoverable — the same list
 * the toast stack fired, newest first, each still linking its PR. A brand dot
 * on the bell counts what's landed since you last opened it. The header row's
 * gear flips this same popover into a "Nudge settings" view (back arrow to
 * return) holding every notification preference, so they live behind the
 * bell they govern instead of a separate Settings drawer.
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
   const [view, setView] = useState<'nudges' | 'settings'>('nudges');
   const unseen = records.filter(r => r.at > lastSeen).length;
   const badge = useSettings().notifyBadge;
   const flag = unseen > 0 && badge !== 'none';

   return (
      <Popover
         label={view === 'settings' ? 'Nudge settings' : 'Recent nudges'}
         side="right"
         width="w-[320px]"
         panelClass={
            view === 'settings'
               ? 'flex max-h-[70vh] flex-col p-0 text-xs'
               : 'max-h-[70vh] overflow-auto p-0 text-xs'
         }
         trigger={t => (
            <button
               {...t}
               type="button"
               aria-label={unseen > 0 ? `recent nudges, ${unseen} new` : 'recent nudges'}
               title="recent nudges"
               // opening marks everything seen and resets back to the nudges
               // list, so the gear detour never leaks into the next open
               onClick={onOpen(t, () => {
                  setLastSeen(Date.now());
                  setView('nudges');
               })}
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
         {view === 'settings' ? (
            <>
               <div className="flex items-center gap-2 border-b border-secondary px-3 py-2">
                  <button
                     type="button"
                     aria-label="back to recent nudges"
                     // stop the click reaching the popover's document-level
                     // click-away listener: swapping this header's contents
                     // unmounts the very button that was clicked, so by the
                     // time that listener runs, e.target is a detached node
                     // and `panelRef.contains(target)` reads false, closing
                     // the popover out from under the view flip
                     onClick={e => {
                        e.stopPropagation();
                        setView('nudges');
                     }}
                     className="pressable -ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:text-ink"
                  >
                     <Icon icon={ArrowLeft} size={14} />
                  </button>
                  <span className="flex-1 text-[13px] font-semibold text-ink">Nudge settings</span>
               </div>
               <div className="min-h-0 flex-1 overflow-y-auto">
                  <NudgeSettingsView />
               </div>
            </>
         ) : (
            <>
               <div className="flex items-center gap-2 border-b border-secondary px-3 py-2">
                  <span className="flex-1 text-[13px] font-semibold text-ink">Recent nudges</span>
                  <button
                     type="button"
                     aria-label="nudge settings"
                     title="nudge settings"
                     // see the matching comment on the back-arrow button: this
                     // click's own re-render removes this exact node from the
                     // header, so it must not reach the popover's click-away
                     // listener on document
                     onClick={e => {
                        e.stopPropagation();
                        setView('settings');
                     }}
                     className="pressable rounded p-1 text-ink-3 hover:text-ink"
                  >
                     <Icon icon={SettingsIcon} size={14} />
                  </button>
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
                                 <span className="truncate font-semibold text-ink">
                                    {r.toast.title}
                                 </span>
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
            </>
         )}
      </Popover>
   );
}
