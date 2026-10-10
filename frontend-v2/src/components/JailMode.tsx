import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock } from 'lucide-react';
import type { DerivedPull } from '../../../shared/model/status';
import { githubUrl } from '../../../shared/format';
import { rowNote, rowWord } from '../model/actions';
import { STAGE_WORDS } from '../model/stage';
import {
   jailCase,
   jailDue,
   jailGroups,
   jailRecord,
   parseJailRecord,
   JAIL_KEY,
   type JailCase,
} from '../model/jail';
import { useSettings } from '../settings';
import { readStorage, writeStorage } from '../storage';
import { HeaderIconButton, QuietButton, RepoRef } from './bits';
import { modalOpen } from '../hooks';
import { GroupHeader } from './Lane';
import { CiGlyph } from './pips';

/**
 * PR jail: when your own open PRs pass a limit (model/jail.ts), a modal pops
 * up listing them, and comes back only when that gets worse (jailDue). It
 * has no close button and Esc does nothing: you hold Snooze down for a
 * couple of seconds (a little work on purpose), or get under the limits and
 * it lets you go. While you're over, a header badge counts down what's left
 * and reopens it. `#jail=1` in the URL forces it, any time, for a preview.
 * The jailMode setting picks: pop up (auto), the badge alone (manual), or off.
 */

// whether a mouse button or finger is down, or a native drag is under way:
// the jail never pops up mid-drag (a Roadmap bar or row, say)
let pressing = false;
let dragging = false;
const pointerBusy = () => pressing || dragging;
if (typeof document !== 'undefined') {
   // the main button only: a right-click's context menu swallows its
   // pointerup and would leave this stuck on
   // a new press also means no drag is running, whatever became of the last
   document.addEventListener(
      'pointerdown',
      e => {
         pressing = e.button === 0;
         dragging = false;
      },
      true
   );
   // a touch that turns into a scroll, or a press that turns into a native
   // drag, ends with pointercancel; the drag is tracked on its own
   for (const end of ['pointerup', 'pointercancel', 'contextmenu'] as const)
      document.addEventListener(end, () => (pressing = false), true);
   document.addEventListener('dragstart', () => (dragging = true), true);
   // dragend goes to the dragged node, which may have left the page by then
   // (a Roadmap plan moved to another lane), so the drop counts as the end too
   for (const end of ['dragend', 'drop'] as const)
      document.addEventListener(end, () => (dragging = false), true);
   window.addEventListener('blur', () => (pressing = dragging = false));
}

const hasPreviewFlag = () => new URLSearchParams(location.hash.slice(1)).get('jail') === '1';

