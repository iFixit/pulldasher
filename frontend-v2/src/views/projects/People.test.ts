import { describe, expect, it } from 'vitest';
import type { PersonWindow } from '../../../../shared/model/projects';
import { teamLookup } from '../../model/projectData';
import { peopleRows, sortPeople, type PersonRow } from './People';
import { openingMonth } from './RangeCalendar';
import type { WhoRow } from './WhoIsOnWhat';

const load = (login: string, projects: number, days: number): WhoRow => ({
   login,
   days,
   reviewing: 0,
   unfiled: 0,
   projects: Array.from({ length: projects }, (_, i) => ({
      login,
      slug: `p${i}`,
      days: 1,
      writing: 1,
   })),
   wrote: projects,
   reviewedOnly: 0,
   reviewed: 0,
   team: null,
   open: 0,
});
const stats = (over: Partial<PersonWindow>) => over as PersonWindow;

describe('peopleRows', () => {
   const teams = { Store: ['DanielBeardsley', 'zdmitchell'] };
   const data = {
      teams,
      window: {
         people: {
            danielbeardsley: stats({ opened: 3, reviews: 2 }),
            BaseInfinity: stats({ opened: 4, reviews: 0 }),
         },
      },
   } as unknown as Parameters<typeof peopleRows>[0];
   const rows = peopleRows(data, teamLookup(teams), [load('danielbeardsley', 5, 9)], 'Sterling');

   it('keeps one row per person whatever case their login comes in', () => {
      const dan = rows.filter(r => r.login.toLowerCase() === 'danielbeardsley');
      expect(dan).toHaveLength(1);
      // the spelling their PRs use, their team from the typed list, and both
      // halves of their numbers
      expect(dan[0].login).toBe('danielbeardsley');
      expect(dan[0].team).toBe('Store');
      expect(dan[0].load?.projects).toHaveLength(5);
      expect(dan[0].w?.opened).toBe(3);
   });

   it('lists idle developers, non-developers, and the person picked elsewhere', () => {
      expect(rows.map(r => r.login).sort()).toEqual(
         ['BaseInfinity', 'Sterling', 'danielbeardsley', 'zdmitchell'].sort()
      );
      const picked = rows.find(r => r.login === 'Sterling');
      expect(picked).toMatchObject({ team: null, load: null, w: null });
   });
});

describe('sortPeople', () => {
   const row = (login: string, projects: number | null, open: number): PersonRow => ({
      login,
      team: null,
      load: projects == null ? null : load(login, projects, projects),
      w: stats({ backlog_end: open, reviews: 0 }),
   });
   const rows = [row('ann', 2, 1), row('bob', null, 5), row('cat', 0, 0), row('dan', 2, 3)];

   it('puts the most first, ties to open PRs, and the uncounted after a zero', () => {
      const sorted = sortPeople(rows, { key: 'projects', reversed: false });
      expect(sorted.map(r => r.login)).toEqual(['dan', 'ann', 'cat', 'bob']);
   });

   it('reverses only the column, not the tie-breaks', () => {
      const sorted = sortPeople(rows, { key: 'projects', reversed: true });
      expect(sorted.map(r => r.login)).toEqual(['bob', 'cat', 'dan', 'ann']);
   });

   it('sorts names A to Z', () => {
      const sorted = sortPeople(rows, { key: 'name', reversed: false });
      expect(sorted.map(r => r.login)).toEqual(['ann', 'bob', 'cat', 'dan']);
   });
});

describe('openingMonth', () => {
   const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

   it('opens early in a month on the months before, which have days to pick', () => {
      expect(openingMonth(day(2026, 10, 1), day(2026, 10, 1), 2)).toEqual(day(2026, 8, 1));
      expect(openingMonth(day(2026, 10, 1), day(2026, 10, 1), 1)).toEqual(day(2026, 9, 1));
   });

   it('ends on the range’s own month once most of it has come', () => {
      expect(openingMonth(day(2026, 10, 20), day(2026, 10, 20), 2)).toEqual(day(2026, 9, 1));
   });

   it('ends on a past range’s month', () => {
      expect(openingMonth(day(2025, 3, 15), day(2026, 10, 1), 2)).toEqual(day(2025, 2, 1));
   });
});
