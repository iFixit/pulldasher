import { describe, expect, it } from 'vitest';
import type { DerivedPull } from '../../../shared/model/status';
import type { Project, ProjectGroup, ProjectWindow, Today } from '../../../shared/model/projects';
import {
   groupItems,
   mainTeam,
   matchesFind,
   matchesStatus,
   parseSort,
   portfolioCsv,
   portfolioItems,
   sortItems,
} from './portfolio';

const NOW = Date.UTC(2026, 8, 29, 12);
const teams: Record<string, string> = { dana: 'Store', erin: 'FixBot', finn: 'Store' };
const teamOf = (login: string) => teams[login] ?? null;

function project(slug: string, over: Partial<Project> = {}): Project {
   return {
      slug,
      name: slug.toUpperCase(),
      repo: 'iFixit/projects',
      number: 1,
      state: 'open',
      state_reason: null,
      ongoing: false,
      parents: [],
      lead: null,
      target: null,
      created_at: null,
      closed_at: null,
      ...over,
   };
}

function group(slug: string, people: string[], statuses: string[] = [], p?: Project): ProjectGroup {
   return {
      slug,
      project: p ?? null,
      open: statuses.map(status => ({ status } as unknown as DerivedPull)),
      merged: [],
      people,
      idleDays: statuses.length ? 3 : null,
      lastActivity: null,
      flags: [],
   };
}

const w = (merged: number, toMerge: number | null = null): ProjectWindow => ({
   backlog_start: 0,
   backlog_end: 0,
   opened: 0,
   merged,
   closed: 0,
   median_age_start_days: null,
   median_age_end_days: null,
   median_days_to_merge: toMerge,
   developers: 0,
   non_developers: 0,
   first_opened: null,
   last_closed: null,
});

const alpha = project('alpha', {
   lead: 'dana',
   parents: ['store'],
   target: { title: 'October', due_on: new Date(NOW + 5 * 86_400_000).toISOString() },
});
const today: Today = {
   live: [
      group('alpha', ['dana', 'kyle'], ['needs_cr', 'ready'], alpha),
      group('label-only', ['erin'], ['draft']),
   ],
   quiet: [group('beta', [], [], project('beta', { parents: ['store', 'warehouse'] }))],
   misc: [],
   unsorted: [],
   doubleLabeled: [],
};
const projects = [
   alpha,
   project('beta', { parents: ['store', 'warehouse'] }),
   project('gone', { state: 'closed', state_reason: 'not_planned' }),
   project('shipped', { state: 'closed', state_reason: 'completed' }),
];
const items = portfolioItems(
   projects,
   today,
   { alpha: w(4, 2.5), shipped: w(7, 1), misc: w(9) },
   teamOf,
   NOW
);
const bySlug = Object.fromEntries(items.map(i => [i.slug, i]));

describe('portfolioItems', () => {
   it('joins every source into one row per project, misc left out', () => {
      expect(Object.keys(bySlug).sort()).toEqual([
         'alpha',
         'beta',
         'gone',
         'label-only',
         'shipped',
      ]);
      expect(bySlug.alpha).toMatchObject({
         status: 'live',
         lead: 'dana',
         dueInDays: 5,
         open: 2,
         waiting: 1,
         developers: ['dana'],
         nonDevelopers: ['kyle'],
      });
      expect(bySlug.alpha.window?.merged).toBe(4);
   });

   it('reads status off Today first, then the issue', () => {
      expect(bySlug.beta.status).toBe('quiet');
      expect(bySlug.gone.status).toBe('dropped');
      expect(bySlug.shipped.status).toBe('done');
      expect(bySlug['label-only'].status).toBe('live');
      expect(bySlug['label-only'].name).toBe('label-only');
   });
});

describe('filters', () => {
   it('matches the status tabs', () => {
      const pick = (f: string) =>
         items
            .filter(i => matchesStatus(i, f))
            .map(i => i.slug)
            .sort();
      expect(pick('live')).toEqual(['alpha', 'label-only']);
      expect(pick('quiet')).toEqual(['beta']);
      expect(pick('closed')).toEqual(['gone', 'shipped']);
      expect(pick('all')).toHaveLength(5);
   });

   it('finds by name, slug, parent, or lead', () => {
      expect(items.filter(i => matchesFind(i, 'WARE')).map(i => i.slug)).toEqual(['beta']);
      expect(items.filter(i => matchesFind(i, 'dana')).map(i => i.slug)).toEqual(['alpha']);
   });
});

describe('sortItems', () => {
   it('sorts by a column, and reverses with a minus', () => {
      expect(
         sortItems(items, 'merged')
            .map(i => i.slug)
            .slice(0, 2)
      ).toEqual(['shipped', 'alpha']);
      expect(sortItems(items, '-merged').at(-1)?.slug).toBe('shipped');
      expect(parseSort('nonsense')).toEqual({ key: 'open', reversed: false });
   });

   it('puts the soonest target first and projects without one last', () => {
      expect(sortItems(items, 'target')[0].slug).toBe('alpha');
   });
});

describe('groupItems', () => {
   it('shows a two-parent project under both parents, with no parent last', () => {
      const groups = groupItems(sortItems(items, 'name'), 'parent', teamOf);
      expect(groups.map(g => [g.title, g.items.map(i => i.slug)])).toEqual([
         ['store', ['alpha', 'beta']],
         ['warehouse', ['beta']],
         ['No parent', ['gone', 'label-only', 'shipped']],
      ]);
   });

   it('groups by the team most of a project’s developers are on', () => {
      expect(mainTeam(bySlug.alpha, teamOf)).toBe('Store');
      expect(mainTeam(bySlug.beta, teamOf)).toBeNull();
      const groups = groupItems(items, 'team', teamOf);
      expect(groups.at(-1)?.title).toBe('Only non-developers');
   });
});

describe('portfolioCsv', () => {
   it('quotes cells with commas and writes one row per project', () => {
      const csv = portfolioCsv([{ ...bySlug.alpha, name: 'Alpha, the first' }]);
      const [head, row] = csv.trim().split('\n');
      expect(head.startsWith('Project,Label slug,Status,Lead')).toBe(true);
      expect(row.startsWith('"Alpha, the first",alpha,Live,dana,October,')).toBe(true);
   });
});
