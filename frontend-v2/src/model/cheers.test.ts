import { describe, expect, it } from 'vitest';
import { pullKey } from '../format';
import {
   type AuthorPrState,
   type CheerBaseline,
   diffCheers,
   EMPTY_BASELINE,
   type Signals,
   startHereReason,
} from './cheers';
import type { DerivedPull, Weight } from './status';

/** A pull carrying only the fields diffCheers/startHereReason read off it. */
function pull(
   repo: string,
   number: number,
   o: {
      author?: string;
      crBy?: string[];
      qaBy?: string[];
      recrBy?: string[];
      reqaBy?: string[];
      ageDays?: number;
      weight?: Weight;
      sizeKnown?: boolean;
      status?: DerivedPull['status'];
      conflict?: boolean;
      starved?: boolean;
   } = {}
): DerivedPull {
   return {
      data: {
         repo,
         number,
         user: { login: o.author ?? 'author' },
         status: { cr_req: 1, qa_req: 1, allCR: [], allQA: [] },
      },
      crBy: o.crBy ?? [],
      qaBy: o.qaBy ?? [],
      recrBy: o.recrBy ?? [],
      reqaBy: o.reqaBy ?? [],
      ageDays: o.ageDays ?? 1,
      weight: o.weight ?? 'M',
      sizeKnown: o.sizeKnown ?? true,
      status: o.status ?? 'needs_cr',
      conflict: o.conflict ?? false,
      starved: o.starved ?? false,
   } as unknown as DerivedPull;
}

/** Build a Signals, defaulting review to the queue size when unspecified. */
function sig(o: Partial<Signals> & { queue?: number; pulls?: DerivedPull[] } = {}): Signals {
   const byKey = new Map((o.pulls ?? []).map(p => [pullKey(p.data), p]));
   const queue = o.queue ?? 0;
   return {
      stamped: o.stamped ?? new Set(),
      queue,
      review: o.review ?? queue,
      qa: o.qa ?? 0,
      boardReviewable: o.boardReviewable ?? o.review ?? queue,
      restampKeys: o.restampKeys ?? new Set(),
      turns: o.turns ?? new Map(),
      byKey: o.byKey ?? byKey,
      quickWinCount: o.quickWinCount ?? 0,
      quickWinPull: o.quickWinPull ?? null,
      bestStart: o.bestStart ?? null,
      startReason: o.startReason ?? '',
      backlog: o.backlog ?? 0,
      debtors: o.debtors ?? [],
      authorPrs: o.authorPrs ?? new Map(),
      myRank: o.myRank ?? 0,
      myCount: o.myCount ?? 0,
      peerBelow: o.peerBelow ?? null,
      staleClaims: o.staleClaims ?? new Map(),
      requestedOfMe: o.requestedOfMe ?? new Map(),
   };
}

/** Prime a baseline off a starting snapshot (the real first-tick flow). */
function primed(start: Signals, me = 'me'): CheerBaseline {
   const { next } = diffCheers(start, me, EMPTY_BASELINE);
   return next;
}

const prState = (o: Partial<AuthorPrState> = {}): AuthorPrState => ({
   green: false,
   reviewed: false,
   conflict: false,
   starved: false,
   ...o,
});

describe('diffCheers — priming', () => {
   it('fires nothing on the first (unprimed) tick when there is no backlog, and marks primed', () => {
      const p = pull('org/a', 1, { crBy: ['me'] });
      const { toasts, next } = diffCheers(
         sig({ stamped: new Set([pullKey(p.data)]), pulls: [p], queue: 4 }),
         'me',
         EMPTY_BASELINE
      );
      expect(toasts).toEqual([]);
      expect(next.primed).toBe(true);
      // adopts the standing world so a reload never replays it
      expect(next.stamped.has('org/a#1')).toBe(true);
      expect(next.queue).toBe(4);
      expect(next.nagLevel).toBe(3);
   });

   it('primes silently except for start-here', () => {
      const owed = pull('org/a', 1, { ageDays: 3 });
      const startPull = pull('org/b', 2, { ageDays: 9 });
      const { toasts } = diffCheers(
         sig({
            queue: 5,
            review: 5,
            restampKeys: new Set([pullKey(owed.data)]),
            turns: new Map([[pullKey(owed.data), owed]]),
            quickWinCount: 4,
            bestStart: startPull,
            backlog: 1,
            startReason: 'Waiting 9d, the oldest on your plate',
         }),
         'me',
         EMPTY_BASELINE
      );
      expect(toasts).toHaveLength(1);
      expect(toasts[0].dedupeKey).toBe(`start:${pullKey(startPull.data)}`);
   });

   it('stays unprimed with no viewer', () => {
      const { next } = diffCheers(sig({ queue: 5 }), '', EMPTY_BASELINE);
      expect(next.primed).toBe(false);
   });
});