/** Renders the header badge in place, and the cell over the page. */
export function JailMode({
   pulls,
   me,
   extraBots,
   initialized,
}: {
   pulls: DerivedPull[];
   me: string;
   extraBots: ReadonlySet<string>;
   initialized: boolean;
}) {
   const settings = useSettings();
   // read on the first render: the app rewrites the hash right after and
   // drops the unknown param
   const [preview, setPreview] = useState(hasPreviewFlag);
   // which jail is open, not a copy of it: the list below is read live, so a
   // merge or a new PR shows up while it's open
   const [shown, setShown] = useState<'real' | 'preview' | null>(null);
   // the last showing, kept here too so blocked storage still holds it for
   // this page load; another tab's showing arrives by the storage event
   const record = useRef(parseJailRecord(readStorage(JAIL_KEY)));

   const found = useMemo(
      () =>
         // no case until we know who you are: an empty `me` (a failed whoami)
         // would read as "under the limits" and wipe the last showing
         initialized && me && settings.jailMode !== 'off'
            ? jailCase(pulls, me, extraBots, {
                 maxOpen: settings.jailMaxOpen,
                 maxDays: settings.jailMaxDays,
                 countDrafts: settings.jailCountDrafts,
              })
            : null,
      [initialized, pulls, me, extraBots, settings]
   );

   // under the limits again: zero what the last showing counted, so going
   // over later is worse than it (a fresh offense), but keep when it showed,
   // so it still comes back at most every 4 hours
   useEffect(() => {
      const last = record.current;
      if (!initialized || !me || found || settings.jailMode === 'off' || !last) return;
      if (!last.count && !last.over.length) return;
      record.current = { at: last.at, count: 0, over: [] };
      writeStorage(JAIL_KEY, JSON.stringify(record.current));
   }, [initialized, me, found, settings.jailMode]);

   // the latest case, for closing: the button's hold started seconds ago, and
   // what you saw last is what the next showing compares against
   const latest = useRef(found);
   latest.current = found;

   // open PRs on the whole board, so a row leaving the jail's list only slides
   // out as merged when it really closed (not when the rule switched)
   const openIds = useMemo(
      () => new Set(pulls.filter(p => p.data.state === 'open').map(pullId)),
      [pulls]
   );

   const remember = (jail: JailCase<DerivedPull>) => {
      record.current = jailRecord(jail, Date.now());
      writeStorage(JAIL_KEY, JSON.stringify(record.current));
   };
   const show = (jail: JailCase<DerivedPull>) => {
      remember(jail);
      setShown('real');
   };

   useEffect(() => {
      const onHash = () => {
         if (hasPreviewFlag()) setPreview(true);
      };
      // Settings' "Preview PR jail": an event, since setting the same hash
      // twice fires nothing
      const onPreview = () => setPreview(true);
      window.addEventListener('pd2:preview-jail', onPreview);
      const onStorage = (e: StorageEvent) => {
         if (e.key === JAIL_KEY) record.current = parseJailRecord(e.newValue);
      };
      window.addEventListener('hashchange', onHash);
      window.addEventListener('storage', onStorage);
      return () => {
         window.removeEventListener('hashchange', onHash);
         window.removeEventListener('pd2:preview-jail', onPreview);
         window.removeEventListener('storage', onStorage);
      };
   }, []);

   // the preview never writes the record, so it can't stand in for a real one
   useEffect(() => {
      if (!initialized || !preview) return;
      setPreview(false);
      setShown('preview');
   }, [initialized, preview]);

   // checked on load, on every data change, and when the tab comes back; a
   // hidden tab or a focused field waits for the next one, so it never lands
   // mid-typing or out of sight
   useEffect(() => {
      if (!found || shown || settings.jailMode !== 'auto') return;
      const check = () => {
         if (document.visibilityState === 'hidden') return;
         // another dialog is up (Settings), or a drag is under way: the jail
         // would land on top of it, and swallow the Esc that cancels a drag
         if (modalOpen() || pointerBusy()) return;
         if (document.activeElement?.matches('input, textarea, select')) return;
         // read the record fresh: a second visible window may have shown it
         // a moment ago, before its storage event reached this one
         record.current = parseJailRecord(readStorage(JAIL_KEY)) ?? record.current;
         if (!jailDue(found, record.current, Date.now())) return;
         show(found);
      };
      check();
      document.addEventListener('visibilitychange', check);
      window.addEventListener('focus', check);
      return () => {
         document.removeEventListener('visibilitychange', check);
         window.removeEventListener('focus', check);
      };
   }, [found, shown, settings.jailMode]);

   // you got under the limits while it was up: it says so, then lets you go
   const freed = shown === 'real' && !found;
   useEffect(() => {
      if (!freed) return;
      const t = window.setTimeout(() => setShown(null), FREED_MS);
      return () => clearTimeout(t);
   }, [freed]);

   return (
      <>
         {found && (
            <HeaderIconButton
               icon={Lock}
               label={`PR jail, ${found.toGo} to go: ${found.why}`}
               onClick={() => show(found)}
               className="relative"
            >
               <span className="absolute -top-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-warn px-1 text-[10px] leading-none font-semibold text-surface tabular-nums">
                  {found.toGo > 9 ? '9+' : found.toGo}
               </span>
            </HeaderIconButton>
         )}
         {shown &&
            createPortal(
               <JailModal
                  jail={
                     found ??
                     (shown === 'preview' ? sampleCase(pulls, me, extraBots, settings) : FREE)
                  }
                  me={me}
                  maxDays={settings.jailMaxDays}
                  openIds={openIds}
                  onDone={() => {
                     // what you saw last is what the next showing compares
                     // against, so PRs opened while it was up don't re-drop it
                     if (shown === 'real' && latest.current) remember(latest.current);
                     setShown(null);
                  }}
               />,
               document.body
            )}
      </>
   );
}

