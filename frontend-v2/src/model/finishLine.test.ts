import { describe, expect, it } from 'vitest';
import {
   FINISH_COOLDOWN_MS,
   finishLineCase,
   finishDue,
   finishRecord,
   finishStats,
   parseFinishRecord,
   type FinishPull,
} from './finishLine';

const LIMITS = { maxOpen: 7, maxDays: 14 };
const NO_BOTS: ReadonlySet<string> = new Set();

let n = 0;
function pull(
   login: string,
   ageDays: number,
   o: {
      draft?: boolean;
      deployBlockedBy?: string[];
      ready?: boolean;
      cryo?: boolean;
   } = {}
): FinishPull {
   n += 1;
   return {
      data: {
         repo: 'iFixit/ifixit',
         number: n,
         title: `PR ${n}`,
         draft: o.draft ?? false,
         state: 'open',
         user: { login },
      },
      ageDays,
      deployBlockedBy: o.deployBlockedBy ?? [],
      status: o.ready ? 'ready' : 'needs_cr',
      cryo: o.cryo ?? false,
   };
}

const many = (count: number, login = 'me', ageDays = 1) =>
   Array.from({ length: count }, () => pull(login, ageDays));

describe('finishLineCase', () => {
   it('counts the ready ones it lists', () => {
      const pulls = [...many(7), pull('me', 1, { ready: true }), pull('me', 2, { ready: true })];
      expect(finishLineCase(pulls, 'me', NO_BOTS, LIMITS)?.ready).toBe(2);
   });

   it('never counts a parked PR as ready', () => {
      const parked = pull('me', 1, { ready: true, cryo: true });
      expect(finishLineCase([...many(7), parked], 'me', NO_BOTS, LIMITS)?.ready).toBe(0);
   });

   it('counts what’s left to close, the old ones included', () => {
      // 9 open (2 over the limit) and 3 old: closing the 3 old ones frees you
      const pulls = [...many(6), pull('me', 20), pull('me', 30), pull('me', 40)];
      expect(finishLineCase(pulls, 'me', NO_BOTS, LIMITS)?.toGo).toBe(3);
      // 12 open (5 over) and 1 old: 5 to go, the old one among them
      expect(finishLineCase([...many(11), pull('me', 20)], 'me', NO_BOTS, LIMITS)?.toGo).toBe(5);
   });

   it('stays free at the open-PR limit', () => {
      expect(finishLineCase(many(7), 'me', NO_BOTS, LIMITS)).toBeNull();
   });

   it('counts you over past the open-PR limit, listing them oldest first', () => {
      const pulls = [...many(7), pull('me', 9)];
      const c = finishLineCase(pulls, 'me', NO_BOTS, LIMITS);
      expect(c?.pulls).toHaveLength(8);
      expect(c?.pulls[0].ageDays).toBe(9);
      expect(c?.count).toBe(8);
      expect(c?.toGo).toBe(1);
   });

   it('counts you over for one PR past the age limit, and lists only the old ones', () => {
      const old = pull('me', 21);
      const c = finishLineCase([pull('me', 2), old, pull('me', 14)], 'me', NO_BOTS, LIMITS);
      expect(c?.pulls).toEqual([old]);
      expect(c?.count).toBe(3);
      expect(c?.over).toEqual([`iFixit/ifixit#${old.data.number}`]);
      expect(c?.toGo).toBe(1);
   });

   it('ignores other people’s PRs', () => {
      expect(
         finishLineCase([...many(9, 'someone'), pull('someone', 90)], 'me', NO_BOTS, LIMITS)
      ).toBeNull();
   });

   it('ignores drafts unless they count', () => {
      const drafts = Array.from({ length: 9 }, () => pull('me', 90, { draft: true }));
      expect(finishLineCase(drafts, 'me', NO_BOTS, LIMITS)).toBeNull();
      const counted = finishLineCase(drafts, 'me', NO_BOTS, {
         ...LIMITS,
         countDrafts: true,
      });
      expect(counted?.pulls).toHaveLength(9);
   });

   it('ignores bots, by suffix and by the config list', () => {
      expect(
         finishLineCase(many(9, 'dependabot[bot]'), 'dependabot[bot]', NO_BOTS, LIMITS)
      ).toBeNull();
      expect(
         finishLineCase(many(9, 'renovate'), 'renovate', new Set(['renovate']), LIMITS)
      ).toBeNull();
   });

   it('ignores PRs held for a deploy', () => {
      const held = Array.from({ length: 9 }, () => pull('me', 90, { deployBlockedBy: ['qa'] }));
      expect(finishLineCase(held, 'me', NO_BOTS, LIMITS)).toBeNull();
   });
});