describe('diffCheers — rewards', () => {
   it('celebrates a stamp that just landed and counts it', () => {
      const base = primed(sig());
      const p = pull('org/a', 7, { crBy: ['me'] });
      const { toasts, next } = diffCheers(
         sig({ stamped: new Set([pullKey(p.data)]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts).toHaveLength(1);
      expect(toasts[0].tone).toBe('reward');
      expect(toasts[0].pull).toEqual({ repo: 'org/a', number: 7 });
      expect(next.sessionStamps).toBe(1);
   });

   it('distinguishes a QA stamp from a CR stamp', () => {
      const base = primed(sig());
      const p = pull('org/a', 7, { qaBy: ['me'] });
      const { toasts } = diffCheers(
         sig({ stamped: new Set([pullKey(p.data)]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts[0].body).toContain('QA');
   });

   it('does not refire the same stamp on a repeat tick', () => {
      const base = primed(sig());
      const p = pull('org/a', 7, { crBy: ['me'] });
      const stamped = new Set([pullKey(p.data)]);
      const first = diffCheers(sig({ stamped, pulls: [p] }), 'me', base);
      const second = diffCheers(sig({ stamped, pulls: [p] }), 'me', first.next);
      expect(second.toasts).toEqual([]);
   });

   it('fires the hero when the queue clears', () => {
      const base = primed(sig({ queue: 2 }));
      const { toasts } = diffCheers(sig({ queue: 0 }), 'me', base);
      expect(toasts.some(t => t.tone === 'reward' && t.celebrate && t.title === 'Inbox zero')).toBe(
         true
      );
   });

   it('celebrates a milestone once', () => {
      let base = primed(sig());
      // land three stamps across three ticks
      for (let i = 1; i <= 3; i++) {
         const stamped = new Set<string>();
         const pulls: DerivedPull[] = [];
         for (let j = 1; j <= i; j++) {
            const p = pull('org/a', j, { crBy: ['me'] });
            stamped.add(pullKey(p.data));
            pulls.push(p);
         }
         const r = diffCheers(sig({ stamped, pulls }), 'me', base);
         base = r.next;
         if (i === 3) {
            expect(r.toasts.some(t => t.icon === '🔥' && t.celebrate)).toBe(true);
         }
      }
      // a fourth tick at the same count doesn't re-fire the 3-milestone
      const again = diffCheers(
         sig({
            stamped: new Set(['org/a#1', 'org/a#2', 'org/a#3']),
            pulls: [
               pull('org/a', 1, { crBy: ['me'] }),
               pull('org/a', 2, { crBy: ['me'] }),
               pull('org/a', 3, { crBy: ['me'] }),
            ],
         }),
         'me',
         base
      );
      expect(again.toasts.some(t => t.icon === '🔥')).toBe(false);
   });
});

describe('diffCheers — your-turn', () => {
   it('nags a turn once, then forgets it once it is no longer yours', () => {
      const base = primed(sig());
      const p = pull('org/a', 9, { ageDays: 4 });
      const turns = new Map([[pullKey(p.data), p]]);
      const first = diffCheers(sig({ turns }), 'me', base);
      expect(first.toasts.some(t => t.icon === '⏳' && t.pull?.number === 9)).toBe(true);
      // still yours next tick: no repeat
      const second = diffCheers(sig({ turns }), 'me', first.next);
      expect(second.toasts.some(t => t.icon === '⏳')).toBe(false);
      // leaves, then comes back: nags again
      const gone = diffCheers(sig(), 'me', second.next);
      const back = diffCheers(sig({ turns }), 'me', gone.next);
      expect(back.toasts.some(t => t.icon === '⏳')).toBe(true);
   });
});

describe('diffCheers — start-here', () => {
   it('does not fire on a prime tick with no backlog', () => {
      const { toasts } = diffCheers(sig({ backlog: 0, bestStart: null }), 'me', EMPTY_BASELINE);
      expect(toasts).toEqual([]);
   });

   it('re-fires only after the backlog drains to zero and comes back', () => {
      const p = pull('org/a', 1, { ageDays: 5 });
      const withBacklog = sig({ backlog: 1, bestStart: p, startReason: 'reason' });

      const primeResult = diffCheers(withBacklog, 'me', EMPTY_BASELINE);
      expect(primeResult.toasts).toHaveLength(1);
      expect(primeResult.toasts[0].dedupeKey).toBe(`start:${pullKey(p.data)}`);

      // backlog persists: no repeat
      const still = diffCheers(withBacklog, 'me', primeResult.next);
      expect(still.toasts.some(t => t.dedupeKey?.startsWith('start:'))).toBe(false);

      // backlog drains
      const drained = diffCheers(sig({ backlog: 0, bestStart: null }), 'me', still.next);
      expect(drained.toasts.some(t => t.dedupeKey?.startsWith('start:'))).toBe(false);

      // backlog returns: fires again
      const back = diffCheers(withBacklog, 'me', drained.next);
      expect(back.toasts.some(t => t.dedupeKey === `start:${pullKey(p.data)}`)).toBe(true);
   });
});

describe('startHereReason — priority order', () => {
   it('prioritizes reciprocity over everything else', () => {
      const target = pull('org/a', 1, { author: 'alice', ageDays: 10, weight: 'XS' });
      const mine = pull('org/a', 2, { author: 'me', crBy: ['alice'] });
      expect(startHereReason(target, [target, mine], 'me')).toBe(
         'alice reviewed yours — return the favor'
      );
   });

   it('falls back to familiarity when there is no reciprocity', () => {
      const target = pull('org/a', 1, { author: 'alice', weight: 'XS' });
      const familiarPull = pull('org/a', 2, { crBy: ['me'] });
      expect(startHereReason(target, [target, familiarPull], 'me')).toBe(
         'You know a — less to load in'
      );
   });

   it('falls back to a quick-win when unfamiliar and no reciprocity', () => {
      const target = pull('org/b', 1, { author: 'alice', weight: 'XS', sizeKnown: true });
      expect(startHereReason(target, [target], 'me')).toBe('Small one (XS) — quick');
   });

   it('falls back to urgency when nothing else applies', () => {
      const target = pull('org/c', 1, {
         author: 'alice',
         weight: 'M',
         sizeKnown: true,
         ageDays: 7,
      });
      expect(startHereReason(target, [target], 'me')).toBe('Waiting 7d, the oldest on your plate');
   });
});

describe('diffCheers — re-stamp-owed', () => {
   it('fires once per newly-owed pull, then stays silent', () => {
      const base = primed(sig());
      const p = pull('org/a', 5);
      const restampKeys = new Set([pullKey(p.data)]);
      const first = diffCheers(sig({ restampKeys, pulls: [p] }), 'me', base);
      expect(first.toasts.some(t => t.dedupeKey === 'recr:org/a#5')).toBe(true);
      const second = diffCheers(sig({ restampKeys, pulls: [p] }), 'me', first.next);
      expect(second.toasts.some(t => t.dedupeKey === 'recr:org/a#5')).toBe(false);
   });

   it('fires a separate toast per pull, one per key', () => {
      const base = primed(sig());
      const p1 = pull('org/a', 1);
      const p2 = pull('org/a', 2);
      const restampKeys = new Set([pullKey(p1.data), pullKey(p2.data)]);
      const { toasts } = diffCheers(sig({ restampKeys, pulls: [p1, p2] }), 'me', base);
      expect(toasts.filter(t => t.icon === '🔁')).toHaveLength(2);
   });
});

describe('diffCheers — quick-wins', () => {
   it('fires once when the count crosses the threshold, resets below it', () => {
      const base = primed(sig({ quickWinCount: 0 }));
      const up = diffCheers(sig({ quickWinCount: 3 }), 'me', base);
      expect(up.toasts.some(t => t.icon === '⚡')).toBe(true);
      expect(up.next.quickWinsNagged).toBe(true);

      const stillUp = diffCheers(sig({ quickWinCount: 4 }), 'me', up.next);
      expect(stillUp.toasts.some(t => t.icon === '⚡')).toBe(false);

      const down = diffCheers(sig({ quickWinCount: 1 }), 'me', stillUp.next);
      expect(down.next.quickWinsNagged).toBe(false);
      expect(down.toasts.some(t => t.icon === '⚡')).toBe(false);

      const again = diffCheers(sig({ quickWinCount: 3 }), 'me', down.next);
      expect(again.toasts.some(t => t.icon === '⚡')).toBe(true);
   });
});

describe('diffCheers — return-the-favor', () => {
   it('fires once per debtor, then stays silent for that debtor', () => {
      const base = primed(sig());
      const p = pull('org/a', 9, { author: 'alice' });
      const debtors = [{ login: 'alice', pull: p, count: 2 }];
      const first = diffCheers(sig({ debtors }), 'me', base);
      expect(first.toasts.some(t => t.dedupeKey === 'favor:alice')).toBe(true);
      expect(first.toasts.some(t => t.body?.includes('2 of your PRs'))).toBe(true);
      const second = diffCheers(sig({ debtors }), 'me', first.next);
      expect(second.toasts.some(t => t.dedupeKey === 'favor:alice')).toBe(false);
   });

   it('fires separately for a second debtor in the same tick', () => {
      const base = primed(sig());
      const pAlice = pull('org/a', 1, { author: 'alice' });
      const pBob = pull('org/a', 2, { author: 'bob' });
      const debtors = [
         { login: 'alice', pull: pAlice, count: 1 },
         { login: 'bob', pull: pBob, count: 1 },
      ];
      const { toasts } = diffCheers(sig({ debtors }), 'me', base);
      expect(toasts.filter(t => t.icon === '🤝')).toHaveLength(2);
   });
});

describe('diffCheers — leaderboard', () => {
   it('fires top-of-board when you take #1, then stays silent while you hold it', () => {
      const base = primed(sig({ myRank: 2, myCount: 3 }));
      const { toasts, next } = diffCheers(sig({ myRank: 1, myCount: 4 }), 'me', base);
      expect(toasts.some(t => t.icon === '🏆')).toBe(true);
      expect(next.wasTop).toBe(true);
      const again = diffCheers(sig({ myRank: 1, myCount: 5 }), 'me', next);
      expect(again.toasts.some(t => t.icon === '🏆')).toBe(false);
   });

   it('does not fire top-of-board with zero stamps in view', () => {
      const base = primed(sig({ myRank: 0, myCount: 0 }));
      const { toasts } = diffCheers(sig({ myRank: 1, myCount: 0 }), 'me', base);
      expect(toasts.some(t => t.icon === '🏆')).toBe(false);
   });

   it('fires climbing when your rank improves, naming the peer now behind you', () => {
      const base = primed(sig({ myRank: 3, myCount: 2 }));
      const { toasts } = diffCheers(sig({ myRank: 2, myCount: 3, peerBelow: 'bob' }), 'me', base);
      expect(toasts.some(t => t.icon === '📈' && t.title === 'You passed bob')).toBe(true);
   });

   it('does not fire climbing without an identifiable peer', () => {
      const base = primed(sig({ myRank: 3, myCount: 2 }));
      const { toasts } = diffCheers(sig({ myRank: 2, myCount: 3, peerBelow: null }), 'me', base);
      expect(toasts.some(t => t.icon === '📈')).toBe(false);
   });

   it('does not fire climbing when reaching #1 (that is top-of-board territory)', () => {
      const base = primed(sig({ myRank: 2, myCount: 2 }));
      const { toasts } = diffCheers(sig({ myRank: 1, myCount: 3, peerBelow: 'bob' }), 'me', base);
      expect(toasts.some(t => t.icon === '📈')).toBe(false);
   });
});

describe('diffCheers — author-side toasts', () => {
   it('fires pr-green on the ready transition', () => {
      const key = 'org/a#1';
      const p = pull('org/a', 1, { author: 'me', status: 'ready' });
      const base = primed(sig({ authorPrs: new Map([[key, prState()]]) }));
      const { toasts } = diffCheers(
         sig({ authorPrs: new Map([[key, prState({ green: true })]]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts.some(t => t.dedupeKey === `green:${key}`)).toBe(true);
      const again = diffCheers(
         sig({ authorPrs: new Map([[key, prState({ green: true })]]), pulls: [p] }),
         'me',
         diffCheers(
            sig({ authorPrs: new Map([[key, prState({ green: true })]]), pulls: [p] }),
            'me',
            base
         ).next
      );
      expect(again.toasts.some(t => t.dedupeKey === `green:${key}`)).toBe(false);
   });

   it('fires pr-first-review when someone stamps it', () => {
      const key = 'org/a#2';
      const p = pull('org/a', 2, { author: 'me', crBy: ['alice'] });
      const base = primed(sig({ authorPrs: new Map([[key, prState()]]) }));
      const { toasts } = diffCheers(
         sig({ authorPrs: new Map([[key, prState({ reviewed: true })]]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts.some(t => t.dedupeKey === `firstrev:${key}` && t.body?.includes('alice'))).toBe(
         true
      );
   });

   it('fires pr-conflicts on the conflict transition', () => {
      const key = 'org/a#3';
      const p = pull('org/a', 3, { author: 'me', conflict: true });
      const base = primed(sig({ authorPrs: new Map([[key, prState()]]) }));
      const { toasts } = diffCheers(
         sig({ authorPrs: new Map([[key, prState({ conflict: true })]]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts.some(t => t.dedupeKey === `conflict:${key}`)).toBe(true);
   });

   it('fires pr-starving on the starved transition', () => {
      const key = 'org/a#4';
      const p = pull('org/a', 4, { author: 'me', starved: true, ageDays: 12 });
      const base = primed(sig({ authorPrs: new Map([[key, prState()]]) }));
      const { toasts } = diffCheers(
         sig({ authorPrs: new Map([[key, prState({ starved: true })]]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts.some(t => t.dedupeKey === `starve:${key}` && t.title.includes('12d'))).toBe(
         true
      );
   });

   it('does not fire for a brand-new PR that appears already green', () => {
      const key = 'org/a#5';
      const p = pull('org/a', 5, { author: 'me', status: 'ready' });
      const base = primed(sig()); // no baseline entry for this key at all
      const { toasts } = diffCheers(
         sig({ authorPrs: new Map([[key, prState({ green: true })]]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts.some(t => t.dedupeKey === `green:${key}`)).toBe(false);
   });
});

describe('diffCheers — board-cleared', () => {
   it('fires when the whole reviewable board drains to zero, then stays silent', () => {
      const base = primed(sig({ review: 5 }));
      const first = diffCheers(sig({ review: 0 }), 'me', base);
      expect(first.toasts.some(t => t.dedupeKey === 'board:clear')).toBe(true);
      const second = diffCheers(sig({ review: 0 }), 'me', first.next);
      expect(second.toasts.some(t => t.dedupeKey === 'board:clear')).toBe(false);
   });
});

describe('diffCheers — stale claim', () => {
   it('nags once per stale claim, then stays silent, and re-nags after a re-claim', () => {
      const p = pull('org/a', 9);
      const stale = new Map([[pullKey(p.data), p]]);
      const base = primed(sig()); // primed with no stale claims
      const first = diffCheers(sig({ staleClaims: stale, pulls: [p] }), 'me', base);
      expect(first.toasts.some(t => t.dedupeKey === `claimstale:${pullKey(p.data)}`)).toBe(true);
      expect(first.toasts.some(t => t.icon === '✋')).toBe(true);
      // repeat tick with the same stale claim: silent
      const second = diffCheers(sig({ staleClaims: stale, pulls: [p] }), 'me', first.next);
      expect(second.toasts.some(t => t.dedupeKey === `claimstale:${pullKey(p.data)}`)).toBe(false);
      // released (no longer stale), then re-claimed-and-stale: nags again
      const cleared = diffCheers(sig({ pulls: [p] }), 'me', second.next);
      const again = diffCheers(sig({ staleClaims: stale, pulls: [p] }), 'me', cleared.next);
      expect(again.toasts.some(t => t.dedupeKey === `claimstale:${pullKey(p.data)}`)).toBe(true);
   });

   it('primes an already-stale claim silently on the first tick', () => {
      const p = pull('org/a', 9);
      const stale = new Map([[pullKey(p.data), p]]);
      const { toasts, next } = diffCheers(
         sig({ staleClaims: stale, pulls: [p] }),
         'me',
         EMPTY_BASELINE
      );
      expect(toasts.some(t => t.dedupeKey?.startsWith('claimstale:'))).toBe(false);
      expect(next.staleClaimsSeen.has(pullKey(p.data))).toBe(true);
   });
});

describe('diffCheers — review requested', () => {
   it('fires once when GitHub newly requests your review, then stays quiet', () => {
      const p = pull('org/a', 7, { author: 'alice' });
      const req = new Map([[pullKey(p.data), p]]);
      const base = primed(sig()); // primed with no requests
      const first = diffCheers(sig({ requestedOfMe: req, pulls: [p] }), 'me', base);
      expect(first.toasts.some(t => t.dedupeKey === `req:${pullKey(p.data)}`)).toBe(true);
      expect(first.toasts.some(t => t.title === 'Review requested')).toBe(true);
      // same request next tick: silent
      const second = diffCheers(sig({ requestedOfMe: req, pulls: [p] }), 'me', first.next);
      expect(second.toasts.some(t => t.dedupeKey === `req:${pullKey(p.data)}`)).toBe(false);
      // request dropped then re-added: nags again
      const cleared = diffCheers(sig({ pulls: [p] }), 'me', second.next);
      const again = diffCheers(sig({ requestedOfMe: req, pulls: [p] }), 'me', cleared.next);
      expect(again.toasts.some(t => t.dedupeKey === `req:${pullKey(p.data)}`)).toBe(true);
   });

   it('primes an existing request silently on the first tick', () => {
      const p = pull('org/a', 7, { author: 'alice' });
      const req = new Map([[pullKey(p.data), p]]);
      const { toasts, next } = diffCheers(
         sig({ requestedOfMe: req, pulls: [p] }),
         'me',
         EMPTY_BASELINE
      );
      expect(toasts.some(t => t.dedupeKey?.startsWith('req:'))).toBe(false);
      expect(next.requestedSeen.has(pullKey(p.data))).toBe(true);
   });
});

describe('diffCheers — MAX_PER_TICK', () => {
   it('keeps the highest-priority toasts when a tick overflows the cap', () => {
      const base = primed(sig({ review: 5, restampKeys: new Set(), quickWinCount: 0 }));
      const p1 = pull('org/a', 1);
      const p2 = pull('org/a', 2, { ageDays: 4 });
      const turns = new Map([[pullKey(p2.data), p2]]);
      const { toasts } = diffCheers(
         sig({
            review: 0, // board-cleared: highest priority of the four
            restampKeys: new Set([pullKey(p1.data)]), // re-stamp-owed
            pulls: [p1, p2],
            turns, // your-turn
            quickWinCount: 3, // quick-wins: lowest priority of the four
         }),
         'me',
         base
      );
      expect(toasts).toHaveLength(3);
      expect(toasts.some(t => t.dedupeKey === 'board:clear')).toBe(true);
      expect(toasts.some(t => t.icon === '⏳')).toBe(true);
      expect(toasts.some(t => t.icon === '🔁')).toBe(true);
      expect(toasts.some(t => t.icon === '⚡')).toBe(false);
   });
});
