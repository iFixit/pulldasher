export type ToastTone = 'reward' | 'nag' | 'info';

/**
 * The reusable toast contract. Both the gamified cheers evaluator
 * (model/cheers) and the shipped catch-up (model/shipped) produce these;
 * toasts.tsx renders them and owns the timers and DOM. Content is plain data;
 * the two impure hooks (onAct/onGone) are attached by the caller that knows
 * how to act on a click or a dismiss.
 */
export interface Toast {
   tone: ToastTone;
   /** a single emoji, the toast's face */
   icon: string;
   title: string;
   body?: string;
   /** hero rewards (queue cleared, a milestone) get a spark flourish */
   celebrate?: boolean;
   /** the PR a toast is about: clicking scrolls its row into view (or opens it
    * on GitHub if off-screen), and the card renders its number + title as a
    * link, so a toast says WHICH pull, not just a bare #number */
   pull?: { repo: string; number: number; title?: string };
   /** stable id so the same logical toast isn't re-fired every board tick */
   dedupeKey?: string;
   /** per-toast lifetime override (ms); falls back to the tone default */
   ttlMs?: number;
   /** custom click action; when set, it replaces the default scroll-to-pull */
   onAct?: () => void;
   /** run once when the toast leaves for any reason (dismiss/timeout/evicted) */
   onGone?: () => void;
}
