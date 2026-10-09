import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
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
 * PR jail: when your own open PRs pass a limit (model/jail.ts), a cell
 * drops over the board and lists them, and comes back only when that gets
 * worse (jailDue). Dragging the key onto the lock (or pressing it) lets you
 * out. While you're over, a header badge reopens it. `#jail=1` in the URL
 * forces it, any time, for a preview.
 */

// the art as raw SVG strings, inlined so CSS can animate their parts
const svgs = import.meta.glob<string>('../assets/jail/*.svg', {
   query: '?raw',
   import: 'default',
   eager: true,
});
const svg = (name: string) => svgs[`../assets/jail/${name}.svg`];

/** Several SVGs share one page, so every id (and every #ref to one) gets a
 * per-copy prefix. */
function prefixIds(raw: string, prefix: string): string {
   return raw
      .replace(/<\?xml[^>]*>/, '')
      .replace(/<title>[^<]*<\/title>/, '')
      .replace(/id="/g, `id="${prefix}`)
      .replace(/(href="#|url\(#)/g, `$1${prefix}`);
}

/** One cell's art and where things sit on it, in its 1200x800 viewBox.
 * `front` names the bars drawn again in front of the robot, so it reads as
 * inside the cell; swapping the cell art means a new one of these. */
const CELL = {
   svg: svg('cell-r10'),
   // the door's outer bars cross the robot's sides; the middle one stays
   // behind him, since in front it would hide his face
   front: [725, 875],
   barTop: 92,
   barBottom: 708,
   // the robot's face sits on the door's middle line (x 800); inmate-r05
   // draws him further left in its art, so its box sits further right
   inmate: { x: 590, y: 275, w: 330, h: 440 },
   merged: { x: 635, y: 275, w: 330, h: 440 },
   // inmate-r03's tally wall, on the back wall in the bay left of the door
   tally: { x: 528, y: 271, w: 216, h: 288 },
   // hung on the door's latch edge, clear of the robot's face
   lock: { x: 608, y: 330, w: 120, h: 160 },
   // right above the lock, so getting out is one drag straight down
   key: { x: 631, y: 96, w: 74, h: 148 },
   // the dashed arrow from the key's bit down to the lock
   guide: { x: 653, y: 248, w: 30, h: 78 },
   // the drop-target ring, centered on the padlock's keyhole
   ring: { x: 598, y: 372, w: 140, h: 140 },
};

const ART = {
   back: prefixIds(CELL.svg, 'jb-'),
   front: prefixIds(CELL.svg, 'jf-'),
   inmate: prefixIds(svg('inmate-r03'), 'ji-'),
   tally: prefixIds(svg('inmate-r03'), 'jt-'),
   merged: prefixIds(svg('inmate-r05'), 'jm-'),
   key: prefixIds(svg('key-g01'), 'jk-'),
   lock: prefixIds(svg('lock-g01'), 'jl-'),
};

const box = (b: { x: number; y: number; w: number; h: number }): CSSProperties => ({
   left: `${b.x / 12}%`,
   top: `${b.y / 8}%`,
   width: `${b.w / 12}%`,
   height: `${b.h / 8}%`,
});

/** A clip-path showing only narrow strips around the front bars. The strips
 * join along the top edge with zero-width seams. */
function frontClip(): string {
   const top = `${CELL.barTop / 8}%`;
   const bottom = `${CELL.barBottom / 8}%`;
   const pts = CELL.front.flatMap(x => {
      const l = `${(x - 18) / 12}%`;
      const r = `${(x + 18) / 12}%`;
      return [`${l} ${top}`, `${r} ${top}`, `${r} ${bottom}`, `${l} ${bottom}`, `${l} ${top}`];
   });
   return `polygon(${pts.join(', ')})`;
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
         initialized
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
               <JailCell
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
   why: 'You’re under the limits now. Use the key to walk out.',
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

type Phase = 'locked' | 'turning' | 'open' | 'leaving';

// ms from a hit: key snaps and turns, shackle opens and the robot cheers,
// then the cell lifts away
const TURN_MS = 600;
const CHEER_MS = 1400;
const LIFT_MS = 650;

function JailCell({
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
   const keyRef = useRef<HTMLButtonElement>(null);
   const lockRef = useRef<HTMLDivElement>(null);
   const drag = useRef<{ id: number; x: number; y: number } | null>(null);
   const [phase, setPhase] = useState<Phase>('locked');
   const [offset, setOffset] = useState({ x: 0, y: 0 });
   const [dragging, setDragging] = useState(false);
   // the key is over the lock: the ring says "let go here"
   const [near, setNear] = useState(false);
   // the "Drag me" hint goes once the key's been touched, by pointer or keys
   const [touched, setTouched] = useState(false);
   // a missed drop: the lock shakes its head before the key springs back
   const [nope, setNope] = useState(false);
   const timers = useRef<number[]>([]);

   useEffect(() => {
      const root = rootRef.current;
      // the dialog takes focus, not the key, so the key only shows its focus
      // ring when someone tabs to it; no scroll, as the key sits below the
      // list on a phone
      root?.focus({ preventScroll: true });
      // Esc doesn't let you out (the key does); Tab stays inside
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
      const pending = timers.current;
      return () => {
         document.removeEventListener('keydown', onKey);
         document.body.style.overflow = prevOverflow;
         pending.forEach(clearTimeout);
      };
   }, []);

   const unlock = () => {
      if (phase !== 'locked') return;
      // snap the key's bit onto the keyhole
      const d = bitToHole();
      if (d) setOffset(o => ({ x: o.x + d.x, y: o.y + d.y }));
      setPhase('turning');
      const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
      at(TURN_MS, () => setPhase('open'));
      at(TURN_MS + CHEER_MS, () => setPhase('leaving'));
      at(TURN_MS + CHEER_MS + LIFT_MS, onDone);
   };

   /** How far the key's bit is from the keyhole, in px. */
   const bitToHole = () => {
      const key = keyRef.current?.getBoundingClientRect();
      const lock = lockRef.current?.getBoundingClientRect();
      if (!key || !lock?.width) return null;
      return {
         x: lock.left + lock.width / 2 - (key.left + key.width / 2),
         y: lock.top + lock.height * 0.72 - (key.top + key.height * 0.85),
      };
   };

   const keyOverLock = () => {
      const key = keyRef.current?.getBoundingClientRect();
      const lock = lockRef.current?.getBoundingClientRect();
      const slop = 24;
      return Boolean(
         key &&
            lock &&
            key.right > lock.left - slop &&
            key.left < lock.right + slop &&
            key.bottom > lock.top - slop &&
            key.top < lock.bottom + slop
      );
   };

   const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
      if (phase !== 'locked') return;
      drag.current = { id: e.pointerId, x: e.clientX - offset.x, y: e.clientY - offset.y };
      setDragging(true);
      setTouched(true);
      // keeps the moves coming when the pointer outruns the key
      e.currentTarget.setPointerCapture?.(e.pointerId);
   };
   const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (d?.id !== e.pointerId) return;
      const next = { x: e.clientX - d.x, y: e.clientY - d.y };
      const isNear = keyOverLock();
      setNear(isNear);
      // in range, the keyhole pulls the key's bit a third of the way in
      const pull = isNear ? bitToHole() : null;
      setOffset(
         pull
            ? {
                 x: next.x + (pull.x - (next.x - offset.x)) / 3,
                 y: next.y + (pull.y - (next.y - offset.y)) / 3,
              }
            : next
      );
   };
   const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.id !== e.pointerId) return;
      drag.current = null;
      setDragging(false);
      setNear(false);
      if (keyOverLock()) unlock();
      else {
         // a miss springs back home
         setOffset({ x: 0, y: 0 });
         setNope(true);
         timers.current.push(window.setTimeout(() => setNope(false), 400));
      }
   };

   const free = phase === 'open' || phase === 'leaving';
   return (
      <div
         ref={rootRef}
         tabIndex={-1}
         role="dialog"
         aria-modal="true"
         aria-labelledby="jail-title"
         aria-describedby="jail-why"
         className="jail fixed inset-0 z-[200] overflow-hidden outline-none"
      >
         {/* the cell's back wall, so the board doesn't show between the bars */}
         <div className="jail-scrim absolute inset-0" aria-hidden />
         <div
            className={`jail-stage absolute inset-0 flex flex-col overflow-y-auto jail-wide:block jail-wide:overflow-visible ${
               phase === 'leaving' ? 'is-leaving' : ''
            }`}
         >
            {/* the cell: the whole screen when it's wide (jail-wide in styles.css); on a phone or tablet, the part with
                the robot and the door, below the list */}
            <div className="jail-frame order-2">
               <div className="jail-scene" aria-hidden>
                  <div
                     className="jail-art jail-tally absolute"
                     style={box(CELL.tally)}
                     dangerouslySetInnerHTML={{ __html: ART.tally }}
                  />
                  <div
                     className="jail-art absolute inset-0"
                     dangerouslySetInnerHTML={{ __html: ART.back }}
                  />
                  <div
                     key={free ? 'merged' : 'jailed'}
                     className={`jail-art jail-inmate absolute ${free ? 'jail-cheer' : ''}`}
                     style={box(free ? CELL.merged : CELL.inmate)}
                     dangerouslySetInnerHTML={{ __html: free ? ART.merged : ART.inmate }}
                  />
                  <div
                     className="jail-art absolute inset-0"
                     style={{ clipPath: frontClip() }}
                     dangerouslySetInnerHTML={{ __html: ART.front }}
                  />
                  <div
                     className={`jail-ring absolute rounded-full ${dragging ? 'is-dragging' : ''} ${
                        near ? 'is-near' : ''
                     } ${phase !== 'locked' ? 'is-done' : ''}`}
                     style={box(CELL.ring)}
                  />
                  {phase === 'locked' && !dragging && (
                     <svg
                        className="jail-guide absolute"
                        style={box(CELL.guide)}
                        viewBox="0 0 30 78"
                        fill="none"
                     >
                        {/* a casing under the arrow, so it reads over the door's bar */}
                        <path d="M15 2V66M6 60L15 72L24 60" className="jail-guide-case" />
                        <path d="M15 2V66" className="jail-guide-line" />
                        <path d="M6 60L15 72L24 60" />
                     </svg>
                  )}
                  <div
                     ref={lockRef}
                     className={`jail-art jail-lock absolute ${free ? 'is-open' : ''} ${
                        near ? 'is-near' : ''
                     } ${nope ? 'is-nope' : ''} ${phase === 'locked' ? 'is-live' : ''}`}
                     style={box(CELL.lock)}
                     dangerouslySetInnerHTML={{ __html: ART.lock }}
                  />
               </div>
               {/* the key rides the same geometry as the art, outside its aria-hidden */}
               <div className="jail-scene pointer-events-none">
                  <button
                     ref={keyRef}
                     type="button"
                     aria-label="Use the key to unlock PR jail"
                     className={`jail-key ${
                        phase === 'locked' ? 'is-live' : ''
                     } pointer-events-auto absolute z-10 cursor-grab touch-none rounded-lg ${
                        dragging ? 'is-dragging cursor-grabbing' : ''
                     } ${phase !== 'locked' ? 'is-turning' : ''} ${free ? 'is-in' : ''}`}
                     style={{ ...box(CELL.key), translate: `${offset.x}px ${offset.y}px` }}
                     onPointerDown={onPointerDown}
                     onPointerMove={onPointerMove}
                     onPointerUp={onPointerUp}
                     onPointerCancel={onPointerUp}
                     // keyboard and screen readers click with detail 0; a
                     // mouse has to drag the key
                     onClick={e => e.detail === 0 && unlock()}
                     onKeyDown={() => setTouched(true)}
                  >
                     {!touched && phase === 'locked' && (
                        <span
                           aria-hidden
                           className="jail-hint pointer-events-none absolute top-[18%] left-full ml-1.5 rounded-full border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-2 shadow-sm"
                        >
                           Drag me
                        </span>
                     )}
                     <span
                        className="jail-art jail-key-art block h-full w-full"
                        dangerouslySetInnerHTML={{ __html: ART.key }}
                     />
                  </button>
               </div>
            </div>
            <section className="relative order-1 m-4 flex shrink-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-ink shadow-xl jail-wide:absolute jail-wide:top-24 jail-wide:left-[4vw] jail-wide:m-0 jail-wide:w-[26rem]">
               <div>
                  <h2 id="jail-title" className="m-0 text-lg font-semibold">
                     {free ? 'Out of PR jail' : 'PR jail'}
                  </h2>
                  <p id="jail-why" className="m-0 text-[13px] text-ink-2">
                     {jail.why}
                  </p>
               </div>
               <JailList pulls={jail.pulls} me={me} maxDays={maxDays} />
               <p className="m-0 border-t border-line pt-3 text-xs text-ink-3" aria-live="polite">
                  {free
                     ? 'Merged! You’re free.'
                     : 'Drag the key down into the lock to get out (or press Enter on it).'}
               </p>
            </section>
         </div>
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
      <div className="flex flex-col gap-3 jail-wide:max-h-[45vh] jail-wide:overflow-y-auto">
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
         <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-ink-3 jail-wide:flex-nowrap">
            <RepoRef repo={p.data.repo} number={p.data.number} />
            {move && <span className="font-medium whitespace-nowrap text-brand-700">· {move}</span>}
            {!ready && <CiGlyph pull={p} />}
            {detail && <span className="min-w-0 truncate">· {detail}</span>}
         </span>
      </li>
   );
}
