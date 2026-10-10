import { describe, expect, it } from 'vitest';
import {
   JAIL_COOLDOWN_MS,
   jailCase,
   jailDue,
   jailRecord,
   parseJailRecord,
   type JailPull,
} from './jail';

const LIMITS = { maxOpen: 7, maxDays: 14 };
const NO_BOTS: ReadonlySet<string> = new Set();

let n = 0;
function pull(
   login: string,
   ageDays: number,
   o: { draft?: boolean; deployBlockedBy?: string[]; ready?: boolean; cryo?: boolean } = {}
): JailPull {
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

describe('jailCase', () => {
   // [open, ready] -> the why line; limit 7
   it.each([
      [20, 0, '20 open PRs. Parole at 7. Close 13 to get out.'],
      [20, 3, '20 open PRs. Parole at 7. Merge your 3 ready ones and close 10 more.'],
      [10, 3, '10 open PRs. Parole at 7. Merge your 3 ready ones and you’re out.'],
      [12, 6, '12 open PRs. Parole at 7. Merge 5 of your 6 ready ones and you’re out.'],
      [8, 1, '8 open PRs. Parole at 7. Merge your ready one and you’re out.'],
      [9, 1, '9 open PRs. Parole at 7. Merge your ready one and close 1 more.'],
   ])('with %i open and %i ready, points at the ready ones first', (open, ready, why) => {
      const pulls = [
         ...many(open - ready),
         ...Array.from({ length: ready }, () => pull('me', 1, { ready: true })),
      ];
      expect(jailCase(pulls, 'me', NO_BOTS, LIMITS)?.why).toBe(why);
   });

   it('never counts a parked PR as ready', () => {
      const parked = pull('me', 1, { ready: true, cryo: true });
      expect(jailCase([...many(7), parked], 'me', NO_BOTS, LIMITS)?.why).toBe(
         '8 open PRs. Parole at 7. Close 1 to get out.'
      );
   });

   it('won’t promise you’re out while an old PR would still hold you', () => {
      const old = pull('me', 40);
      const pulls = [...many(6), old, pull('me', 1, { ready: true })];
      expect(jailCase(pulls, 'me', NO_BOTS, LIMITS)?.why).toBe(
         `8 open PRs. Parole at 7. Merge your ready one to get under 7. #${old.data.number} is still past 14 days.`
      );
      // an old PR that's ready leaves with the merge, so you are out
      const oldReady = [...many(7), pull('me', 40, { ready: true })];
      expect(jailCase(oldReady, 'me', NO_BOTS, LIMITS)?.why).toBe(
         '8 open PRs. Parole at 7. Merge your ready one and you’re out.'
      );
   });

   it('counts what’s left to close, the old ones included', () => {
      // 9 open (2 over the limit) and 3 old: closing the 3 old ones frees you
      const pulls = [...many(6), pull('me', 20), pull('me', 30), pull('me', 40)];
      expect(jailCase(pulls, 'me', NO_BOTS, LIMITS)?.toGo).toBe(3);
      // 12 open (5 over) and 1 old: 5 to go, the old one among them
      expect(jailCase([...many(11), pull('me', 20)], 'me', NO_BOTS, LIMITS)?.toGo).toBe(5);
   });

   it('says merge when the one old PR is ready, and counts several', () => {
      const old = pull('me', 30, { ready: true });
      expect(jailCase([old], 'me', NO_BOTS, LIMITS)?.why).toBe(
         `#${old.data.number} has been open 30 days and it’s ready. Merge it to get out.`
      );
      expect(jailCase([pull('me', 20), pull('me', 15)], 'me', NO_BOTS, LIMITS)?.why).toBe(
         '2 PRs open past 14 days. Merge or close them to get out.'
      );
   });

   it('stays free at the open-PR limit', () => {
      expect(jailCase(many(7), 'me', NO_BOTS, LIMITS)).toBeNull();
   });

   it('jails past the open-PR limit, listing them oldest first', () => {
      const pulls = [...many(7), pull('me', 9)];
      const c = jailCase(pulls, 'me', NO_BOTS, LIMITS);
      expect(c?.pulls).toHaveLength(8);
      expect(c?.pulls[0].ageDays).toBe(9);
      expect(c?.why).toBe('8 open PRs. Parole at 7. Close 1 to get out.');
      expect(c?.count).toBe(8);
      expect(c?.toGo).toBe(1);
   });

   it('jails one PR past the age limit, and lists only the old ones', () => {
      const old = pull('me', 21);
      const c = jailCase([pull('me', 2), old, pull('me', 14)], 'me', NO_BOTS, LIMITS);
      expect(c?.pulls).toEqual([old]);
      expect(c?.why).toBe(
         `#${old.data.number} has been open 21 days. Parole at 14 days. Merge or close it to get out.`
      );
      expect(c?.count).toBe(3);
      expect(c?.over).toEqual([`iFixit/ifixit#${old.data.number}`]);
      expect(c?.toGo).toBe(1);
   });

   it('ignores other people’s PRs', () => {
      expect(
         jailCase([...many(9, 'someone'), pull('someone', 90)], 'me', NO_BOTS, LIMITS)
      ).toBeNull();
   });

   it('ignores drafts unless they count', () => {
      const drafts = Array.from({ length: 9 }, () => pull('me', 90, { draft: true }));
      expect(jailCase(drafts, 'me', NO_BOTS, LIMITS)).toBeNull();
      const counted = jailCase(drafts, 'me', NO_BOTS, { ...LIMITS, countDrafts: true });
      expect(counted?.pulls).toHaveLength(9);
   });

   it('ignores bots, by suffix and by the config list', () => {
      expect(jailCase(many(9, 'dependabot[bot]'), 'dependabot[bot]', NO_BOTS, LIMITS)).toBeNull();
      expect(jailCase(many(9, 'renovate'), 'renovate', new Set(['renovate']), LIMITS)).toBeNull();
   });

   it('ignores PRs held for a deploy', () => {
      const held = Array.from({ length: 9 }, () => pull('me', 90, { deployBlockedBy: ['qa'] }));
      expect(jailCase(held, 'me', NO_BOTS, LIMITS)).toBeNull();
   });
});

describe('jailDue', () => {
   const HOUR = 60 * 60 * 1000;
   const T = 1_000_000_000_000;
   const over = (pulls: JailPull[]) => jailCase(pulls, 'me', NO_BOTS, LIMITS);
   const recordAt = (pulls: JailPull[], at: number) => {
      const c = over(pulls);
      if (!c) throw new Error('expected to be over a limit');
      return jailRecord(c, at);
   };
   const eight = many(8);
   const shownAt = recordAt(eight, T);

   it('never shows while you are under the limits', () => {
      expect(jailDue(over(many(7)), null, T)).toBe(false);
   });

   it('shows the first time', () => {
      expect(jailDue(over(eight), null, T)).toBe(true);
   });

   it('does not re-show on a refresh', () => {
      expect(jailDue(over(eight), shownAt, T + 1000)).toBe(false);
   });

   it('does not re-show within 4 hours, even when it got worse', () => {
      expect(jailDue(over([...eight, pull('me', 1)]), shownAt, T + 3 * HOUR)).toBe(false);
   });

   it('re-shows after 4 hours when you have more open PRs', () => {
      expect(jailDue(over([...eight, pull('me', 1)]), shownAt, T + JAIL_COOLDOWN_MS)).toBe(true);
   });

   it('does not re-show after 4 hours when it is the same or better', () => {
      expect(jailDue(over(eight), shownAt, T + 24 * HOUR)).toBe(false);
      // closing two then opening one is still a net gain of room
      const fewer = recordAt([...eight, ...many(2)], T);
      expect(jailDue(over([...eight, pull('me', 1)]), fewer, T + 24 * HOUR)).toBe(false);
   });

   it('re-shows after 4 hours when a PR newly crosses the age limit', () => {
      const old = pull('me', 20);
      const pulls = [pull('me', 1), old];
      const last = recordAt(pulls, T);
      expect(jailDue(over(pulls), last, T + 24 * HOUR)).toBe(false);
      // same count: the young one aged past 14 days
      const aged = { ...pulls[0], ageDays: 15 };
      expect(jailDue(over([aged, old]), last, T + 24 * HOUR)).toBe(true);
   });

   it('ignores a missing or unreadable record (and the old daily key)', () => {
      expect(parseJailRecord(null)).toBeNull();
      expect(parseJailRecord('2026-10-09')).toBeNull();
      expect(parseJailRecord('{"at":1}')).toBeNull();
      expect(parseJailRecord(JSON.stringify(shownAt))).toEqual(shownAt);
   });
});
