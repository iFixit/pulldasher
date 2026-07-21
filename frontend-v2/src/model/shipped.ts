import { closedEpoch } from '../format';
import type { PullData } from '../types';
import { SHIPPED_TOAST_KIND } from './cheers';
import type { Toast } from './toast';

/**
 * The "shipped while you were away" catch-up: rank merged/closed pulls by how
 * much they're yours to care about, and build the single toast that surfaces
 * it. Pure and testable, separate from toasts.tsx which renders it.
 */

export type ShipRelevance = 'yours' | 'reviewed' | null;

/** Why a shipped pull matters to you: you authored it, you stamped it (CR or
 * QA, live or since gone stale — you still touched it), or neither.
 *
 * "Shipped" means MERGED. The store's `closed` list carries every pull with
 * state 'closed', which on GitHub is merged AND closed-without-merge alike —
 * but a PR you closed unmerged never landed, so it earns no "shipped … your PR
 * landed" nudge. Gate on merged_at up front: an unmerged close is never
 * relevant, whoever authored or reviewed it. */
export function shipRelevance(p: PullData, me: string): ShipRelevance {
   if (!me || !p.merged_at) return null;
   if (p.user.login === me) return 'yours';
   const reviewed =
      p.status.allCR.some(s => s.data.user.login === me) ||
      p.status.allQA.some(s => s.data.user.login === me);
   return reviewed ? 'reviewed' : null;
}

const TIER: Record<'yours' | 'reviewed' | 'other', number> = { yours: 0, reviewed: 1, other: 2 };

/**
 * Shipped pulls ranked: yours first, then ones you reviewed, then the rest;
 * newest-closed first within each tier so the catch-up reads recent-to-old.
 */
export function rankShipped(pulls: PullData[], me: string): PullData[] {
   return [...pulls].sort((a, b) => {
      const ta = TIER[shipRelevance(a, me) ?? 'other'];
      const tb = TIER[shipRelevance(b, me) ?? 'other'];
      return ta - tb || closedEpoch(b) - closedEpoch(a);
   });
}

/**
 * Build the "shipped while you were away" toast from an already scope-filtered
 * list of closed pulls. Only pulls that are yours or that you reviewed count —
 * an org merge you never touched isn't worth a nudge. Returns the toast content
 * (tone/title/body/dedupeKey); the caller attaches onAct/onGone since only it
 * knows how to jump to the fold and mark the catch-up seen. Null when nothing
 * relevant shipped, so the caller fires no toast at all.
 */
export function shippedToast(shipped: PullData[], me: string): Toast | null {
   const relevant = shipped.filter(p => shipRelevance(p, me) !== null);
   if (relevant.length === 0) return null;
   const ranked = rankShipped(relevant, me);
   const top = ranked[0];
   const yours = relevant.filter(p => shipRelevance(p, me) === 'yours').length;
   const reviewed = relevant.length - yours;
   const n = relevant.length;
   // a stable-per-backlog key: the newest close time plus the count, so a fresh
   // merge (later epoch) fires again but the same standing backlog fires once
   const latest = relevant.reduce((mx, p) => Math.max(mx, closedEpoch(p)), 0);
   const breakdown = [yours > 0 && `${yours} yours`, reviewed > 0 && `${reviewed} you reviewed`]
      .filter(Boolean)
      .join(' · ');
   return {
      tone: 'info',
      kind: SHIPPED_TOAST_KIND,
      icon: '📦',
      title: n === 1 ? 'Shipped while you were away' : `${n} shipped while you were away`,
      body:
         n === 1
            ? shipRelevance(top, me) === 'yours'
               ? 'Your PR landed.'
               : 'One you reviewed landed.'
            : breakdown,
      // a single relevant merge gets a link to it; a batch stays a summary
      pull: n === 1 ? { repo: top.repo, number: top.number, title: top.title } : undefined,
      dedupeKey: `shipped:${latest}:${n}`,
   };
}
