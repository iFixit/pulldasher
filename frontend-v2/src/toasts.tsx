import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { githubUrl, rowDomId } from './format';
import {
   type CheerBaseline,
   type CheerToast,
   EMPTY_BASELINE,
   evaluateCheers,
   reviveBaseline,
   serializeBaseline,
   type ToastKind,
} from './model/cheers';
import type { DerivedPull } from './model/status';
import type { Toast } from './model/toast';
import { getSettings } from './settings';
import type { PullData } from './types';

/** Time for the leave animation before the node is removed. */
const LEAVE_MS = 200;

/**
 * Per-tab memory of what's already been shown, so reloading the page doesn't
 * re-prime from scratch and replay every load-time greeting. sessionStorage
 * (not localStorage) on purpose: it survives a reload but not a brand-new tab,
 * so a genuinely fresh session still gets its one catch-up. Keyed by viewer so
 * switching accounts in the same tab starts clean.
 */
const SESSION_KEY = 'pd2.cheers.session';

interface CheerSession {
   baseline: CheerBaseline;
   /** dedupeKeys of one-shot `extras` (e.g. the shipped catch-up) already fired */
   fired: string[];
}

function loadCheerSession(me: string): CheerSession | null {
   try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as { me?: string; baseline?: unknown; fired?: unknown };
      if (saved.me !== me) return null;
      const baseline = reviveBaseline(saved.baseline);
      if (!baseline) return null;
      return { baseline, fired: Array.isArray(saved.fired) ? (saved.fired as string[]) : [] };
   } catch {
      return null;
   }
}

function saveCheerSession(me: string, baseline: CheerBaseline, fired: Set<string>) {
   // never persist under an empty viewer: whoami resolves a tick after the
   // first render, and a me='' save would clobber the real session so the
   // hydrate that follows can't find it (and re-primes, replaying greetings).
   if (!me) return;
   try {
      sessionStorage.setItem(
         SESSION_KEY,
         JSON.stringify({ me, baseline: serializeBaseline(baseline), fired: [...fired] })
      );
   } catch {
      // sessionStorage can be unavailable (private mode, quota); losing the
      // replay guard is a soft failure, not worth interrupting the board.
   }
}
/** Most toasts on screen at once; a fourth pushes the oldest out early. */
const MAX_VISIBLE = 3;
/** How many past nudges the notification panel keeps — toasts are non-sticky
 * and session-only, but they shouldn't vanish for good the moment they fade. */
const HISTORY_CAP = 40;

/** A fired toast kept for the notification panel: the toast itself plus when it
 * fired (ms epoch), so a dismissed nudge stays recoverable. */
export interface ToastRecord {
   id: number;
   toast: Toast;
   at: number;
}

/** Dev-only samples for previewing the toast visuals (see the __pdCheers hook
 * below) — one of every tone/kind, so the whole catalog is QA-able against the
 * static dummy board. Call window.__pdCheers() to fire the lot (the stack caps
 * at MAX_VISIBLE, so they cycle). */
