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
import { HeaderIconButton, RepoRef } from './bits';
import { eyebrowText } from './Lane';
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
         initialized && settings.jailMode !== 'off'
            ? jailCase(pulls, me, extraBots, {
                 maxOpen: settings.jailMaxOpen,
                 maxDays: settings.jailMaxDays,
                 countDrafts: settings.jailCountDrafts,
              })
            : null,
      [initialized, pulls, me, extraBots, settings]
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
      const onStorage = (e: StorageEvent) => {
         if (e.key === JAIL_KEY) record.current = parseJailRecord(e.newValue);
      };
      window.addEventListener('hashchange', onHash);
      window.addEventListener('storage', onStorage);
      return () => {
         window.removeEventListener('hashchange', onHash);
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
         if (document.activeElement?.matches('input, textarea, select')) return;
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
                  onDone={() => {
                     // what you saw last is what the next showing compares
                     // against, so PRs opened while it was up don't re-drop it
                     if (shown === 'real' && found) remember(found);
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

/** How long the snooze button has to be held down. */
const HOLD_MS = 2000;
/** How long the open lock shows before the jail closes. */
const OPEN_MS = 400;

/** The modal over the board. No close button and no Esc: the only way out
 * besides getting under the limits is holding Snooze down for a couple of
 * seconds, by pointer, finger, Enter or Space. */
function JailModal({
   jail,
   me,
   maxDays,
   onDone,
}: {
   jail: JailCase<DerivedPull>;
   me: string;
   maxDays: number;
   onDone: () => void;
}) {
   const rootRef = useRef<HTMLDivElement>(null);
   const free = jail === FREE;

   useEffect(() => {
      const root = rootRef.current;
      root?.focus({ preventScroll: true });
      // Esc doesn't close it (holding Snooze does); Tab stays inside
      const onKey = (e: KeyboardEvent) => {
         if (e.key === 'Escape') e.preventDefault();
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
      document.addEventListener('keydown', onKey);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
         document.removeEventListener('keydown', onKey);
         document.body.style.overflow = prevOverflow;
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
         className="fixed inset-0 z-[200] flex flex-col items-center overflow-y-auto bg-ink/40 px-4 pt-[8vh] pb-8 outline-none"
      >
         <section className="flex max-h-[calc(100dvh-8vh-2rem)] w-full max-w-[30rem] flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-ink shadow-2xl">
            <div className="flex items-center gap-3">
               <SadRobot />
               <div className="min-w-0 flex-1">
                  <h2 id="jail-title" className="m-0 flex items-center gap-2 text-lg font-semibold">
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
                  <p id="jail-why" className="m-0 text-[13px] text-ink-2" aria-live="polite">
                     {jail.why}
                  </p>
               </div>
            </div>
            {!free && (
               <>
                  <div className="min-h-0 overflow-y-auto">
                     <JailList pulls={jail.pulls} me={me} maxDays={maxDays} />
                  </div>
                  <HoldToSnooze onDone={onDone} />
               </>
            )}
         </section>
      </div>
   );
}

/** Snooze, but only for someone who means it: hold the row down for
 * HOLD_MS, by pointer, finger, Enter or Space. The key in the lock turns a
 * quarter turn as you hold and the ring around it fills, both off the same
 * clock; letting go early springs them back. At the end the shackle pops
 * open and the jail closes. */
function HoldToSnooze({ onDone }: { onDone: () => void }) {
   const [holding, setHolding] = useState(false);
   const [opened, setOpened] = useState(false);
   const timer = useRef<number | undefined>(undefined);
   const start = () => {
      if (timer.current !== undefined || opened) return;
      setHolding(true);
      timer.current = window.setTimeout(() => {
         setOpened(true);
         timer.current = window.setTimeout(onDone, OPEN_MS);
      }, HOLD_MS);
   };
   const stop = () => {
      if (opened) return;
      clearTimeout(timer.current);
      timer.current = undefined;
      setHolding(false);
   };
   useEffect(() => () => clearTimeout(timer.current), []);
   const isPress = (key: string) => key === 'Enter' || key === ' ';
   // the ring and the key share one timing: fill and turn while held, snap
   // back when let go
   const sweep = holding ? `${HOLD_MS}ms linear` : '150ms ease-out';
   return (
      <button
         type="button"
         aria-describedby="jail-snooze-hint"
         onPointerDown={e => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            start();
         }}
         onPointerUp={stop}
         onPointerCancel={stop}
         onKeyDown={e => {
            if (!isPress(e.key)) return;
            e.preventDefault();
            if (!e.repeat) start();
         }}
         onKeyUp={e => isPress(e.key) && stop()}
         onBlur={stop}
         onContextMenu={e => e.preventDefault()}
         className="pressable group flex w-full touch-none items-center gap-3 rounded-lg border-t border-line pt-3 text-left select-none [-webkit-touch-callout:none]"
      >
         <svg
            aria-hidden
            viewBox="0 0 48 48"
            className="size-12 shrink-0"
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
               className="stroke-brand"
               strokeWidth={2}
               transform="rotate(-90 24 24)"
               style={{
                  strokeDashoffset: holding ? 0 : 1,
                  transition: `stroke-dashoffset ${sweep}`,
               }}
            />
            {/* the shackle, which pops up once the key has turned */}
            <path
               d="M18 22 V18 a6 6 0 0 1 12 0 V22"
               className="stroke-ink-2"
               strokeWidth={2.5}
               style={{
                  translate: opened ? '0 -4px' : '0 0',
                  transition: 'translate 200ms ease-out',
               }}
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
                  className="fill-brand"
                  style={{
                     transformOrigin: '24px 29.5px',
                     rotate: holding ? '90deg' : '0deg',
                     transition: `rotate ${sweep}`,
                  }}
               />
            </g>
         </svg>
         <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-ink group-hover:text-brand">
               {opened ? 'Snoozed' : holding ? 'Keep holding…' : 'Hold to snooze'}
            </span>
            <span id="jail-snooze-hint" className="block text-xs text-ink-3">
               It comes back if things get worse, at most every 4 hours.
            </span>
         </span>
      </button>
   );
}

/** Your PRs, the way My work groups them, with the ready ones on top: the
 * quickest way out first. Someone else's PRs (the preview's fallback) list
 * flat, since their groups would be a reviewer's. */
function JailList({ pulls, me, maxDays }: { pulls: DerivedPull[]; me: string; maxDays: number }) {
   const mine = pulls.every(p => p.data.user.login === me);
   const groups = mine
      ? jailGroups(pulls, me)
      : { ready: [], move: [], waiting: pulls.map(pull => ({ pull })) };
   const sections = [
      { title: STAGE_WORDS.ready, tone: 'text-brand-700', rows: groups.ready, ready: true },
      { title: 'Your move', tone: 'text-brand-700', rows: groups.move },
      { title: 'Waiting on others', tone: 'text-ink-3', rows: groups.waiting },
   ].filter(g => g.rows.length);
   return (
      <div className="flex flex-col gap-3">
         {sections.map(g => (
            <section key={g.title} aria-label={mine ? g.title : undefined}>
               {mine && (
                  <h3 className={`m-0 ${eyebrowText} ${g.tone}`}>
                     {g.title} <span className="text-ink-3 tabular-nums">· {g.rows.length}</span>
                  </h3>
               )}
               {g.ready && (
                  <p className="m-0 text-xs text-ink-3">Quickest way out. Merge these first.</p>
               )}
               <ul className="m-0 mt-1.5 flex list-none flex-col gap-2 p-0">
                  {g.rows.map(({ pull }) => (
                     <JailRow
                        key={`${pull.data.repo}#${pull.data.number}`}
                        pull={pull}
                        me={me}
                        maxDays={maxDays}
                        ready={Boolean(g.ready)}
                        mine={mine}
                     />
                  ))}
               </ul>
            </section>
         ))}
      </div>
   );
}

/** One PR: the title to GitHub and its age, then what it's waiting on. */
function JailRow({
   pull: p,
   me,
   maxDays,
   ready,
   mine,
}: {
   pull: DerivedPull;
   me: string;
   maxDays: number;
   ready: boolean;
   mine: boolean;
}) {
   const word = mine && !ready ? rowWord(p, me) : null;
   const context = mine ? rowNote(p, me).context : null;
   // a do row names the move, then the detail; a wait row's detail already
   // says who it waits on ("waiting on bob to re-stamp"), so the word only
   // stands in when there's no detail
   const move = word?.kind === 'do' ? word.word : null;
   const detail = context ?? (word?.kind === 'wait' ? word.word : null);
   return (
      <li className="flex flex-col text-[13px]">
         <span className="flex items-baseline gap-3">
            <a
               href={githubUrl(p.data.repo, p.data.number)}
               target="_blank"
               rel="noopener noreferrer"
               className="min-w-0 flex-1 font-medium text-ink hover:underline"
            >
               {p.data.title} <span aria-hidden>↗</span>
            </a>
            <span
               className={`shrink-0 text-xs tabular-nums ${
                  p.ageDays > maxDays ? 'font-semibold text-warn' : 'text-ink-3'
               }`}
               title={`Open ${p.ageDays} days`}
            >
               {p.ageDays ? `${p.ageDays}d` : '<1d'}
            </span>
         </span>
         <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
            <RepoRef repo={p.data.repo} number={p.data.number} />
            {move && <span className="font-medium whitespace-nowrap text-brand-700">· {move}</span>}
            {!ready && <CiGlyph pull={p} />}
            {detail && <span className="min-w-0 truncate">· {detail}</span>}
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