/** How long "You're out" shows before the jail closes on its own. */
const FREED_MS = 2500;

/** Merged or closed your way under the limits while it was up. */
const FREE: JailCase<DerivedPull> = {
   pulls: [],
   why: 'You’re out. Nice work.',
   count: 0,
   over: [],
   toGo: 0,
};

/** The preview when you're not in jail: your PRs as jail counts them (any
 * open one trips a limit of 0), or the board's oldest when you have none,
 * so there's something to look at. */
function sampleCase(
   pulls: DerivedPull[],
   me: string,
   extraBots: ReadonlySet<string>,
   settings: { jailMaxDays: number; jailCountDrafts: boolean }
): JailCase<DerivedPull> {
   const mine = jailCase(pulls, me, extraBots, {
      maxOpen: 0,
      maxDays: settings.jailMaxDays,
      countDrafts: settings.jailCountDrafts,
   });
   if (mine) return { ...mine, why: 'Preview: your open PRs, as jail would list them' };
   return {
      pulls: pulls
         .filter(p => p.data.state === 'open')
         .sort((a, b) => b.ageDays - a.ageDays)
         .slice(0, 6),
      why: 'Preview: these are sample PRs from the board',
      count: 0,
      over: [],
      toGo: 0,
   };
}

/** How long "Hold to get back to work" has to be held down. */
const HOLD_MS = 2000;
/** How long the open lock shows before the jail closes. */
const OPEN_MS = 700;
/** How long a merged or closed row takes to leave the list. */
const LEAVE_MS = 450;

/** The modal over the board: a centered card on a desktop, a sheet up from
 * the bottom on a phone. Its header and its one button stay put while the
 * list scrolls between them. No close button and no Esc: the way out besides
 * getting under the limits is holding the button down for a couple of
 * seconds, by pointer, finger, Enter or Space. */
