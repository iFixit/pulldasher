import { closedEpoch } from '../format';
import type { PullData } from '../types';

/**
 * The "shipped while you were away" catch-up: rank merged/closed pulls by how
 * much they're yours to care about. Pure and testable, separate from the
 * RecentlyShipped view that renders it.
 */

export type ShipRelevance = 'yours' | 'reviewed' | null;

/** Why a shipped pull matters to you: you authored it, you stamped it (CR or
 * QA, live or since gone stale — you still touched it), or neither. */
export function shipRelevance(p: PullData, me: string): ShipRelevance {
   if (!me) return null;
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
