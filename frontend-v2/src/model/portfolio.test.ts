import { describe, expect, it } from 'vitest';
import type { DerivedPull } from '../../../shared/model/status';
import type { Project, ProjectGroup, ProjectWindow, Today } from '../../../shared/model/projects';
import type { RoadmapItem, RoadmapUpdate } from '../../../shared/model/roadmap';
import type { PullData } from '../../../shared/types';
import {
   bucketOf,
   groupItems,
   IDLE_BUCKETS,
   AGE_BUCKETS,
   mainTeam,
   matchesFind,
   matchesOnly,
   matchesStatus,
   onlyWords,
   parseSort,
   planCell,
   portfolioCsv,
   portfolioItems,
   portfolioText,
   sortItems,
   withWorkers,
   type PortfolioItem,
} from './portfolio';

// Tuesday 2026-09-29, midday UTC
const NOW = Date.UTC(2026, 8, 29, 12);
const DAY_MS = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();
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
      fields: { start: null, target: null, priority: null },
      created_at: null,
      closed_at: null,
      ...over,
   };
}

/** An open PR: opened `opened` days ago, last worked on `active` days ago.
 * Its updated_at is today, the way a label edit leaves it. */
function pull(number: number, opened: number, active: number, login = 'dana', status = 'ready') {
   return {
      status,
      data: {
         repo: 'iFixit/ifixit',
         number,
         title: `PR ${number}`,
         user: { login },
         labels: [],
         created_at: iso(opened),
         updated_at: iso(0),
         status: { activity_at: iso(active) },
      },
   } as unknown as DerivedPull;
}

const merge = (number: number, daysAgo: number, login = 'dana') =>
   ({
      repo: 'iFixit/ifixit',
      number,
      title: `PR ${number}`,
      user: { login },
      labels: [],
      created_at: iso(daysAgo + 3),
      merged_at: iso(daysAgo),
   } as unknown as PullData);

function group(
   slug: string,
   people: string[],
   open: DerivedPull[] = [],
   p: Project | null = null,
   merged: PullData[] = []
): ProjectGroup {
   return {
      slug,
      project: p,
      open,
      merged,
      people,
      idleDays: null,
      lastActivity: null,
      flags: [],
   };
}

const w = (merged: number): ProjectWindow => ({
   backlog_start: 0,
   backlog_end: 0,
   opened: 0,
   merged,
   closed: 0,
   median_age_start_days: null,
   median_age_end_days: null,
   median_days_to_merge: null,
   developers: 0,
   non_developers: 0,
   first_opened: null,
   last_closed: null,
});

const update = (health: RoadmapUpdate['health'], daysAgo: number): RoadmapUpdate => ({
   id: 1,
   item_id: 1,
   health,
   body: 'Shipping the importer next.',
   plan_start: '2026-09-21',
   plan_weeks: 4,
   author: 'dana',
   at: (NOW - daysAgo * DAY_MS) / 1000,
});

const plan = (id: number, slug: string | null, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project: slug,
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   spec: null,
   start: '2026-09-21',
   weeks: 4,
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   created_at: null,
   update: null,
   ...over,
});

const alpha = project('alpha', {
   lead: 'dana',
   parents: ['store'],
   target: { title: 'October', due_on: new Date(NOW + 5 * DAY_MS).toISOString() },
});
const today: Today = {
   live: [
      // oldest open first, as buildToday sorts them
      group(
         'alpha',
         ['dana', 'kyle'],
         [pull(1, 40, 2, 'dana', 'needs_cr'), pull(2, 35, 30, 'kyle')],
         alpha,
         [merge(9, 4)]
      ),
      group('label-only', ['erin'], [pull(3, 60, 25, 'erin', 'draft')]),
      group('paused', ['finn'], [pull(4, 90, 50, 'finn')], project('paused')),
      group('merges-only', ['dana'], [], null, [merge(5, 6)]),
   ],
   quiet: [group('beta', [], [], project('beta', { parents: ['store', 'warehouse'] }))],
   misc: [],
   unsorted: [],
   doubleLabeled: [],
};
const projects = [
   alpha,
   project('beta', { parents: ['store', 'warehouse'] }),
   project('paused'),
   project('gone', { state: 'closed', state_reason: 'not_planned' }),
   project('shipped', { state: 'closed', state_reason: 'completed' }),
];
const plans = [
   plan(1, 'paused', { status: 'parked' }),
   plan(2, 'label-only', { name: 'Label importer', lead: 'erin', team: 'FixBot' }),
];
const items = portfolioItems(projects, today, { alpha: w(4), misc: w(9) }, teamOf, NOW, plans);
const bySlug: Record<string, PortfolioItem> = Object.fromEntries(items.map(i => [i.slug, i]));

