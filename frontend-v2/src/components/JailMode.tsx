import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Trash2 } from 'lucide-react';
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
 * has no close button: you drag it to the trash at the bottom of the screen
 * (or press the trash from the keyboard). While you're over, a header badge
 * reopens it. `#jail=1` in the URL forces it, any time, for a preview; the
 * jailOn setting turns the whole thing off.
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
         initialized && settings.jailOn
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
      if (!found || shown) return;
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
   }, [found, shown]);

   return (
      <>
         {found && (
            <HeaderIconButton
               icon={Lock}
               label={`PR jail: ${found.why}`}
               onClick={() => show(found)}
               className="relative"
            >
               <span className="absolute -top-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-warn px-1 text-[10px] leading-none font-semibold text-surface tabular-nums">
                  {found.pulls.length > 9 ? '9+' : found.pulls.length}
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

/** Merged or closed your way under the limits while the cell was down. */
const FREE: JailCase<DerivedPull> = {
   pulls: [],
   why: 'You’re under the limits now. Drag this to the trash and get back to work.',
   count: 0,
   over: [],
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
   };
}

/** The modal over the board. The only way out is dragging it onto the
 * trash; a keyboard or screen reader presses the trash instead. */
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
   const trashRef = useRef<HTMLButtonElement>(null);
   const drag = useRef<{ id: number; x: number; y: number } | null>(null);
   const [offset, setOffset] = useState({ x: 0, y: 0 });
   const [dragging, setDragging] = useState(false);
   // the card is over the trash: the trash says "let go here"
   const [over, setOver] = useState(false);

   useEffect(() => {
      const root = rootRef.current;
      root?.focus({ preventScroll: true });
      // Esc doesn't close it (the trash does); Tab stays inside
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

   /** Whether the pointer is over the trash, with some slop. */
   const onTrash = (x: number, y: number) => {
      const t = trashRef.current?.getBoundingClientRect();
      const slop = 32;
      return Boolean(
         t && x > t.left - slop && x < t.right + slop && y > t.top - slop && y < t.bottom + slop
      );
   };

   const onPointerDown = (e: PointerEvent<HTMLElement>) => {
      // links in the header stay clickable
      if ((e.target as HTMLElement).closest('a')) return;
      drag.current = { id: e.pointerId, x: e.clientX - offset.x, y: e.clientY - offset.y };
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
   };
   const onPointerMove = (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (d?.id !== e.pointerId) return;
      setOffset({ x: e.clientX - d.x, y: e.clientY - d.y });
      setOver(onTrash(e.clientX, e.clientY));
   };
   const onPointerUp = (e: PointerEvent<HTMLElement>) => {
      if (drag.current?.id !== e.pointerId) return;
      drag.current = null;
      setDragging(false);
      setOver(false);
      if (onTrash(e.clientX, e.clientY)) onDone();
      else setOffset({ x: 0, y: 0 });
   };

   return (
      <div
         ref={rootRef}
         tabIndex={-1}
         role="dialog"
         aria-modal="true"
         aria-labelledby="jail-title"
         aria-describedby="jail-why"
         className="fixed inset-0 z-[200] flex flex-col items-center overflow-y-auto bg-ink/40 px-4 pt-[8vh] pb-32 outline-none"
      >
         <section
            className={`flex max-h-[calc(100dvh-8vh-9rem)] w-full max-w-[30rem] flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-ink shadow-2xl ${
               dragging ? '' : 'transition-transform duration-200 motion-reduce:transition-none'
            } ${over ? 'scale-90 opacity-70' : ''}`}
            style={{ translate: `${offset.x}px ${offset.y}px` }}
         >
            {/* the handle: drag the card from its top, down to the trash */}
            <div
               className={`flex touch-none items-center gap-3 select-none ${
                  dragging ? 'cursor-grabbing' : 'cursor-grab'
               }`}
               onPointerDown={onPointerDown}
               onPointerMove={onPointerMove}
               onPointerUp={onPointerUp}
               onPointerCancel={onPointerUp}
            >
               <SadRobot />
               <div className="min-w-0">
                  <h2 id="jail-title" className="m-0 text-lg font-semibold">
                     PR jail
                  </h2>
                  <p id="jail-why" className="m-0 text-[13px] text-ink-2">
                     {jail.why}
                  </p>
               </div>
            </div>
            <div className="min-h-0 overflow-y-auto">
               <JailList pulls={jail.pulls} me={me} maxDays={maxDays} />
            </div>
            <p className="m-0 border-t border-line pt-3 text-xs text-ink-3">
               Drag this card into the trash below to put it away.
            </p>
         </section>
         <button
            ref={trashRef}
            type="button"
            aria-label="Throw PR jail in the trash"
            // keyboard and screen readers click with detail 0; a mouse has to
            // drag the card here
            onClick={e => e.detail === 0 && onDone()}
            className={`fixed bottom-6 left-1/2 grid size-16 -translate-x-1/2 cursor-default place-items-center rounded-full border-2 border-dashed shadow-lg transition-colors duration-150 motion-reduce:transition-none ${
               over
                  ? 'scale-110 border-bad bg-bad text-surface'
                  : dragging
                  ? 'border-bad bg-surface text-bad'
                  : 'border-line bg-surface text-ink-3'
            }`}
         >
            <Trash2 size={26} aria-hidden />
         </button>
      </div>
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