const SAMPLE_CHEERS: CheerToast[] = [
   {
      tone: 'info',
      icon: '🎯',
      title: 'Start here',
      body: 'alice reviewed yours, return the favor',
      pull: { repo: 'org/repo', number: 88, title: 'Cache device images at the edge' },
   },
   {
      tone: 'info',
      icon: '🤝',
      title: 'Return the favor to alice',
      body: "They've reviewed 3 of your PRs.",
      pull: { repo: 'org/repo', number: 90, title: 'Add a retry to the webhook sender' },
   },
   {
      tone: 'info',
      icon: '⚡',
      title: '4 quick reviews on the board',
      body: 'XS/S: small ones, unclaimed.',
   },
   {
      tone: 'info',
      icon: '✦',
      title: 'Review requested',
      body: 'alice asked you to review this.',
      pull: { repo: 'org/repo', number: 91, title: 'Rework the offer-sync batch loop' },
   },
   {
      tone: 'reward',
      icon: '🔥',
      title: 'reviews this sitting',
      count: 5,
      body: 'Good pace.',
      celebrate: true,
   },
   {
      tone: 'reward',
      icon: '🏆',
      title: 'stamps in view',
      count: 9,
      body: "Top of the board, nobody's ahead of you.",
      celebrate: true,
      shimmer: true,
   },
   {
      tone: 'reward',
      icon: '🎉',
      title: 'Inbox zero',
      body: "Nothing's waiting on you.",
      celebrate: true,
      shimmer: true,
   },
   {
      tone: 'reward',
      icon: '🚀',
      title: 'Green, ship it',
      body: 'CR + QA both cleared.',
      pull: { repo: 'org/repo', number: 77, title: 'Migrate the cart to the new checkout' },
      celebrate: true,
      shimmer: true,
   },
   {
      tone: 'nag',
      icon: '🔁',
      title: 'Changed since your ✓',
      body: 'Give it another look?',
      pull: { repo: 'org/repo', number: 7, title: 'Fix the flaky device-picker test' },
   },
   {
      tone: 'reward',
      icon: '✅',
      title: 'Nice one.',
      body: 'CR landed',
      pull: { repo: 'org/repo', number: 412, title: 'Regulate the type of Response' },
   },
   {
      tone: 'reward',
      icon: '🎊',
      title: "Board's clear",
      body: 'Nothing waiting on anyone.',
      celebrate: true,
      shimmer: true,
   },
   {
      tone: 'nag',
      icon: '⏳',
      title: 'Your turn to review',
      body: "Waiting 6d with nobody on it; you're the best fit. Claim it?",
      pull: { repo: 'org/repo', number: 5, title: 'Discourage new files in Exec/ dir' },
      actionLabel: 'Claim it',
      onAction: () => undefined,
   },
];

interface LiveToast extends Toast {
   id: number;
   leaving?: boolean;
}

/**
 * The gamification watcher: diffs each board snapshot against the last (all the
 * transition logic lives in the pure model/cheers evaluator) and surfaces the
 * resulting rewards and nags as transient toasts. Unlike desktop notifications,
 * these fire while the tab is focused — that's the whole point, they're the
 * in-the-moment feedback loop for someone actually working the board. Off by
 * the `cheers` setting; when off, the baseline still primes so flipping it on
 * mid-session doesn't replay the backlog.
 */
