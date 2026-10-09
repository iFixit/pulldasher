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
   o: { draft?: boolean; deployBlockedBy?: string[] } = {}
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
   };
}

const many = (count: number, login = 'me', ageDays = 1) =>
   Array.from({ length: count }, () => pull(login, ageDays));

describe('jailCase', () => {
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
   });

   it('jails one PR past the age limit, and lists only the old ones', () => {
      const old = pull('me', 21);
      const c = jailCase([pull('me', 2), old, pull('me', 14)], 'me', NO_BOTS, LIMITS);
      expect(c?.pulls).toEqual([old]);
      expect(c?.why).toBe(`#${old.data.number} has been open 21 days. Parole at 14 days.`);
      expect(c?.count).toBe(3);
      expect(c?.over).toEqual([`iFixit/ifixit#${old.data.number}`]);
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