describe('finishDue', () => {
   const HOUR = 60 * 60 * 1000;
   const T = 1_000_000_000_000;
   const over = (pulls: FinishPull[]) => finishLineCase(pulls, 'me', NO_BOTS, LIMITS);
   const recordAt = (pulls: FinishPull[], at: number) => {
      const c = over(pulls);
      if (!c) throw new Error('expected to be over a limit');
      return finishRecord(c, at);
   };
   const eight = many(8);
   const shownAt = recordAt(eight, T);

   it('never shows while you are under the limits', () => {
      expect(finishDue(over(many(7)), null, T)).toBe(false);
   });

   it('shows the first time', () => {
      expect(finishDue(over(eight), null, T)).toBe(true);
   });

   it('does not re-show on a refresh', () => {
      expect(finishDue(over(eight), shownAt, T + 1000)).toBe(false);
   });

   it('does not re-show within 4 hours, even when it got worse', () => {
      expect(finishDue(over([...eight, pull('me', 1)]), shownAt, T + 3 * HOUR)).toBe(false);
   });

   it('re-shows after 4 hours when you have more open PRs', () => {
      expect(finishDue(over([...eight, pull('me', 1)]), shownAt, T + FINISH_COOLDOWN_MS)).toBe(
         true
      );
   });

   it('does not re-show after 4 hours when it is the same or better', () => {
      expect(finishDue(over(eight), shownAt, T + 24 * HOUR)).toBe(false);
      // closing two then opening one is still a net gain of room
      const fewer = recordAt([...eight, ...many(2)], T);
      expect(finishDue(over([...eight, pull('me', 1)]), fewer, T + 24 * HOUR)).toBe(false);
   });

   it('re-shows after 4 hours when a PR newly crosses the age limit', () => {
      const old = pull('me', 20);
      const pulls = [pull('me', 1), old];
      const last = recordAt(pulls, T);
      expect(finishDue(over(pulls), last, T + 24 * HOUR)).toBe(false);
      // same count: the young one aged past 14 days
      const aged = { ...pulls[0], ageDays: 15 };
      expect(finishDue(over([aged, old]), last, T + 24 * HOUR)).toBe(true);
   });

   it('ignores a missing or unreadable record (and the old daily key)', () => {
      expect(parseFinishRecord(null)).toBeNull();
      expect(parseFinishRecord('2026-10-09')).toBeNull();
      expect(parseFinishRecord('{"at":1}')).toBeNull();
      expect(parseFinishRecord(JSON.stringify(shownAt))).toEqual(shownAt);
   });
});

describe('finishStats', () => {
   const texts = (c: Parameters<typeof finishStats>[0]) => finishStats(c, LIMITS).map(s => s.text);

   it('shows each number only when it is above zero', () => {
      expect(texts({ count: 9, over: ['a', 'b'], ready: 3 })).toEqual([
         '9 open PRs, aim for 7',
         '2 PRs older than 14 days',
         '3 PRs ready to merge',
      ]);
      expect(texts({ count: 9, over: [], ready: 0 })).toEqual(['9 open PRs, aim for 7']);
      expect(texts({ count: 3, over: ['a'], ready: 1 })).toEqual([
         '1 PR older than 14 days',
         '1 PR ready to merge',
      ]);
      expect(texts({ count: 7, over: [], ready: 0 })).toEqual([]);
   });

   it('points each number at the PRs it counts', () => {
      const [, old, ready] = finishStats({ count: 9, over: ['a'], ready: 1 }, LIMITS);
      expect(old.counts(pull('me', 15))).toBe(true);
      expect(old.counts(pull('me', 14))).toBe(false);
      expect(ready.counts(pull('me', 1, { ready: true }))).toBe(true);
      expect(ready.counts(pull('me', 1))).toBe(false);
   });
});