describe('portfolioItems', () => {
   it('joins every source into one row per project, misc left out', () => {
      expect(Object.keys(bySlug).sort()).toEqual([
         'alpha',
         'beta',
         'gone',
         'label-only',
         'merges-only',
         'paused',
         'shipped',
      ]);
      expect(bySlug.alpha).toMatchObject({
         status: 'live',
         stage: 'progress',
         lead: 'dana',
         team: 'Store',
         dueInDays: 5,
         open: 2,
         waiting: 1,
         merged: 1,
         developers: ['dana'],
         nonDevelopers: ['kyle'],
      });
      expect(bySlug.alpha.window?.merged).toBe(4);
   });

   it('puts each project in a stage, the roadmap first', () => {
      const stages = Object.fromEntries(items.map(i => [i.slug, [i.status, i.stage]]));
      expect(stages).toEqual({
         alpha: ['live', 'progress'],
         'label-only': ['live', 'progress'],
         // live by its PRs, but parked on the roadmap
         paused: ['live', 'parked'],
         'merges-only': ['live', 'progress'],
         beta: ['quiet', 'quiet'],
         gone: ['dropped', 'closed'],
         shipped: ['done', 'closed'],
      });
   });

   it('falls back to the plan for a project with no issue', () => {
      expect(bySlug['label-only']).toMatchObject({
         name: 'Label importer',
         lead: 'erin',
         team: 'FixBot',
      });
      expect(bySlug['merges-only'].name).toBe('merges-only');
   });

   it('dates a project by its oldest open PR and its newest real work', () => {
      const a = bySlug.alpha;
      expect([a.openSince, a.ageDays]).toEqual([iso(40).slice(0, 10), 40]);
      // activity_at, not the updated_at a label edit moved to today
      expect(a.lastActivity).toMatchObject({ days: 2, pr: { number: 1 } });
      expect(a.stalest).toMatchObject({ days: 30, opened: false, pr: { number: 2 } });
      // with nothing open, the last merge is the last activity and there's no age
      expect(bySlug['merges-only']).toMatchObject({ ageDays: null, stalest: null });
      expect(bySlug['merges-only'].lastActivity?.days).toBe(6);
   });

   it('calls a project in progress stalled after 21 days without activity, but not a parked one', () => {
      expect(items.filter(i => i.stalled).map(i => i.slug)).toEqual(['label-only']);
      expect(bySlug.paused.lastActivity?.days).toBe(50);
   });
});