export function useToasts(
   pulls: DerivedPull[],
   me: string,
   claims: Readonly<Record<string, { login: string; at: number }>> = {},
   extras: Toast[] = [],
   closed: PullData[] = [],
   /** clicking the quick-wins toast filters the board to the small ones rather
    * than scrolling to a single pull — a batch nudge wants a batch view */
   onQuickWins?: () => void,
   /** the your-turn toast's "Claim it" button claims that review (which also
    * adds you as a GitHub reviewer) — bound here since claiming is impure */
   onClaimTurn?: (repo: string, number: number) => void,
   /** the board's first data has arrived. While false the board is still
    * loading (an empty snapshot), and diffing that against a primed baseline
    * would fire phantom "Board's clear" / "Inbox zero" and count every stamp
    * as newly landed — so hold every evaluation until it's true. */
   ready = true
) {
   const [toasts, setToasts] = useState<LiveToast[]>([]);
   const [history, setHistory] = useState<ToastRecord[]>([]);
   const baseline = useRef<CheerBaseline>(EMPTY_BASELINE);
   const nextId = useRef(0);
   const histId = useRef(0);
   const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
   const toastsRef = useRef<LiveToast[]>([]);
   const firedKeys = useRef<Set<string>>(new Set());
   const hydrated = useRef(false);

   useEffect(() => {
      toastsRef.current = toasts;
   }, [toasts]);

   // Rehydrate per-tab memory before any firing effect runs (this is declared
   // above them, so on mount it runs first). A reload then resumes the diff
   // against where the last tick left off, instead of re-priming from
   // EMPTY_BASELINE and replaying every load-time greeting.
   useEffect(() => {
      if (hydrated.current || !me) return;
      const saved = loadCheerSession(me);
      if (saved) {
         baseline.current = saved.baseline;
         firedKeys.current = new Set(saved.fired);
      }
      hydrated.current = true;
   }, [me]);

   // onGone must fire exactly once however a toast leaves — remove() covers
   // dismissal, push()'s cap eviction covers overflow; the set keeps the two
   // paths (and StrictMode's double-invoked updaters) from firing it twice
   const goneFired = useRef(new Set<number>());
   const fireOnGone = useCallback((t: Toast & { id: number }) => {
      if (goneFired.current.has(t.id)) return;
      goneFired.current.add(t.id);
      t.onGone?.();
   }, []);

   const remove = useCallback(
      (id: number) => {
         const gone = toastsRef.current.find(t => t.id === id);
         if (gone) fireOnGone(gone);
         setToasts(list => list.filter(t => t.id !== id));
         const t = timers.current.get(id);
         if (t) {
            clearTimeout(t);
            timers.current.delete(id);
         }
      },
      [fireOnGone]
   );

   const dismiss = useCallback(
      (id: number) => {
         // two-phase: mark leaving so the card animates out, then unmount
         setToasts(list => list.map(t => (t.id === id ? { ...t, leaving: true } : t)));
         const prev = timers.current.get(id);
         if (prev) clearTimeout(prev);
         timers.current.set(
            id,
            setTimeout(() => remove(id), LEAVE_MS)
         );
      },
      [remove]
   );

   // panel controls: wipe the whole log, or drop one entry
   const clearHistory = useCallback(() => setHistory([]), []);
   const dismissHistoryItem = useCallback(
      (id: number) => setHistory(h => h.filter(r => r.id !== id)),
      []
   );

   const push = useCallback(
      (fresh: Toast[]) => {
         if (fresh.length === 0) return;
         // keep every fired nudge for the panel, newest first — separate id
         // space from the live stack, since the panel outlives the toast
         const firedAt = Date.now();
         const records = fresh.map(t => ({ id: histId.current++, toast: t, at: firedAt }));
         setHistory(h => [...records, ...h].slice(0, HISTORY_CAP));
         setToasts(list => {
            const added = fresh.map(t => ({ ...t, id: nextId.current++ }));
            let merged = [...list, ...added];
            // drop the oldest beyond the cap — clearing its timer AND firing
            // its onGone, exactly like a dismissal would ("shipped while you
            // were away" wires onGone to advance the read-state; a silent
            // eviction must not strand it unread forever)
            while (merged.length > MAX_VISIBLE) {
               const [oldest, ...rest] = merged;
               const t = timers.current.get(oldest.id);
               if (t) clearTimeout(t);
               timers.current.delete(oldest.id);
               fireOnGone(oldest);
               merged = rest;
            }
            // 'sticky' means no auto-dismiss timer: the toast waits for a
            // manual dismiss (or eviction once the stack overflows the cap).
            const dwell = getSettings().cheerDwell;
            // a number auto-dismisses after that many ms; 'sticky' (or any
            // unexpected legacy value) means no timer at all
            const auto = typeof dwell === 'number' ? dwell : null;
            for (const t of added) {
               const ttl = t.ttlMs ?? auto;
               if (ttl != null) {
                  timers.current.set(
                     t.id,
                     setTimeout(() => dismiss(t.id), ttl)
                  );
               }
            }
            return merged;
         });
      },
      [dismiss]
   );

   useEffect(() => {
      const on = getSettings().cheers;
      // `ready` gates the evaluation inside the model: while the board is still
      // loading (an empty snapshot) it no-ops and carries the baseline, so a
      // primed baseline never fires phantom cleared/inbox-zero or miscounts
      // stamps against empty data.
      const { toasts: fresh, next } = evaluateCheers(
         {
            pulls,
            closed,
            me,
            claims,
            now: Date.now(),
            claimWarnMs: getSettings().claimWarnMins * 60_000,
            muted: new Set(getSettings().mutedCheers as ToastKind[]),
            ready,
         },
         baseline.current
      );
      baseline.current = next;
      // only persist once loaded, so a load-time tick can't overwrite the saved
      // session with a not-yet-hydrated baseline
      if (ready) saveCheerSession(me, next, firedKeys.current);
      // bind the impure actions the pure evaluator can't: quick-wins filters
      // the board to the small ones (a batch nudge wants a batch view), and the
      // your-turn nudge's "Claim it" button claims that review in place.
      const bound = fresh.map(t => {
         if (t.dedupeKey?.startsWith('quick:') && onQuickWins)
            return { ...t, pull: undefined, onAct: onQuickWins };
         if (t.dedupeKey?.startsWith('turn:') && onClaimTurn && t.pull) {
            const { repo, number } = t.pull;
            return { ...t, onAction: () => onClaimTurn(repo, number) };
         }
         return t;
      });
      if (on) push(bound);
   }, [ready, pulls, closed, me, claims, push, onQuickWins, onClaimTurn]);

   // pre-built one-shot toasts from the caller (e.g. the shipped catch-up),
   // deduped by dedupeKey so the same logical toast never re-fires on a later
   // tick. Gated by the master cheers switch and each toast's own per-kind mute
   // (Settings), same as the board-diff cheers — a muted extra is still marked
   // fired so it can't replay a stale catch-up if unmuted later this session.
   useEffect(() => {
      if (!ready || !getSettings().cheers) return;
      const fresh = extras.filter(t => t.dedupeKey && !firedKeys.current.has(t.dedupeKey));
      if (!fresh.length) return;
      for (const t of fresh) firedKeys.current.add(t.dedupeKey as string);
      const muted = new Set(getSettings().mutedCheers);
      const show = fresh.filter(t => !(t.kind && muted.has(t.kind)));
      if (show.length) push(show);
      saveCheerSession(me, baseline.current, firedKeys.current);
   }, [ready, extras, push, me]);

   // Dev-only preview handle: with the dummy backend the board is static, so
   // there are no live transitions to fire cheers off. Expose a way to conjure
   // samples from the console (window.__pdCheers()) so the toast visuals are
   // QA-able. Stripped from production builds by the import.meta.env.DEV guard.
   useEffect(() => {
      if (!import.meta.env.DEV) return;
      (window as unknown as { __pdCheers?: (t?: CheerToast[]) => void }).__pdCheers = t =>
         push(t ?? SAMPLE_CHEERS);
      return () => {
         delete (window as unknown as { __pdCheers?: unknown }).__pdCheers;
      };
   }, [push]);

   // clear every pending timer on unmount
   useEffect(() => {
      const map = timers.current;
      return () => {
         for (const t of map.values()) clearTimeout(t);
         map.clear();
      };
   }, []);

   return { toasts, dismiss, history, clearHistory, dismissHistoryItem };
}

