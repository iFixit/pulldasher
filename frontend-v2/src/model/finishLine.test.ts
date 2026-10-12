import { describe, expect, it } from 'vitest';
import {
   FINISH_COOLDOWN_MS,
   finishLineCase,
   finishDue,
   finishRecord,
   parseFinishRecord,
   type FinishPull,
} from './finishLine';

const LIMITS = { maxOpen: 7, maxDays: 14 };
const NO_BOTS: ReadonlySet<string> = new Set();

let n = 0;
function pull(
   login: string,
   ageDays: number,
   o: { draft?: boolean; deployBlockedBy?: string[]; ready?: boolean; cryo?: boolean } = {}
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
   const line = (c: ReturnType<typeof finishLineCase>) => `${c?.why} ${c?.ask}`;

   // [open, ready] -> the why and ask lines; limit 7
   it.each([
      [20, 0, 'You have 20 open PRs, over the limit of 7. Merge or close 13 of these to finish.'],
      [
         10,
         3,
         'You have 10 open PRs, over the limit of 7. Merge or close 3 of these to finish. Start with the ones ready to merge.',
      ],
      [
         8,
         1,
         'You have 8 open PRs, over the limit of 7. Merge or close 1 of these to finish. Start with the one ready to merge.',
      ],
   ])('with %i open and %i ready, says how many and where to start', (open, ready, want) => {
      const pulls = [
         ...many(open - ready),
         ...Array.from({ length: ready }, () => pull('me', 1, { ready: true })),
      ];
      const c = finishLineCase(pulls, 'me', NO_BOTS, LIMITS);
      expect(line(c)).toBe(want);
      expect(c?.ready).toBe(ready);
   });

   it('never counts a parked PR as ready', () => {
      const parked = pull('me', 1, { ready: true, cryo: true });
      const c = finishLineCase([...many(7), parked], 'me', NO_BOTS, LIMITS);
      expect(c?.ready).toBe(0);
      expect(c?.ask).toBe('Merge or close 1 of these to finish.');
   });

   it('names the old PRs when they’re part of the count', () => {
      // 9 open and 1 old: 2 to go, the old one among them
      const c = finishLineCase([...many(8), pull('me', 40)], 'me', NO_BOTS, LIMITS);
      expect(line(c)).toBe(
         'You have 9 open PRs, over the limit of 7, and 1 is over 14 days old. Merge or close 2 of these to finish, the one over 14 days among them.'
      );
      // 9 open and 3 old: closing the old ones is the whole ask
      const three = [...many(6), pull('me', 20), pull('me', 30), pull('me', 40)];
      expect(finishLineCase(three, 'me', NO_BOTS, LIMITS)?.ask).toBe(
         'Merge or close the 3 over 14 days to finish.'
      );
   });

   it('says so when every one is old', () => {
      expect(finishLineCase([pull('me', 20), pull('me', 30)], 'me', NO_BOTS, LIMITS)?.why).toBe(
         'You have 2 open PRs, all over 14 days old.'
      );
      expect(finishLineCase([pull('me', 20)], 'me', NO_BOTS, LIMITS)?.why).toBe(
         'You have 1 open PR, over 14 days old.'
      );
   });

   it('lists only the old PRs when the count is fine', () => {
      const old = pull('me', 30, { ready: true });
      expect(line(finishLineCase([pull('me', 1), old], 'me', NO_BOTS, LIMITS))).toBe(
         'You have 2 open PRs, and 1 is over 14 days old. Merge or close the one over 14 days to finish. Start with the one ready to merge.'
      );
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
      const counted = finishLineCase(drafts, 'me', NO_BOTS, { ...LIMITS, countDrafts: true });
      expect(counted?.pulls).toHaveLength(9);
   });

   it('ignores bots, by suffix and by the config list', () => {
      expect(finishLineCase(many(9, 'dependabot[bot]'), 'dependabot[bot]', NO_BOTS, LIMITS)).toBeNull();
      expect(finishLineCase(many(9, 'renovate'), 'renovate', new Set(['renovate']), LIMITS)).toBeNull();
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
      expect(finishDue(over([...eight, pull('me', 1)]), shownAt, T + FINISH_COOLDOWN_MS)).toBe(true);
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