function JailModal({
   jail,
   me,
   maxDays,
   openIds,
   onDone,
}: {
   jail: JailCase<DerivedPull>;
   me: string;
   maxDays: number;
   openIds: ReadonlySet<string>;
   onDone: () => void;
}) {
   const rootRef = useRef<HTMLDivElement>(null);
   const free = jail === FREE;

   // "You're out" unmounts the focused button: keep focus in the dialog
   useEffect(() => {
      if (free) rootRef.current?.focus({ preventScroll: true });
   }, [free]);

   useEffect(() => {
      const root = rootRef.current;
      // focus goes back where it was (the header lock, say) when it closes
      const before = document.activeElement as HTMLElement | null;
      // focus starts on the button, so holding Enter or Space works right
      // away; the dialog itself when it's showing "You're out"
      const hold = root?.querySelector<HTMLElement>('[data-hold]');
      (hold ?? root)?.focus({ preventScroll: true });
      // Esc doesn't close it (holding the button does); Tab stays inside
      const onKey = (e: KeyboardEvent) => {
         // Esc does nothing here, and must not reach a dialog behind this one
         // (Settings) either: listening in the capture phase runs first
         if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
         }
         if (e.key !== 'Tab' || !root) return;
         const focusables = root.querySelectorAll<HTMLElement>('a[href], button');
         if (!focusables.length) return;
         const first = focusables[0];
         const last = focusables[focusables.length - 1];
         if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
         } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
         } else if (!root.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
         }
      };
      document.addEventListener('keydown', onKey, true);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
         document.removeEventListener('keydown', onKey, true);
         document.body.style.overflow = prevOverflow;
         before?.focus?.({ preventScroll: true });
      };
   }, []);

   return (
      <div
         ref={rootRef}
         tabIndex={-1}
         role="dialog"
         aria-modal="true"
         aria-labelledby="jail-title"
         aria-describedby="jail-why"
         className="fixed inset-0 z-[200] flex flex-col items-center justify-end bg-ink/40 pt-8 outline-none sm:justify-start sm:px-4 sm:pt-[8vh] sm:pb-8"
      >
         <section className="flex max-h-full w-full flex-col gap-5 rounded-t-2xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink shadow-2xl sm:max-h-[80vh] sm:max-w-[40rem] sm:rounded-2xl sm:p-6">
            <div className="flex items-center gap-4">
               <SadRobot />
               <div className="min-w-0 flex-1">
                  <h2
                     id="jail-title"
                     className="m-0 flex items-center gap-2.5 text-xl font-semibold"
                  >
                     PR jail
                     {/* the countdown to freedom: ticks down live as you merge
                         or close */}
                     <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                           free ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
                        }`}
                     >
                        {free ? 'Free' : `${jail.toGo} to go`}
                     </span>
                  </h2>
                  <p
                     id="jail-why"
                     className="m-0 mt-1 text-sm leading-snug text-ink-2"
                     aria-live="polite"
                  >
                     {jail.why}
                  </p>
               </div>
            </div>
            {!free && (
               <>
                  {/* the board's own sticky group headers, pinned to the top
                      of this list on the card's color instead of under the
                      app header on the canvas */}
                  <div className="-mx-1 min-h-0 overflow-y-auto px-1 [--canvas:var(--surface)] [--header-h:0px]">
                     <JailList pulls={jail.pulls} me={me} maxDays={maxDays} openIds={openIds} />
                  </div>
                  <HoldToLeave onDone={onDone} />
               </>
            )}
         </section>
      </div>
   );
}

/** The one button: hold it down for HOLD_MS, by pointer, finger, Enter or
 * Space. The key in the lock turns a quarter turn as you hold and the ring
 * around it fills, both off the same clock; letting go early springs them
 * back, and a quick click says to hold it. At the end the lock opens and
 * the jail closes. */
function HoldToLeave({ onDone }: { onDone: () => void }) {
   const [holding, setHolding] = useState(false);
   const [opened, setOpened] = useState(false);
   // a click too short to be a hold: the label teaches the gesture
   const [tapped, setTapped] = useState(false);
   const timer = useRef<number | undefined>(undefined);
   const tapTimer = useRef<number | undefined>(undefined);
   const since = useRef(0);
   // when a key was last let go: Firefox clicks a button on Space's keyup,
   // and that click must not pass for assistive tech's lone click
   const keyUpAt = useRef(0);
   const start = () => {
      if (timer.current !== undefined || opened) return;
      since.current = Date.now();
      setHolding(true);
      setTapped(false);
      timer.current = window.setTimeout(() => {
         setOpened(true);
         timer.current = window.setTimeout(onDone, OPEN_MS);
      }, HOLD_MS);
   };
   const stop = () => {
      if (opened || timer.current === undefined) return;
      clearTimeout(timer.current);
      timer.current = undefined;
      setHolding(false);
      if (Date.now() - since.current < 500) {
         setTapped(true);
         clearTimeout(tapTimer.current);
         tapTimer.current = window.setTimeout(() => setTapped(false), 2000);
      }
   };
   useEffect(
      () => () => {
         clearTimeout(timer.current);
         clearTimeout(tapTimer.current);
      },
      []
   );
   const isPress = (key: string) => key === 'Enter' || key === ' ';
   // the ring and the key share one timing: fill and turn while held, snap
   // back when let go
   const sweep = holding ? `${HOLD_MS}ms linear` : '150ms ease-out';
   return (
      <button
         type="button"
         onPointerDown={e => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            start();
         }}
         // screen readers, voice control and switch access send a lone click
         // with no pointer or key behind it (detail 0): they can't hold, so
         // that click lets them out. A mouse click (detail 1+) or a held key
         // never gets here as detail 0.
         onClick={e => {
            if (e.detail !== 0 || holding || opened) return;
            if (Date.now() - keyUpAt.current < 1000) return;
            onDone();
         }}
         onPointerUp={stop}
         onPointerCancel={stop}
         onKeyDown={e => {
            if (!isPress(e.key)) return;
            e.preventDefault();
            if (!e.repeat) start();
         }}
         onKeyUp={e => {
            if (!isPress(e.key)) return;
            e.preventDefault();
            keyUpAt.current = Date.now();
            stop();
         }}
         onBlur={stop}
         onContextMenu={e => e.preventDefault()}
         data-hold
         className="pressable flex min-h-14 w-full shrink-0 touch-none items-center justify-center gap-3 rounded-xl border border-line px-4 py-2 select-none [-webkit-touch-callout:none] hover:border-brand hover:bg-secondary"
      >
         <svg
            aria-hidden
            viewBox="0 0 48 48"
            className="size-10 shrink-0"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
         >
            {/* the ring: a quiet track, filling with brand as you hold */}
            <circle cx="24" cy="24" r="22" className="stroke-line" strokeWidth={2} />
            <circle
               cx="24"
               cy="24"
               r="22"
               pathLength={1}
               strokeDasharray="1"
               className={opened ? 'stroke-ok' : 'stroke-brand'}
               strokeWidth={2}
               transform="rotate(-90 24 24)"
               style={{
                  strokeDashoffset: holding ? 0 : 1,
                  transition: `stroke-dashoffset ${sweep}`,
               }}
            />
            {/* the shackle: once the key has turned it lifts out of the
                body and swings over its right leg to the other side */}
            <path
               d="M18 22 V18 a6 6 0 0 1 12 0 V22"
               className={`stroke-ink-2 ${opened ? 'jail-shackle-open' : ''}`}
               strokeWidth={2.5}
            />
            <rect
               x="14"
               y="22"
               width="20"
               height="15"
               rx="4"
               className="fill-surface stroke-ink-2"
               strokeWidth={2}
            />
            {/* the key's bow in the keyhole: it wiggles while it waits for
                you, and turns a quarter turn as you hold */}
            <g
               className={holding || opened ? '' : 'jail-key-wiggle'}
               style={{ transformOrigin: '24px 29.5px' }}
            >
               <rect
                  x="22.5"
                  y="25"
                  width="3"
                  height="9"
                  rx="1.5"
                  className={opened ? 'fill-ok' : 'fill-brand'}
                  style={{
                     transformOrigin: '24px 29.5px',
                     rotate: holding ? '90deg' : '0deg',
                     transition: `rotate ${sweep}`,
                  }}
               />
            </g>
         </svg>
         <span className="text-[15px] font-semibold text-ink" aria-live="polite">
            {opened
               ? 'Unlocked'
               : holding
               ? 'Keep holding…'
               : tapped
               ? 'Hold it down'
               : 'Hold to get back to work'}
         </span>
      </button>
   );
}

const pullId = (p: DerivedPull) => `${p.data.repo}#${p.data.number}`;

