import { describe, expect, it } from 'vitest';
import {
   closedIssues,
   decideProjects,
   decideQueue,
   type DecideReason,
} from '../../../shared/model/decide';
import type { DerivedPull } from '../../../shared/model/status';
import type { Project, ProjectGroup, ProjectWindow, Today } from '../../../shared/model/projects';
import type { RoadmapItem, RoadmapUpdate } from '../../../shared/model/roadmap';
import type { IssueCounts } from '../../../shared/model/work';
import type { PullData } from '../../../shared/types';
import {
   behindWords,
   bucketOf,
   groupItems,
   IDLE_BUCKETS,
   AGE_BUCKETS,
   isYours,
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
   STATUS_FILTERS,
   withCalls,
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

   it('falls back to the plan for a project with no issue, then to its label read as words', () => {
      expect(bySlug['label-only']).toMatchObject({
         name: 'Label importer',
         lead: 'erin',
         team: 'FixBot',
      });
      // a name, not a code: what a fresh install shows for every project
      expect(bySlug['merges-only'].name).toBe('Merges only');
   });

   it('leads by PRs where no issue or plan names a lead, and says so', () => {
      const leads = Object.fromEntries(items.map(i => [i.slug, [i.lead, i.leadByPrs]]));
      expect(leads).toEqual({
         // its issue's assignee, then its plan's lead
         alpha: ['dana', false],
         'label-only': ['erin', false],
         // the one with the most PRs open or merged lately
         'merges-only': ['dana', true],
         paused: ['finn', true],
         // nobody's PRs: nobody
         beta: [null, false],
         gone: [null, false],
         shipped: [null, false],
      });
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
   const cell = (over: Partial<Parameters<typeof planCell>[0]>) =>
      planCell({ plan: null, project: null, ...over }, day, now);

   it('says what the plan owes when Decide asks nothing, the worst first', () => {
      const offTrack = plan(1, 'a', { update: update('off_track', 1), start: '2026-08-03' });
      expect(cell({ plan: offTrack })).toEqual({
         kind: 'off_track',
         text: 'Off track',
         warn: true,
         planId: 1,
      });
      expect(cell({ plan: plan(1, 'a', { start: '2026-08-03' }) }).text).toBe(
         '5 weeks past its end'
      );
      expect(cell({ plan: plan(1, 'a', { update: update('at_risk', 1) }) }).text).toBe('At risk');
      expect(cell({ plan: plan(1, 'a', { start: '2026-09-07', weeks: 6 }) }).text).toBe(
         'No update yet'
      );
      expect(
         cell({
            plan: plan(1, 'a', { start: '2026-09-07', weeks: 6, update: update('on_track', 20) }),
         }).text
      ).toBe('Update due');
   });

   it('reads calm when nothing is owed, and blank with no plan nobody asks for', () => {
      expect(cell({ plan: plan(1, 'a', { update: update('on_track', 1) }) })).toEqual({
         kind: 'on_track',
         text: 'On track',
         warn: false,
         planId: 1,
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
      // small work ships without a plan, so the cell says nothing at all
      expect(cell({})).toEqual({ kind: 'no_plan', text: '', warn: false, planId: null });
   });

   it('names the worst call Decide asks, in amber, about the plan it asks', () => {
      const done = plan(7, 'a', { status: 'done' });
      const asked = (...reasons: DecideReason[]) =>
         cell({ plan: done, asks: reasons.map(reason => ({ reason, item: done })) });
      expect(asked({ kind: 'new', since: null })).toMatchObject({ text: 'No plan', warn: true });
      // a finished plan Decide asks about again, whatever else it asks
      expect(
         asked(
            { kind: 'stalled', days: 30 },
            { kind: 'reopened', open: 2, late: 0, as: 'done', by: 'roadmap' }
         )
      ).toEqual({ kind: 'reopened', text: 'Done, still taking PRs', warn: true, planId: 7 });
      expect(asked({ kind: 'over', weeks: 3, since: 0 }).text).toBe('3 weeks past its end');
      expect(asked({ kind: 'missed', due: '2026-09-20', open: 2 }).text).toBe(
         'Missed its Sep 20 target'
      );
      // a call about no plan opens the work with no plan
      expect(cell({ asks: [{ reason: { kind: 'stalled', days: 25 }, item: null }] })).toMatchObject(
         { text: 'Stalled', planId: null }
      );
   });

   it('says the issues are all closed exactly when Decide asks, as Decide asks it', () => {
      const closed: IssueCounts = {
         total: 2,
         open: 0,
         done: 2,
         dropped: 0,
         lastClosedAt: now - 2 * 86400,
      };
      const issues = new Map([['alpha', closed]]);
      // [the cell says so, Decide asks]
      const flags = (alphaPlans: RoadmapItem[], all: Project[] = projects) => {
         const rows = decideQueue({
            live: decideProjects(today),
            items: alphaPlans,
            closed: closedIssues(all),
            issues,
            today: day,
            now,
         });
         const items = withCalls(
            portfolioItems(all, today, {}, teamOf, NOW, alphaPlans, issues),
            rows,
            NOW
         );
         return [
            items.find(i => i.slug === 'alpha')?.planCell.kind === 'issues_done',
            rows.some(r => r.slug === 'alpha' && r.reasons.some(x => x.kind === 'issues_done')),
         ];
      };
      // its one plan starts next month
      expect(flags([plan(3, 'alpha', { status: 'planned', start: '2026-10-12' })])).toEqual([
         false,
         false,
      ]);
      const first = plan(3, 'alpha', { start: '2026-09-07', weeks: 8 });
      expect(flags([first])).toEqual([true, true]);
      // its own issue closed since the plan last changed: Decide asks about
      // that first, so the cell says so instead
      const shut = projects.map(p =>
         p.slug === 'alpha'
            ? {
                 ...p,
                 state: 'closed' as const,
                 state_reason: 'completed',
                 closed_at: new Date((now - 3600) * 1000).toISOString(),
              }
            : p
      );
      expect(flags([first], shut)).toEqual([false, false]);
   });

   it('counts a project behind when off track, or past its end or target with PRs open', () => {
      const behind = portfolioItems(projects, today, {}, teamOf, NOW, [
         plan(3, 'alpha', { start: '2026-08-03' }),
         plan(4, 'merges-only', { start: '2026-08-03' }),
         plan(5, 'beta', { start: '2026-09-21', weeks: 2 }),
      ]);
      const by = Object.fromEntries(behind.map(i => [i.slug, i]));
      expect(by.alpha.behind).toBe('past_end');
      // past its end, but nothing open: Decide asks to finish it, not to catch up
      expect(by['merges-only'].behind).toBeNull();
      expect(by.beta.endsSoon).toBe(true);
      // off track counts until the plan changes after the update, as Decide reads it
      const offTrack = (changedDaysAgo: number) =>
         portfolioItems(projects, today, {}, teamOf, NOW, [
            plan(3, 'alpha', {
               update: update('off_track', 2),
               updated_at: now - changedDaysAgo * 86400,
            }),
         ]).find(i => i.slug === 'alpha')?.behind;
      expect(offTrack(5)).toBe('off_track');
      expect(offTrack(1)).toBeNull();
   });

   it('says how a project is behind in its row’s words', () => {
      const day = '2026-09-29';
      const late = portfolioItems(projects, today, {}, teamOf, NOW, [
         plan(3, 'alpha', { start: '2026-08-03' }),
      ]).find(i => i.slug === 'alpha') as PortfolioItem;
      expect(behindWords(late, day)).toBe('5 weeks past its end');
      const due = { title: null, due_on: '2026-09-20T00:00:00Z' };
      expect(behindWords({ behind: 'missed', plan: null, target: due }, day)).toBe(
         'Missed its Sep 20 target'
      );
      expect(behindWords({ behind: 'off_track', plan: null, target: null }, day)).toBe('Off track');
      expect(behindWords(bySlug.beta, day)).toBeNull();
   });
});

describe('the list’s filters', () => {
   it('matches the tabs, being worked on by default', () => {
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

   it('counts parked or finished work Decide asks about as being worked on while its PRs move', () => {
      const asked = withCalls(
         items,
         [
            { slug: 'paused', item: plans[0], reasons: [{ kind: 'moving' }] },
            // asked, but nothing of it moves
            { slug: 'beta', item: null, reasons: [{ kind: 'stalled', days: 30 }] },
         ],
         NOW
      );
      const tabs = (slug: string) => {
         const item = asked.find(i => i.slug === slug) as PortfolioItem;
         return STATUS_FILTERS.map(([key]) => key).filter(key => matchesStatus(item, key));
      };
      // in the list a Monday opens to, and still in its own tab
      expect(tabs('paused')).toEqual(['live', 'parked', 'all']);
      expect(tabs('beta')).toEqual(['quiet', 'all']);
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
      // a lead by PRs is a lead
      expect(items.filter(i => matchesFind(i, 'dana')).map(i => i.slug)).toEqual([
         'alpha',
         'merges-only',
      ]);
      expect(items.filter(i => matchesFind(i, 'fixbot')).map(i => i.slug)).toEqual(['label-only']);
   });

   it('matches a lead or team it starts after "lead:" or "team:", a parent exactly', () => {
      const find = (f: string) =>
         items
            .filter(i => matchesFind(i, f))
            .map(i => i.slug)
            .sort();
      // what a click on a parent or a team puts in the box
      expect(find('parent:store')).toEqual(['alpha', 'beta']);
      expect(find('parent:Warehouse')).toEqual(['beta']);
      expect(find('lead:dana')).toEqual(['alpha', 'merges-only']);
      expect(find('team:fixbot')).toEqual(['label-only']);
      // a lead or team is found before it's typed out
      expect(find('lead:dan')).toEqual(['alpha', 'merges-only']);
      expect(find('team:Fix')).toEqual(['label-only']);
      expect(find('lead:ana')).toEqual([]);
      // part of a parent isn't the parent
      expect(find('parent:stor')).toEqual([]);
      // without the prefix, a word still matches inside any of them
      expect(find('stor')).toEqual(expect.arrayContaining(['alpha', 'beta']));
   });
});

describe('isYours', () => {
   it('is a project you lead, by PRs too, or have a PR in, until it’s done', () => {
      const yours = (me: string) =>
         items
            .filter(i => isYours(i, me))
            .map(i => i.slug)
            .sort();
      // dana leads alpha and has the merge in merges-only
      expect(yours('dana')).toEqual(['alpha', 'merges-only']);
      // kyle only has a PR open in alpha; logins match in any case
      expect(yours('Kyle')).toEqual(['alpha']);
      // finn's project is parked: still his
      expect(yours('finn')).toEqual(['paused']);
      expect(yours('nobody')).toEqual([]);
      // done or dropped leaves it, unless Decide asks because its PRs still move
      const done = { ...bySlug.alpha, stage: 'closed' as const };
      expect(isYours(done, 'dana')).toBe(false);
      const reason: DecideReason = { kind: 'new', since: null };
      expect(isYours({ ...done, asks: [{ reason, item: null }] }, 'dana')).toBe(true);
   });
});

describe('sortItems', () => {
   it('puts what’s owed first by default, then the longest quiet, and sinks no activity', () => {
      const owed = withCalls(
         items,
         [{ slug: 'alpha', item: null, reasons: [{ kind: 'new', since: null }] }],
         NOW
      );
      expect(sortItems(owed, '').map(i => i.slug)).toEqual([
         'alpha',
         'paused',
         'label-only',
         'merges-only',
         'beta',
         'gone',
         'shipped',
      ]);
      // Decide's calls in Decide's order, worst first, whatever was quieter;
      // then an update owed, which nobody decides
      const asked = withCalls(
         items,
         [
            { slug: 'alpha', item: null, reasons: [{ kind: 'new', since: null }] },
            { slug: 'label-only', item: null, reasons: [{ kind: 'stalled', days: 25 }] },
            { slug: 'paused', item: plans[0], reasons: [{ kind: 'moving' }] },
         ],
         NOW
      ).map(i =>
         i.slug === 'merges-only'
            ? {
                 ...i,
                 planCell: {
                    kind: 'update_due' as const,
                    text: 'Update due',
                    warn: true,
                    planId: 9,
                 },
              }
            : i
      );
      expect(
         sortItems(asked, '')
            .slice(0, 4)
            .map(i => i.slug)
      ).toEqual(['paused', 'label-only', 'alpha', 'merges-only']);
      // the URL's nothing-picked value and an unknown key are the default too
      expect(parseSort('idle')).toEqual({ key: 'plan', reversed: false });
      expect(parseSort('nonsense')).toEqual({ key: 'plan', reversed: false });
      // Last activity alone
      expect(sortItems(owed, 'last')[0].slug).toBe('paused');
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

   it('puts a parent at the top of its own group, not under no parent', () => {
      const store = { ...bySlug.gone, slug: 'store', name: 'Store' };
      const groups = groupItems(sortItems([...items, store], 'name'), 'parent');
      expect(groups.map(g => [g.title, g.items.map(i => i.slug)])).toEqual([
         ['store', ['store', 'alpha', 'beta']],
         ['warehouse', ['beta']],
         ['No parent', ['gone', 'label-only', 'merges-only', 'paused', 'shipped']],
      ]);
   });

   it('groups by the plan’s team, or else the team most of its developers are on', () => {
      expect(mainTeam(bySlug.alpha, teamOf)).toBe('Store');
      const groups = groupItems(items, 'team');
      expect(groups.map(g => g.title)).toEqual(['FixBot', 'Store', 'No team']);
   });

   it('puts the teams in their configured order, then any other by name', () => {
      const titles = (teams: string[]) =>
         groupItems(items, 'team', undefined, teams).map(g => g.title);
      expect(titles(['Store', 'FixBot'])).toEqual(['Store', 'FixBot', 'No team']);
      expect(titles(['Store'])).toEqual(['Store', 'FixBot', 'No team']);
   });

   it('marks a project an earlier group already showed, so its call is drawn once', () => {
      const groups = groupItems(sortItems(items, 'name'), 'parent');
      expect(groups.map(g => [g.title, [...g.repeats]])).toEqual([
         ['store', []],
         ['warehouse', ['beta']],
         ['No parent', []],
      ]);
   });
});

describe('the list as text', () => {
   it('writes one CSV row per project, quoting cells with commas', () => {
      const csv = portfolioCsv([{ ...bySlug.alpha, name: 'Alpha, the first' }]);
      const [head, row] = csv.trim().split('\n');
      expect(head.startsWith('Project,Label slug,Stage,Lead,Team,Open since')).toBe(true);
      expect(row.startsWith('"Alpha, the first",alpha,Being worked on,dana,Store,')).toBe(true);
   });

   it('keeps a name that starts like a formula as text', () => {
      const csv = portfolioCsv([{ ...bySlug.alpha, name: '=HYPERLINK("x")' }]);
      expect(csv.trim().split('\n')[1].startsWith('"\'=HYPERLINK(""x"")",alpha,')).toBe(true);
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