describe('planCell', () => {
   const day = '2026-09-29';
   const now = NOW / 1000;
   const base = {
      project: null,
      stage: 'progress' as const,
      open: 2,
      merged: 0,
      target: null,
      dueInDays: null,
   };
   const cell = (over: Partial<Parameters<typeof planCell>[0]>) =>
      planCell({ ...base, plan: null, ...over }, day, now);

   it('says the worst thing first', () => {
      const offTrack = plan(1, 'a', { update: update('off_track', 1), start: '2026-08-03' });
      expect(cell({ plan: offTrack }).text).toBe('Off track');
      expect(cell({ plan: plan(1, 'a', { start: '2026-08-03' }) }).text).toBe('5 wk past its end');
      expect(
         cell({
            plan: plan(1, 'a'),
            target: { title: null, due_on: '2026-09-20' },
            dueInDays: -9,
         })
      ).toEqual({ kind: 'missed', text: 'Missed Sep 20 target', warn: true });
      expect(cell({ plan: plan(1, 'a', { update: update('at_risk', 1) }) }).text).toBe('At risk');
      expect(cell({ plan: plan(1, 'a', { start: '2026-09-07', weeks: 6 }) }).text).toBe(
         'No update'
      );
      expect(
         cell({
            plan: plan(1, 'a', { start: '2026-09-07', weeks: 6, update: update('on_track', 20) }),
         }).text
      ).toBe('Update due');
   });

   it('reads calm when nothing is owed', () => {
      expect(cell({ plan: plan(1, 'a', { update: update('on_track', 1) }) })).toEqual({
         kind: 'on_track',
         text: 'On track',
         warn: false,
      });
      expect(cell({ plan: plan(1, 'a') }).text).toBe('Ends Oct 18');
      expect(cell({ plan: plan(1, 'a', { status: 'planned', start: '2026-10-12' }) }).text).toBe(
         'Starts Oct 12'
      );
      expect(cell({ plan: plan(1, 'a', { status: 'parked' }) }).text).toBe('Parked');
      expect(cell({ plan: plan(1, 'a', { status: 'dropped' }) }).text).toBe('Dropped');
      expect(
         cell({ project: project('x', { state: 'closed', state_reason: 'completed' }) }).text
      ).toBe('Done');
   });

   it('asks for a plan only once Decide would: 3 or more PRs, some open', () => {
      expect(cell({ open: 2, merged: 1 })).toEqual({
         kind: 'no_plan',
         text: 'No plan',
         warn: true,
      });
      expect(cell({ open: 1, merged: 0 }).warn).toBe(false);
      expect(cell({ open: 0, merged: 3 }).warn).toBe(false);
   });

   it('counts a project behind when off track, or past its end or target with PRs open', () => {
      const behind = portfolioItems(projects, today, {}, teamOf, NOW, [
         plan(3, 'alpha', { start: '2026-08-03' }),
         plan(4, 'merges-only', { start: '2026-08-03' }),
         plan(5, 'beta', { start: '2026-09-21', weeks: 2 }),
      ]);
      const by = Object.fromEntries(behind.map(i => [i.slug, i]));
      expect(by.alpha.behind).toBe(true);
      // past its end, but nothing open: Decide asks to finish it, not to catch up
      expect(by['merges-only'].behind).toBe(false);
      expect(by.beta.endsSoon).toBe(true);
   });
});

describe('the list’s filters', () => {
   it('matches the tabs, in progress by default', () => {
      const pick = (f: string) =>
         items
            .filter(i => matchesStatus(i, f))
            .map(i => i.slug)
            .sort();
      expect(pick('live')).toEqual(['alpha', 'label-only', 'merges-only']);
      expect(pick('parked')).toEqual(['paused']);
      expect(pick('quiet')).toEqual(['beta']);
      expect(pick('closed')).toEqual(['gone', 'shipped']);
      expect(pick('all')).toHaveLength(7);
   });

   it('narrows to what a tile or a bar picked, and says so', () => {
      const only = (o: string) => items.filter(i => matchesOnly(i, o)).map(i => i.slug);
      expect(only('stalled')).toEqual(['label-only']);
      // alpha is 40 days old: 1 to 2 months
      expect(bucketOf(40, AGE_BUCKETS)).toBe(2);
      expect(only('age-2')).toEqual(['alpha']);
      // the parked project is 50 days quiet, but the charts count only work in progress
      expect(bucketOf(50, IDLE_BUCKETS)).toBe(3);
      expect(only('idle-3')).toEqual(['label-only']);
      expect(onlyWords('age-2')).toBe('open 1 to 2 months');
      expect(onlyWords('idle-3')).toBe('stalled, nothing for 21 days or more');
      expect(onlyWords('nonsense')).toBeNull();
      expect(items.filter(i => matchesOnly(i, null))).toHaveLength(7);
   });

   it('finds by name, slug, parent, lead or team', () => {
      expect(items.filter(i => matchesFind(i, 'WARE')).map(i => i.slug)).toEqual(['beta']);
      expect(items.filter(i => matchesFind(i, 'dana')).map(i => i.slug)).toEqual(['alpha']);
      expect(items.filter(i => matchesFind(i, 'fixbot')).map(i => i.slug)).toEqual(['label-only']);
   });
});