/** The PRs that just left `pulls` (merged or closed), kept for LEAVE_MS so
 * their rows can slide out instead of vanishing. */
function useLeaving(pulls: DerivedPull[], openIds: ReadonlySet<string>): DerivedPull[] {
   const last = useRef(new Map<string, DerivedPull>());
   const [leaving, setLeaving] = useState<DerivedPull[]>([]);
   const timers = useRef<number[]>([]);
   useEffect(() => {
      const now = new Map(pulls.map(p => [pullId(p), p]));
      // gone from the list and closed on the board; one that only stopped
      // counting (the rule switched, or it went draft) just leaves
      const gone = [...last.current]
         .filter(([id]) => !now.has(id) && !openIds.has(id))
         .map(([, p]) => p);
      last.current = now;
      if (!gone.length) return;
      setLeaving(l => [...l, ...gone]);
      timers.current.push(
         window.setTimeout(() => setLeaving(l => l.filter(p => !gone.includes(p))), LEAVE_MS)
      );
      // keyed on pulls alone: openIds changes with every board update, and
      // it's only read to tell a close from a rule switch
   }, [pulls]);
   useEffect(() => () => timers.current.forEach(clearTimeout), []);
   // one that came back (reopened) is just a row again
   return leaving.filter(p => !pulls.some(q => pullId(q) === pullId(p)));
}

