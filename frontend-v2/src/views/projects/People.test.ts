import { describe, expect, it } from 'vitest';
import type { PersonWindow } from '../../../../shared/model/projects';
import { teamLookup } from '../../model/projectData';
import type { PortfolioItem } from '../../model/portfolio';
import { findFilter } from '../../model/portfolio';
import type { RetroRow } from '../../model/retro';
import { overloadedPeople, peopleRows, personMatches, sortPeople, type PersonRow } from './People';
import { openingMonth } from './RangeCalendar';
import { lastWeeks, type WhoRow } from './WhoIsOnWhat';

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
      last: null,
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

describe('overloadedPeople', () => {
   const row = (login: string, projects: number): PersonRow => ({
      login,
      team: 'Store',
      load: load(login, projects, projects),
      w: null,
   });

   it('names the most projects first, and ties by login, as the Overview does', () => {
      const rows = [
         row('zed', 4),
         row('amy', 6),
         row('bob', 4),
         ...['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].map(l => row(l, 1)),
      ];
      expect(overloadedPeople(rows, 4).map(r => r.login)).toEqual(['amy', 'bob', 'zed']);
   });

   it('counts projects they wrote for, not ones they only reviewed', () => {
      const reviewer = { ...row('rae', 9), load: { ...load('rae', 9, 9), wrote: 1 } };
      const rows = [reviewer, ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(l => row(l, 1))];
      expect(overloadedPeople(rows, 4)).toEqual([]);
   });

   it('flags no one when more than a quarter would be', () => {
      const rows = [row('amy', 6), row('bob', 6), row('cal', 1)];
      expect(overloadedPeople(rows, 4)).toEqual([]);
   });
});

describe('personMatches', () => {
   const items = new Map([
      [
         'webdriver',
         {
            slug: 'webdriver',
            name: 'Deflake the webdriver tests',
            lead: 'zdmitchell',
            team: 'FixBot',
            parents: ['ci'],
         } as unknown as PortfolioItem,
      ],
   ]);
   const dan: PersonRow = {
      login: 'danielbeardsley',
      team: 'Store',
      load: { ...load('danielbeardsley', 0, 2), projects: [] },
      w: stats({ projects: ['webdriver'] }),
   };
   const matches = (find: string) => personMatches(dan, findFilter(find), items);

   it('finds a person by login or team, and an empty find keeps everyone', () => {
      expect(matches('')).toBe(true);
      expect(matches('Beard')).toBe(true);
      expect(matches('store')).toBe(true);
      expect(matches('team:sto')).toBe(true);
      expect(matches('lead:daniel')).toBe(true);
   });

   it('finds the people on a project the find names, by its name or its parent', () => {
      expect(matches('webdriver')).toBe(true);
      expect(matches('parent:ci')).toBe(true);
   });

   it('reads a login or a team as the person’s, not their projects’', () => {
      // the project's lead and team aren't dan's
      expect(matches('zdmitchell')).toBe(false);
      expect(matches('fixbot')).toBe(false);
      expect(matches('team:fixbot')).toBe(false);
      expect(matches('lead:zd')).toBe(false);
   });
});

describe('lastWeeks', () => {
   const row = (login: string, project: string | null, week: number): RetroRow =>
      ({ login, pr: { project }, week, days: 1, own: true } as unknown as RetroRow);

   it('keeps each person’s latest week on each project, whatever case their login comes in', () => {
      const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'];
      const last = lastWeeks(
         [row('Dan', 'sso', 2), row('dan', 'sso', 0), row('dan', 'akeneo', 1), row('dan', null, 2)],
         weeks
      );
      expect(last.get('dan sso')).toBe('2026-09-21');
      expect(last.get('dan akeneo')).toBe('2026-09-14');
      expect(last.size).toBe(2);
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