const SPARK_TINTS = ['bg-brand', 'bg-brand-700', 'bg-warn'];
/** A ring of glints that fly out from the medallion and fade — the hero
 * reward's flourish. Angles/distances are picked once so the burst is stable
 * across the card's re-renders. */
function SparkleBurst() {
   const sparks = useMemo(
      () =>
         Array.from({ length: 11 }, (_, i) => {
            const angle = (i / 11) * Math.PI * 2 + Math.random() * 0.4;
            const dist = 20 + Math.random() * 16;
            return {
               dx: Math.round(Math.cos(angle) * dist),
               dy: Math.round(Math.sin(angle) * dist),
               delay: Math.round(Math.random() * 90),
               big: Math.random() < 0.4,
               tint: SPARK_TINTS[i % SPARK_TINTS.length],
            };
         }),
      []
   );
   return (
      <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
         {sparks.map((s, i) => (
            <span
               // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative burst
               key={i}
               className={`sparkle absolute block rounded-full ${s.tint} ${s.big ? 'h-1.5 w-1.5' : 'h-1 w-1'}`}
               style={
                  {
                     '--dx': `${s.dx}px`,
                     '--dy': `${s.dy}px`,
                     animationDelay: `${s.delay}ms`,
                  } as React.CSSProperties
               }
            />
         ))}
      </span>
   );
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
/** Rolls a number up from 0 to `value` once, ~600ms. Jumps straight to the
 * value under reduced motion. */
function Odometer({ value }: { value: number }) {
   const reduced =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
   const [shown, setShown] = useState(reduced ? value : 0);
   useEffect(() => {
      if (reduced) {
         setShown(value);
         return;
      }
      let raf = 0;
      const start = performance.now();
      const step = (now: number) => {
         const p = Math.min(1, (now - start) / 600);
         setShown(Math.round(value * easeOutCubic(p)));
         if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
   }, [value, reduced]);
   return <span className="tabular-nums">{shown}</span>;
}

/** Take the viewer to a toast's pull: scroll its row in and flash it, matching
 * how deal-me-one lands you on a dealt pull. If the row isn't currently on
 * screen — filtered out, in a collapsed fold, or on another lens — open the PR
 * on GitHub instead, the one destination that always works, rather than
 * scrolling to nothing. */
function revealPull(pull: { repo: string; number: number }) {
   const el = document.getElementById(rowDomId(pull));
   if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('fold-flash');
      setTimeout(() => el.classList.remove('fold-flash'), 900);
   } else {
      window.open(githubUrl(pull.repo, pull.number), '_blank', 'noopener');
   }
}

function ToastCard({ toast, onDismiss }: { toast: LiveToast; onDismiss: (id: number) => void }) {
   const reward = toast.tone === 'reward';
   const info = toast.tone === 'info';
   const clickable = !!toast.pull || !!toast.onAct;

   const act = () => {
      if (toast.onAct) {
         toast.onAct();
      } else if (toast.pull) {
         revealPull(toast.pull);
      }
      onDismiss(toast.id);
   };

   const tone = reward
      ? 'border-brand-100 bg-surface ring-1 ring-brand/15'
      : info
        ? 'border-brand-100 bg-surface'
        : 'border-line bg-muted';
   const medallion = reward
      ? 'bg-brand-50 text-brand medallion-pop'
      : info
        ? 'bg-brand-50 text-brand'
        : 'bg-secondary text-ink-2 medallion-slump';

   return (
      <div
         className={`group pointer-events-auto relative flex items-start gap-3 rounded-xl border px-3.5 py-3 shadow-lg ${tone} ${
            toast.leaving ? 'toast-leave' : 'toast-enter'
         } ${clickable ? 'cursor-pointer transition-[background-color] hover:brightness-[0.98]' : ''}`}
         // a clickable card is a button to the keyboard/screen reader; the
         // polite live region still announces either way
         role={clickable ? 'button' : 'status'}
         aria-live="polite"
         {...(clickable
            ? {
                 tabIndex: 0,
                 onClick: act,
                 onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                       e.preventDefault();
                       act();
                    }
                 },
              }
            : {})}
      >
         <span
            className={`relative grid h-8 w-8 flex-none place-items-center rounded-full text-base ${medallion}`}
         >
            {toast.celebrate && <SparkleBurst />}
            <span aria-hidden>{toast.icon}</span>
         </span>
         <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug font-semibold text-ink">
               {toast.count != null && (
                  <>
                     <Odometer value={toast.count} />{' '}
                  </>
               )}
               {toast.title}
            </span>
            {toast.pull && (
               <a
                  href={githubUrl(toast.pull.repo, toast.pull.number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="mt-0.5 block truncate text-xs font-medium text-brand hover:underline"
               >
                  #{toast.pull.number}
                  {toast.pull.title ? ` ${toast.pull.title}` : ''}
               </a>
            )}
            {toast.body && (
               <span className="mt-0.5 line-clamp-2 block text-xs text-ink-2">{toast.body}</span>
            )}
            {toast.actionLabel && toast.onAction && (
               <button
                  type="button"
                  onClick={e => {
                     e.stopPropagation();
                     toast.onAction?.();
                     onDismiss(toast.id);
                  }}
                  className="pressable mt-2 inline-flex items-center rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-surface hover:bg-brand-700"
               >
                  {toast.actionLabel}
               </button>
            )}
         </span>
         <button
            type="button"
            aria-label="dismiss"
            className="hit pressable -m-1 flex-none rounded p-1 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
            onClick={e => {
               e.stopPropagation();
               onDismiss(toast.id);
            }}
         >
            <svg
               viewBox="0 0 16 16"
               className="h-3.5 w-3.5"
               fill="none"
               stroke="currentColor"
               strokeWidth="1.75"
            >
               <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
         </button>
         {toast.shimmer && (
            // the sweep gets its own clipping layer instead of overflow-hidden
            // on the whole card, so the sparkle burst (which flies past the
            // card edge by design) never gets cropped mid-celebration
            <span
               aria-hidden
               className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
            >
               <span
                  className="toast-shine absolute inset-y-0 left-0 w-2/3"
                  style={{
                     background:
                        'linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.4) 50%, transparent 58%)',
                  }}
               />
            </span>
         )}
      </div>
   );
}

/** The fixed stack in the corner. Newest sits nearest the corner; older ones
 * ride above it. pointer-events-none on the container so the empty gaps don't
 * eat clicks meant for the board behind them. */
export function ToastStack({
   toasts,
   onDismiss,
}: {
   toasts: LiveToast[];
   onDismiss: (id: number) => void;
}) {
   if (toasts.length === 0) return null;
   return (
      <div
         className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 sm:right-6 sm:bottom-6"
         aria-label="review nudges"
      >
         {toasts.map(t => (
            <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
         ))}
      </div>
   );
}