/** Slack-ready text asking for the reviews your waiting PRs need: each
 * title, its link, and who it waits on. */
function nudgeText(rows: { pull: DerivedPull }[], me: string): string {
   return [
      'A few of my PRs are waiting on a review or a stamp:',
      ...rows.map(({ pull: p }) => {
         const who = rowNote(p, me).context;
         return `• ${p.data.title} ${githubUrl(p.data.repo, p.data.number)}${
            who ? ` (${who})` : ''
         }`;
      }),
   ].join('\n');
}

/** Copies nudgeText, and says whether it worked. */
function CopyNudge({ rows, me }: { rows: { pull: DerivedPull }[]; me: string }) {
   const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
   const done = (result: 'copied' | 'failed') => {
      setCopied(result);
      window.setTimeout(() => setCopied(null), 3000);
   };
   return (
      <QuietButton
         onClick={() => {
            if (!navigator.clipboard) return done('failed');
            navigator.clipboard.writeText(nudgeText(rows, me)).then(
               () => done('copied'),
               () => done('failed')
            );
         }}
      >
         {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : 'Copy a nudge'}
      </QuietButton>
   );
}

/** Your PRs, the way My work groups them, with the ready ones on top: the
 * quickest way out first, each group under the board's own header with a
 * word on what to do, oldest first. Someone else's PRs (the preview's
 * fallback) list flat, since their groups would be a reviewer's. */
function JailList({
   pulls,
   me,
   maxDays,
   openIds,
}: {
   pulls: DerivedPull[];
   me: string;
   maxDays: number;
   openIds: ReadonlySet<string>;
}) {
   const leaving = useLeaving(pulls, openIds);
   const gone = new Set(leaving.map(pullId));
   const all = [...pulls, ...leaving];
   const mine = all.every(p => p.data.user.login === me);
   const groups = mine
      ? jailGroups(all, me)
      : { ready: [], move: [], waiting: all.map(pull => ({ pull })) };
   const live = (rows: { pull: DerivedPull }[]) => rows.filter(r => !gone.has(pullId(r.pull)));
   const sections = [
      { title: STAGE_WORDS.ready, sub: 'Merge these first', rows: groups.ready, ready: true },
      { title: 'Your move', sub: 'Waiting on you', rows: groups.move },
      {
         title: 'Waiting on others',
         sub: 'Nudge them, or close what you don’t need',
         rows: groups.waiting,
         nudge: true,
      },
   ].filter(g => g.rows.length);
   return (
      <div className="flex flex-col gap-6">
         {sections.map(g => (
            <section key={g.title} aria-label={mine ? g.title : undefined}>
               {mine && (
                  <GroupHeader
                     level={3}
                     title={g.title}
                     sub={g.sub}
                     count={live(g.rows).length}
                     headerExtra={
                        g.nudge && live(g.rows).length ? (
                           <CopyNudge rows={live(g.rows)} me={me} />
                        ) : undefined
                     }
                  />
               )}
               <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                  {g.rows.map(({ pull }) => (
                     <JailRow
                        key={pullId(pull)}
                        pull={pull}
                        me={me}
                        maxDays={maxDays}
                        ready={Boolean(g.ready)}
                        mine={mine}
                        leaving={gone.has(pullId(pull))}
                     />
                  ))}
               </ul>
            </section>
         ))}
      </div>
   );
}

/** One PR: the title to GitHub and its age, then the move and what it's
 * waiting on. */
