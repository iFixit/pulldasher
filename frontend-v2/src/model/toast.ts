export type ToastTone = 'reward' | 'nag' | 'info';

/** How many of a batched toast's `pulls` render as links before the rest
 * fold into a "+N more" line. Shared by the toast stack and the notification
 * panel so a batched nudge lists the same number of PRs in both places. */
export const TOAST_PULLS_SHOWN = 3;

/**
 * The reusable toast contract. Both the gamified cheers evaluator
 * (model/cheers) and the shipped catch-up (model/shipped) produce these;
 * toasts.tsx renders them and owns the timers and DOM. Content is plain data;
 * the two impure hooks (onAct/onGone) are attached by the caller that knows
 * how to act on a click or a dismiss.
 */
export interface Toast {
   tone: ToastTone;
   /** which configurable kind this is, for the Settings mute check. Board-diff
    * cheers set it from their catalog entry; extras (the shipped catch-up) set
    * it too so they can be toggled off like any other toast. */
   kind?: string;
   /** a single emoji, the toast's face */
   icon: string;
   title: string;
   body?: string;
   /** hero rewards (queue cleared, a milestone) get a sparkle burst off the
    * medallion */
   celebrate?: boolean;
   /** sweep a one-shot light glint across the card — a premium sheen for a
    * reward, not the nags */
   shimmer?: boolean;
   /** a number to roll up (odometer) at the head of the title, e.g. a streak
    * count or your stamp tally */
   count?: number;
   /** the PR a toast is about: clicking scrolls its row into view (or opens it
    * on GitHub if off-screen), and the card renders its number + title as a
    * link, so a toast says WHICH pull, not just a bare #number */
   pull?: { repo: string; number: number; title?: string };
   /** for a batched toast covering more than one PR (e.g. the shipped
    * catch-up when several landed at once): the pulls it covers, ranked
    * most-relevant-first. The renderer shows the first `TOAST_PULLS_SHOWN`
    * as links and folds the rest into a "+N more" line, the same overflow
    * pattern the board's other lists use. Falls back to the singular `pull`
    * above when absent or empty. */
   pulls?: { repo: string; number: number; title?: string }[];
   /** stable id so the same logical toast isn't re-fired every board tick */
   dedupeKey?: string;
   /** per-toast lifetime override (ms); falls back to the tone default */
   ttlMs?: number;
   /** custom click action; when set, it replaces the default scroll-to-pull */
   onAct?: () => void;
   /** an explicit action button in the card (e.g. "Claim it" on a your-turn
    * nudge). The label is declarative; the caller attaches onAction, since it's
    * impure. Distinct from onAct (the whole-card click), so the card can still
    * reveal the pull while the button does something committal. */
   actionLabel?: string;
   onAction?: () => void;
   /** run once when the toast leaves for any reason (dismiss/timeout/evicted) */
   onGone?: () => void;
}