describe('sortItems', () => {
   it('leads with the longest since any activity, and sinks projects with none', () => {
      expect(sortItems(items, '').map(i => i.slug)).toEqual([
         'paused',
         'label-only',
         'merges-only',
         'alpha',
         'beta',
         'gone',
         'shipped',
      ]);
      expect(parseSort('nonsense')).toEqual({ key: 'idle', reversed: false });
   });

   it('sorts by a column, and reverses with a minus', () => {
      expect(sortItems(items, 'age')[0].slug).toBe('paused');
      // reversed, the blanks still sink
      expect(sortItems(items, '-age').map(i => i.ageDays)).toEqual([
         40,
         60,
         90,
         null,
         null,
         null,
         null,
      ]);
      expect(sortItems(items, 'target')[0].slug).toBe('alpha');
   });

   it('puts amber plan words first, the worst first', () => {
      expect(sortItems(items, 'plan').map(i => [i.slug, i.planCell.text])).toEqual([
         // 3 PRs and no plan: Decide asks for one
         ['alpha', 'No plan'],
         ['merges-only', 'No plan'],
         ['beta', 'No plan'],
         ['label-only', 'Ends Oct 18'],
         ['paused', 'Parked'],
         ['gone', 'Dropped'],
         ['shipped', 'Done'],
      ]);
   });

   it('sorts by who worked on it once those days load', () => {
      const withPeople = withWorkers(
         items,
         new Map([['beta', [{ login: 'dana', days: 1, writing: 1 }]]])
      );
      expect(sortItems(withPeople, 'people')[0].slug).toBe('beta');
   });
});

describe('groupItems', () => {
   it('shows a two-parent project under both parents, with no parent last', () => {
      const groups = groupItems(sortItems(items, 'name'), 'parent');
      expect(groups.map(g => [g.title, g.items.map(i => i.slug)])).toEqual([
         ['store', ['alpha', 'beta']],
         ['warehouse', ['beta']],
         ['No parent', ['gone', 'label-only', 'merges-only', 'paused', 'shipped']],
      ]);
   });

   it('groups by the plan’s team, or else the team most of its developers are on', () => {
      expect(mainTeam(bySlug.alpha, teamOf)).toBe('Store');
      const groups = groupItems(items, 'team');
      expect(groups.map(g => g.title)).toEqual(['FixBot', 'Store', 'No team']);
   });
});

describe('the list as text', () => {
   it('writes one CSV row per project, quoting cells with commas', () => {
      const csv = portfolioCsv([{ ...bySlug.alpha, name: 'Alpha, the first' }]);
      const [head, row] = csv.trim().split('\n');
      expect(head.startsWith('Project,Label slug,Stage,Lead,Team,Open since')).toBe(true);
      expect(row.startsWith('"Alpha, the first",alpha,In progress,dana,Store,')).toBe(true);
   });

   it('copies each project’s plan words and when it last moved', () => {
      const text = portfolioText([bySlug.alpha, bySlug['label-only']], '2026-09-29');
      expect(text.split('\n')).toEqual([
         'Where the projects stand, Sep 29',
         '- ALPHA: No plan. 2 open PRs, last activity 2 days ago.',
         '- Label importer: Ends Oct 18. 1 open PR, last activity 25 days ago.',
      ]);
   });
});
