import { describe, expect, it } from 'vitest';
import { pullKey } from '../format';
import { type CheerBaseline, diffCheers, EMPTY_BASELINE, type Signals } from './cheers';
import type { DerivedPull } from './status';

/** A pull carrying only the fields diffCheers reads off it. */
function pull(
   repo: string,
   number: number,
   o: { crBy?: string[]; qaBy?: string[]; ageDays?: number } = {}
): DerivedPull {
   return {
      data: { repo, number, user: { login: 'author' }, status: { cr_req: 1, qa_req: 1 } },
      crBy: o.crBy ?? [],
      qaBy: o.qaBy ?? [],
      ageDays: o.ageDays ?? 1,
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
      restamp: o.restamp ?? 0,
      turns: o.turns ?? new Map(),
      byKey: o.byKey ?? byKey,
   };
}

/** Prime a baseline off a starting snapshot (the real first-tick flow). */
function primed(start: Signals, me = 'me'): CheerBaseline {
   const { toasts, next } = diffCheers(start, me, EMPTY_BASELINE);
   expect(toasts).toEqual([]);
   return next;
}

describe('diffCheers — priming', () => {
   it('fires nothing on the first (unprimed) tick and marks primed', () => {
      const p = pull('org/a', 1, { crBy: ['me'] });
      const base = primed(sig({ stamped: new Set([pullKey(p.data)]), pulls: [p], queue: 4 }));
      expect(base.primed).toBe(true);
      // adopts the standing world so a reload never replays it
      expect(base.stamped.has('org/a#1')).toBe(true);
      expect(base.queue).toBe(4);
      expect(base.nagLevel).toBe(3);
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

describe('diffCheers — nags', () => {
   it('nags once when the pile crosses a step, not again at the same level', () => {
      const base = primed(sig({ queue: 0 }));
      const first = diffCheers(sig({ queue: 3 }), 'me', base);
      expect(first.toasts.some(t => t.tone === 'nag' && t.title.includes('3'))).toBe(true);
      const second = diffCheers(sig({ queue: 4 }), 'me', first.next);
      expect(second.toasts.some(t => t.tone === 'nag')).toBe(false);
      const third = diffCheers(sig({ queue: 5 }), 'me', second.next);
      expect(third.toasts.some(t => t.tone === 'nag' && t.title.includes('5'))).toBe(true);
   });

   it('re-arms the nag after the queue drains', () => {
      const base = primed(sig({ queue: 0 }));
      const up = diffCheers(sig({ queue: 3 }), 'me', base);
      const down = diffCheers(sig({ queue: 0 }), 'me', up.next);
      expect(down.next.nagLevel).toBe(0);
      const again = diffCheers(sig({ queue: 3 }), 'me', down.next);
      expect(again.toasts.some(t => t.tone === 'nag')).toBe(true);
   });

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

   it('nags on a fresh stale stamp, aggregate 0→>0 only', () => {
      const base = primed(sig({ restamp: 0 }));
      const first = diffCheers(sig({ restamp: 2 }), 'me', base);
      expect(first.toasts.some(t => t.icon === '🥀')).toBe(true);
      const second = diffCheers(sig({ restamp: 3 }), 'me', first.next);
      expect(second.toasts.some(t => t.icon === '🥀')).toBe(false);
   });

   it('caps a single tick to three toasts', () => {
      const base = primed(sig({ restamp: 0, queue: 0 }));
      // clear the queue reward + a stale-stamp nag + several landed stamps at once
      const pulls = [1, 2, 3, 4, 5].map(nn => pull('org/a', nn, { crBy: ['me'] }));
      const stamped = new Set(pulls.map(p => pullKey(p.data)));
      const { toasts } = diffCheers(sig({ stamped, pulls, restamp: 1 }), 'me', base);
      expect(toasts.length).toBeLessThanOrEqual(3);
   });
});
