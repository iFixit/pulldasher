import { describe, expect, it } from 'vitest';
import { pullKey } from '../format';
import {
   type AuthorPrState,
   CHEER_CATALOG,
   type CheerBaseline,
   CONFIGURABLE_TOASTS,
   diffCheers,
   EMPTY_BASELINE,
   evaluateCheers,
   PRIORITY_ORDER,
   reviveBaseline,
   serializeBaseline,
   SHIPPED_TOAST_KIND,
   type Signals,
   startHereReason,
   type ToastKind,
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
      staleClaimAfter: o.staleClaimAfter ?? 'a couple hours',
      requestedOfMe: o.requestedOfMe ?? new Map(),
      rankHolders: o.rankHolders ?? new Map(),
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
   ciRed: false,
   needsAnswer: false,
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
         'alice reviewed yours, return the favor'
      );
   });

   it('does not treat a shared repo as a reason — falls through it', () => {
      // an M-weight pull in a repo the viewer has stamped before: no "you know
      // this repo" reason, so with no reciprocity or quick win it hits urgency
      const target = pull('org/a', 1, { author: 'alice', weight: 'M', ageDays: 3 });
      const sameRepoStamped = pull('org/a', 2, { crBy: ['me'] });
      expect(startHereReason(target, [target, sameRepoStamped], 'me')).toBe(
         'Waiting 3d without a full CR'
      );
   });

   it('falls back to a quick-win when there is no reciprocity', () => {
      const target = pull('org/b', 1, { author: 'alice', weight: 'XS', sizeKnown: true });
      expect(startHereReason(target, [target], 'me')).toBe('Small one (XS), quick');
   });

   it('falls back to urgency when nothing else applies', () => {
      const target = pull('org/c', 1, {
         author: 'alice',
         weight: 'M',
         sizeKnown: true,
         ageDays: 7,
      });
      expect(startHereReason(target, [target], 'me')).toBe('Waiting 7d without a full CR');
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

   it('fires climbing when your rank improves', () => {
      const base = primed(sig({ myRank: 3, myCount: 2 }));
      const { toasts } = diffCheers(sig({ myRank: 2, myCount: 3, peerBelow: 'bob' }), 'me', base);
      // no named peer: dense-rank ties make "who you passed" unreliable, so the
      // copy celebrates the climb without asserting a specific person
      expect(toasts.some(t => t.icon === '📈' && t.title === "You're climbing")).toBe(true);
   });

   it('does not fire climbing when your rank improves passively (no new stamp of yours)', () => {
      // other people's reviewed PRs merged away, so your rank number got
      // better while your own count never moved; that is not your climb
      const base = primed(sig({ myRank: 3, myCount: 2 }));
      const { toasts } = diffCheers(sig({ myRank: 2, myCount: 2, peerBelow: 'bob' }), 'me', base);
      expect(toasts.some(t => t.icon === '📈')).toBe(false);
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

   // Regression test for the reported bug: "climbing" was firing when the
   // viewer's rank got numerically WORSE (moved down the board), not better.
   // Rank 1 is best, so climbing must require the numeric rank to decrease.
   it('does not fire climbing when your rank gets worse (was #3, now #4)', () => {
      const base = primed(sig({ myRank: 3, myCount: 5 }));
      const { toasts } = diffCheers(sig({ myRank: 4, myCount: 5, peerBelow: 'bob' }), 'me', base);
      expect(toasts.some(t => t.icon === '📈' || t.title === "You're climbing")).toBe(false);
   });
});

describe('diffCheers — overtaken', () => {
   it('fires when your rank slips and names whoever now holds your old spot', () => {
      const base = primed(sig({ myRank: 3, myCount: 4 }));
      const rankHolders = new Map([[3, ['alice']]]);
      const { toasts } = diffCheers(sig({ myRank: 4, myCount: 4, rankHolders }), 'me', base);
      const toast = toasts.find(t => t.dedupeKey?.startsWith('overtaken:'));
      expect(toast).toBeDefined();
      expect(toast?.tone).toBe('nag');
      expect(toast?.title).toBe('alice took your #3 spot');
      expect(toast?.body).toBe("You're #4 on the board now.");
      expect(toast?.dedupeKey).toBe('overtaken:3:alice');
   });

   it('picks the alphabetically-first holder when a tie shares your old rank', () => {
      const base = primed(sig({ myRank: 2, myCount: 6 }));
      const rankHolders = new Map([[2, ['zeb', 'alice']]]);
      const { toasts } = diffCheers(sig({ myRank: 3, myCount: 6, rankHolders }), 'me', base);
      const toast = toasts.find(t => t.dedupeKey?.startsWith('overtaken:'));
      expect(toast?.title).toBe('alice took your #2 spot');
   });

   it('does not fire when nobody is identifiably at your old rank', () => {
      const base = primed(sig({ myRank: 3, myCount: 4 }));
      const { toasts } = diffCheers(
         sig({ myRank: 4, myCount: 4, rankHolders: new Map() }),
         'me',
         base
      );
      expect(toasts.some(t => t.dedupeKey?.startsWith('overtaken:'))).toBe(false);
   });

   it('does not fire when your rank holds steady or improves', () => {
      const base = primed(sig({ myRank: 3, myCount: 4 }));
      const rankHolders = new Map([[3, ['alice']]]);
      const steady = diffCheers(sig({ myRank: 3, myCount: 4, rankHolders }), 'me', base);
      expect(steady.toasts.some(t => t.dedupeKey?.startsWith('overtaken:'))).toBe(false);
      const improved = diffCheers(
         sig({ myRank: 2, myCount: 5, rankHolders, peerBelow: 'bob' }),
         'me',
         base
      );
      expect(improved.toasts.some(t => t.dedupeKey?.startsWith('overtaken:'))).toBe(false);
   });

   it('fires once per drop, then stays silent while the standing persists', () => {
      const base = primed(sig({ myRank: 3, myCount: 4 }));
      const rankHolders = new Map([[3, ['alice']]]);
      const first = diffCheers(sig({ myRank: 4, myCount: 4, rankHolders }), 'me', base);
      expect(first.toasts.some(t => t.dedupeKey === 'overtaken:3:alice')).toBe(true);
      const second = diffCheers(sig({ myRank: 4, myCount: 4, rankHolders }), 'me', first.next);
      expect(second.toasts.some(t => t.dedupeKey?.startsWith('overtaken:'))).toBe(false);
   });

   it('can fire again after climbing back then dropping a second time', () => {
      const base = primed(sig({ myRank: 3, myCount: 4 }));
      const rankHoldersAt3 = new Map([[3, ['alice']]]);
      const dropped = diffCheers(
         sig({ myRank: 4, myCount: 4, rankHolders: rankHoldersAt3 }),
         'me',
         base
      );
      expect(dropped.toasts.some(t => t.dedupeKey === 'overtaken:3:alice')).toBe(true);
      // reclaim #3
      const reclaimed = diffCheers(
         sig({ myRank: 3, myCount: 6, peerBelow: 'carol' }),
         'me',
         dropped.next
      );
      expect(reclaimed.toasts.some(t => t.dedupeKey?.startsWith('overtaken:'))).toBe(false);
      // drop again, same rank transition
      const droppedAgain = diffCheers(
         sig({ myRank: 4, myCount: 6, rankHolders: rankHoldersAt3 }),
         'me',
         reclaimed.next
      );
      expect(droppedAgain.toasts.some(t => t.dedupeKey === 'overtaken:3:alice')).toBe(true);
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

   it('fires pr-ci-red when your PR breaks CI', () => {
      const key = 'org/a#31';
      const p = pull('org/a', 31, { author: 'me', status: 'ci_red' });
      const base = primed(sig({ authorPrs: new Map([[key, prState()]]) }));
      const { toasts } = diffCheers(
         sig({ authorPrs: new Map([[key, prState({ ciRed: true })]]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts.some(t => t.dedupeKey === `cired:${key}`)).toBe(true);
   });

   it('fires pr-changes when a reviewer requests changes on your PR', () => {
      const key = 'org/a#32';
      const p = pull('org/a', 32, { author: 'me', status: 'dev_block' });
      const base = primed(sig({ authorPrs: new Map([[key, prState()]]) }));
      const { toasts } = diffCheers(
         sig({ authorPrs: new Map([[key, prState({ needsAnswer: true })]]), pulls: [p] }),
         'me',
         base
      );
      expect(toasts.some(t => t.dedupeKey === `changes:${key}`)).toBe(true);
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

   it('says the real threshold, not a hardcoded "a couple hours"', () => {
      const p = pull('org/a', 9);
      const stale = new Map([[pullKey(p.data), p]]);
      const base = primed(sig());
      // viewer set claim-warn to 30 minutes → the copy must not say "hours"
      const { toasts } = diffCheers(
         sig({ staleClaims: stale, pulls: [p], staleClaimAfter: '30 minutes' }),
         'me',
         base
      );
      const body = toasts.find(t => t.icon === '✋')?.body ?? '';
      expect(body).toContain('30 minutes');
      expect(body).not.toContain('hours');
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

   it('defers an evicted toast to the next tick instead of losing it', () => {
      // same overflow as above: quick-wins (lowest priority) is evicted
      const base = primed(sig({ review: 5, restampKeys: new Set(), quickWinCount: 0 }));
      const p1 = pull('org/a', 1);
      const p2 = pull('org/a', 2, { ageDays: 4 });
      const turns = new Map([[pullKey(p2.data), p2]]);
      const overflow = () =>
         sig({
            review: 0,
            restampKeys: new Set([pullKey(p1.data)]),
            pulls: [p1, p2],
            turns,
            quickWinCount: 3,
         });
      const first = diffCheers(overflow(), 'me', base);
      expect(first.toasts.some(t => t.icon === '⚡')).toBe(false);
      // the eviction must NOT bake "already nagged" into the baseline —
      // with nothing else newly firing, the quick-wins nag gets its slot now
      expect(first.next.quickWinsNagged).toBe(false);
      const second = diffCheers(overflow(), 'me', first.next);
      expect(second.toasts.some(t => t.icon === '⚡')).toBe(true);
      // and the survivors from tick one stay quiet (their marks stood)
      expect(second.toasts.some(t => t.dedupeKey === 'board:clear')).toBe(false);
      expect(second.toasts.some(t => t.icon === '⏳')).toBe(false);
      expect(second.toasts.some(t => t.icon === '🔁')).toBe(false);
   });
});

describe('diffCheers — viewer identity', () => {
   it('re-primes silently when the baseline belongs to someone else', () => {
      // alice's primed baseline has no stamps; bob's board shows one of his.
      // Diffing bob against alice's history must not read bob's pre-existing
      // stamp as freshly landed — a login mismatch re-primes instead.
      const aliceBase = primed(sig(), 'alice');
      const { toasts, next } = diffCheers(sig({ stamped: new Set(['org/a#1']) }), 'bob', aliceBase);
      expect(toasts.filter(t => t.dedupeKey?.startsWith('stamp:'))).toHaveLength(0);
      expect(next.login).toBe('bob');
      expect(next.stamped.has('org/a#1')).toBe(true);
   });

   it('treats a legacy baseline with no login as the current viewer', () => {
      // pre-login-field session blobs revive with login '' — carrying on
      // (not re-priming) keeps a deploy from replaying start-here everywhere
      const legacy: CheerBaseline = { ...primed(sig(), 'me'), login: '' };
      const p = pull('org/a', 3, { author: 'alice' });
      const { toasts, next } = diffCheers(
         sig({ stamped: new Set([pullKey(p.data)]), pulls: [p] }),
         'me',
         legacy
      );
      // still diffs: the new stamp lands as a cheer rather than re-priming
      expect(toasts.some(t => t.dedupeKey?.startsWith('stamp:'))).toBe(true);
      expect(next.login).toBe('me');
   });
});

describe('baseline persistence', () => {
   it('round-trips through JSON serialize/revive', () => {
      const p = pull('org/a', 1, { author: 'alice' });
      const base = primed(sig({ stamped: new Set(['org/a#1']), queue: 3, pulls: [p], backlog: 2 }));
      const round = reviveBaseline(JSON.parse(JSON.stringify(serializeBaseline(base))));
      // deep-equal covers the Sets and the authorPrs Map structurally
      expect(round).toEqual(base);
   });

   it('returns null on a malformed blob so the caller falls back to priming', () => {
      expect(reviveBaseline(null)).toBeNull();
      expect(reviveBaseline('nope')).toBeNull();
      expect(reviveBaseline(42)).toBeNull();
   });
});

describe('evaluateCheers — loading guard', () => {
   // a baseline primed from a prior session: a real queue and board behind it
   const primedBase: CheerBaseline = {
      ...EMPTY_BASELINE,
      primed: true,
      queue: 8,
      boardQueue: 15,
   };

   it('no-ops and carries the baseline while the board is still loading', () => {
      // the empty snapshot the store publishes before the first payload lands
      const { toasts, next } = evaluateCheers({ pulls: [], turns: new Map(), me: 'me', ready: false }, primedBase);
      expect(toasts).toEqual([]);
      expect(next).toBe(primedBase);
   });

   it('WOULD fire phantom clears against that empty board once ready — the bug the guard prevents', () => {
      const { toasts } = evaluateCheers({ pulls: [], turns: new Map(), me: 'me', ready: true }, primedBase);
      const keys = toasts.map(t => t.dedupeKey);
      expect(keys).toContain('inbox:zero');
      expect(keys).toContain('board:clear');
   });
});

describe('cheer catalog', () => {
   it('documents exactly every toast kind, once each', () => {
      const catalogKinds = CHEER_CATALOG.map(c => c.kind);
      // no dupes, and 1:1 with the priority list the evaluator fires from — so
      // a new kind can't ship without a switch and a blurb in the catalog
      expect(new Set(catalogKinds).size).toBe(catalogKinds.length);
      expect(new Set(catalogKinds)).toEqual(new Set(PRIORITY_ORDER));
   });

   it('makes every user-facing toast configurable, including the extras', () => {
      const kinds = CONFIGURABLE_TOASTS.map(c => c.kind);
      // no dupes across the diff cheers + the extra load-time toasts
      expect(new Set(kinds).size).toBe(kinds.length);
      // every diff kind, plus the shipped catch-up that fires off the extras
      // path (so it's not in PRIORITY_ORDER but still gets a Settings switch)
      expect(kinds).toEqual(expect.arrayContaining([...PRIORITY_ORDER]));
      expect(kinds).toContain(SHIPPED_TOAST_KIND);
      // and every configurable toast carries the label + hint Settings renders
      for (const c of CONFIGURABLE_TOASTS) {
         expect(c.label.length).toBeGreaterThan(0);
         expect(c.hint.length).toBeGreaterThan(0);
      }
   });
});

describe('diffCheers — muting', () => {
   it('drops a muted kind, but fires it when not muted', () => {
      const base = primed(sig());
      const snap = () => sig({ quickWinCount: 4, quickWinPull: pull('org/a', 1) });

      const shown = diffCheers(snap(), 'me', base);
      expect(shown.toasts.some(t => t.dedupeKey?.startsWith('quick:'))).toBe(true);

      const hidden = diffCheers(snap(), 'me', base, new Set<ToastKind>(['quick-wins']));
      expect(hidden.toasts.some(t => t.dedupeKey?.startsWith('quick:'))).toBe(false);
   });

   it('muting frees a per-tick slot for a lower-priority kind', () => {
      // four fresh nudges compete for three slots; quick-wins (lowest) loses.
      // mute the top one (review-requested) and quick-wins gets through.
      const base = primed(sig());
      const p1 = pull('org/a', 1, { ageDays: 3 });
      const p2 = pull('org/a', 2, { ageDays: 4 });
      const p3 = pull('org/a', 3, { ageDays: 5 });
      const build = (muted?: ReadonlySet<ToastKind>) =>
         diffCheers(
            sig({
               restampKeys: new Set([pullKey(p1.data)]), // re-stamp-owed
               turns: new Map([[pullKey(p2.data), p2]]), // your-turn
               requestedOfMe: new Map([[pullKey(p3.data), p3]]), // review-requested (top)
               quickWinCount: 4, // quick-wins (lowest)
               pulls: [p1, p2, p3],
            }),
            'me',
            base,
            muted
         );
      const shown = build();
      expect(shown.toasts).toHaveLength(3);
      expect(shown.toasts.some(t => t.icon === '⚡')).toBe(false);
      const freed = build(new Set<ToastKind>(['review-requested']));
      expect(freed.toasts.some(t => t.dedupeKey?.startsWith('req:'))).toBe(false);
      expect(freed.toasts.some(t => t.icon === '⚡')).toBe(true);
   });
});
