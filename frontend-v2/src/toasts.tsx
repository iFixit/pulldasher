import { useCallback, useEffect, useRef, useState } from 'react';
import { githubUrl, rowDomId } from './format';
import {
   type CheerBaseline,
   type CheerToast,
   EMPTY_BASELINE,
   evaluateCheers,
   type ToastKind,
} from './model/cheers';
import type { DerivedPull } from './model/status';
import type { Toast, ToastTone } from './model/toast';
import { getSettings } from './settings';
import type { PullData } from './types';

/** How long a toast lingers before it auto-dismisses, by tone. Nags sit a beat
 * longer than rewards so the guilt lands; info lingers a touch longer still —
 * it's a catch-up, not a jab; neither overstays its welcome. */
const TTL_MS: Record<ToastTone, number> = { reward: 5000, nag: 7000, info: 9000 };
/** Multiplier on the base TTLs, set by the "How long they stay" preference —
 * keeps the tone ratios intact while letting someone speed them up or let them
 * breathe. */
const DWELL: Record<'brief' | 'normal' | 'relaxed', number> = {
   brief: 0.6,
   normal: 1,
   relaxed: 1.6,
};
/** Time for the leave animation before the node is removed. */
const LEAVE_MS = 200;
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
      body: 'alice reviewed yours — return the favor',
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
      body: 'XS/S — small ones, unclaimed.',
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
      icon: '🏆',
      title: 'Top reviewer on the board',
      body: "9 stamps in view — nobody's ahead of you.",
      celebrate: true,
   },
   {
      tone: 'reward',
      icon: '🚀',
      title: 'Green — ship it',
      body: 'CR + QA both cleared.',
      pull: { repo: 'org/repo', number: 77, title: 'Migrate the cart to the new checkout' },
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
   },
   {
      tone: 'nag',
      icon: '⏳',
      title: 'Your turn on this',
      body: 'Waiting 6d — the rotation picked you.',
      pull: { repo: 'org/repo', number: 5, title: 'Discourage new files in Exec/ dir' },
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
   onQuickWins?: () => void
) {
   const [toasts, setToasts] = useState<LiveToast[]>([]);
   const [history, setHistory] = useState<ToastRecord[]>([]);
   const baseline = useRef<CheerBaseline>(EMPTY_BASELINE);
   const nextId = useRef(0);
   const histId = useRef(0);
   const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
   const toastsRef = useRef<LiveToast[]>([]);
   const firedKeys = useRef<Set<string>>(new Set());

   useEffect(() => {
      toastsRef.current = toasts;
   }, [toasts]);

   const remove = useCallback((id: number) => {
      const gone = toastsRef.current.find(t => t.id === id);
      gone?.onGone?.();
      setToasts(list => list.filter(t => t.id !== id));
      const t = timers.current.get(id);
      if (t) {
         clearTimeout(t);
         timers.current.delete(id);
      }
   }, []);

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
            // drop the oldest beyond the cap (dismiss them so their timers clear)
            while (merged.length > MAX_VISIBLE) {
               const [oldest, ...rest] = merged;
               const t = timers.current.get(oldest.id);
               if (t) clearTimeout(t);
               timers.current.delete(oldest.id);
               merged = rest;
            }
            const dwell = DWELL[getSettings().cheerDwell];
            for (const t of added) {
               timers.current.set(
                  t.id,
                  setTimeout(() => dismiss(t.id), t.ttlMs ?? TTL_MS[t.tone] * dwell)
               );
            }
            return merged;
         });
      },
      [dismiss]
   );

   useEffect(() => {
      const on = getSettings().cheers;
      const { toasts: fresh, next } = evaluateCheers(
         {
            pulls,
            closed,
            me,
            claims,
            now: Date.now(),
            claimWarnMs: getSettings().claimWarnMins * 60_000,
            muted: new Set(getSettings().mutedCheers as ToastKind[]),
         },
         baseline.current
      );
      baseline.current = next;
      // quick-wins is a batch, not one pull: swap its scroll-to-pull for the
      // filter action so clicking shows every small review, not just the first
      const bound = fresh.map(t =>
         t.dedupeKey?.startsWith('quick:') && onQuickWins
            ? { ...t, pull: undefined, onAct: onQuickWins }
            : t
      );
      if (on) push(bound);
   }, [pulls, closed, me, claims, push, onQuickWins]);

   // pre-built one-shot toasts from the caller (e.g. the shipped catch-up),
   // deduped by dedupeKey so the same logical toast never re-fires on a later
   // tick — not gated by the cheers setting, since this is informational, not
   // gamification.
   useEffect(() => {
      const fresh = extras.filter(t => t.dedupeKey && !firedKeys.current.has(t.dedupeKey));
      for (const t of fresh) firedKeys.current.add(t.dedupeKey as string);
      if (fresh.length) push(fresh);
   }, [extras, push]);

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

function Sparks() {
   // three sparks drift up and out from behind the medallion on a hero reward
   return (
      <span aria-hidden className="pointer-events-none absolute -top-1 left-2 h-0 w-0">
         <span
            className="spark absolute block h-1 w-1 rounded-full bg-brand"
            style={{ '--dx': '-10px' } as React.CSSProperties}
         />
         <span
            className="spark absolute block h-1 w-1 rounded-full bg-brand-700"
            style={{ '--dx': '8px', animationDelay: '80ms' } as React.CSSProperties}
         />
         <span
            className="spark absolute block h-1.5 w-1.5 rounded-full bg-brand"
            style={{ '--dx': '-2px', animationDelay: '160ms' } as React.CSSProperties}
         />
      </span>
   );
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
         className={`toast-card group pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border px-3.5 py-3 shadow-lg ${tone} ${
            toast.leaving ? 'toast-leave' : 'toast-enter'
         } ${clickable ? 'cursor-pointer transition-[background-color] hover:brightness-[0.98]' : ''}`}
         role="status"
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
            {toast.celebrate && <Sparks />}
            <span aria-hidden>{toast.icon}</span>
         </span>
         <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug font-semibold text-ink">{toast.title}</span>
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