function JailRow({
   pull: p,
   me,
   maxDays,
   ready,
   mine,
   leaving,
}: {
   pull: DerivedPull;
   me: string;
   maxDays: number;
   ready: boolean;
   mine: boolean;
   /** merged or closed: it slides out */
   leaving?: boolean;
}) {
   const word = mine && !ready ? rowWord(p, me) : null;
   const context = mine ? rowNote(p, me).context : null;
   // a do row names the move, then the detail; a wait row's detail already
   // says who it waits on ("waiting on bob to re-stamp"), so the word only
   // stands in when there's no detail
   const move = word?.kind === 'do' ? word.word : null;
   const detail = context ?? (word?.kind === 'wait' ? word.word : null);
   const old = p.ageDays > maxDays;
   return (
      <li
         className={`flex flex-col gap-1.5 py-3 ${leaving ? 'jail-row-leave' : ''}`}
         aria-hidden={leaving || undefined}
      >
         <span className="flex items-baseline gap-4">
            <a
               href={githubUrl(p.data.repo, p.data.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="min-w-0 flex-1 text-sm leading-snug font-medium text-ink hover:underline"
            >
               {p.data.title} <span aria-hidden>↗</span>
            </a>
            <span
               className={`shrink-0 text-xs tabular-nums ${
                  old ? 'font-semibold text-warn' : 'text-ink-3'
               }`}
               title={`Open ${p.ageDays} days${old ? `, past the ${maxDays}-day limit` : ''}`}
            >
               {p.ageDays ? `${p.ageDays} days` : 'today'}
            </span>
         </span>
         <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <RepoRef repo={p.data.repo} number={p.data.number} />
            {move && (
               <span className="rounded-md bg-brand/10 px-1.5 py-0.5 font-medium whitespace-nowrap text-brand-700">
                  {move}
               </span>
            )}
            {!ready && (
               <>
                  <CiGlyph pull={p} />
                  {/* the glyph is aria-hidden; say what it shows */}
                  {p.ci === 'failing' && <span className="sr-only">CI failing</span>}
                  {p.ci === 'pending' && <span className="sr-only">CI running</span>}
               </>
            )}
            {detail && <span className="min-w-0">{detail}</span>}
         </span>
      </li>
   );
}

/** The inmate: a sad robot behind bars, drawn in the board's own line
 * weights and color tokens so it themes with everything else. */
function SadRobot() {
   return (
      <svg
         aria-hidden
         viewBox="0 0 96 96"
         className="size-20 shrink-0 rounded-xl bg-secondary"
         fill="none"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         {/* a drooping antenna */}
         <path d="M48 24 C48 18 52 15 57 15" className="stroke-ink-3" strokeWidth={2} />
         <circle cx="58" cy="15" r="2.5" className="fill-warn" />
         {/* head, and the face on its screen */}
         <rect
            x="26"
            y="24"
            width="44"
            height="34"
            rx="10"
            className="fill-surface stroke-ink-2"
            strokeWidth={2}
         />
         <path d="M38 35 L43 33 M58 35 L53 33" className="stroke-ink-2" strokeWidth={2} />
         <circle cx="41" cy="40" r="2.2" className="fill-ink-2" />
         <circle cx="55" cy="40" r="2.2" className="fill-ink-2" />
         <path d="M42 50 Q48 45 54 50" className="stroke-ink-2" strokeWidth={2} />
         {/* striped prison body */}
         <rect
            x="34"
            y="62"
            width="28"
            height="22"
            rx="6"
            className="fill-surface stroke-ink-2"
            strokeWidth={2}
         />
         <path d="M34 69 H62 M34 76 H62" className="stroke-ink-3" strokeWidth={2} />
         {/* the bars, in front of him */}
         <path
            d="M14 8 V88 M31 8 V88 M65 8 V88 M82 8 V88 M8 8 H88 M8 88 H88"
            className="stroke-ink-3"
            strokeWidth={2.5}
         />
      </svg>
   );
}
