import { describe, expect, it } from 'vitest';
import type { PullData } from '../../../shared/types';
import type { DerivedPull, Status } from '../../../shared/model/status';
import {
   buildToday,
   dayStart,
   projectOf,
   projectSlugs,
   windowStats,
   type Project,
   type PullSpan,
} from '../../../shared/model/projects';

const DAY = 86400;
const NOW = 1_790_000_000;
const P = 'project:';
const labels = (...titles: string[]) => titles.map(title => ({ title }));
const iso = (secs: number) => new Date(secs * 1000).toISOString();

let n = 0;
function open(over: {
   labels?: string[];
   author?: string;
   status?: Status;
   ageDays?: number;
   idleDays?: number;
}): DerivedPull {
   return {
      status: over.status ?? 'needs_cr',
      data: {
         repo: 'iFixit/ifixit',
         number: ++n,
         user: { login: over.author ?? 'alice' },
         labels: labels(...(over.labels ?? [])),
         created_at: iso(NOW - (over.ageDays ?? 1) * DAY),
         updated_at: iso(NOW - (over.idleDays ?? 0) * DAY),
      },
   } as unknown as DerivedPull;
}

function merged(over: { labels?: string[]; author?: string; daysAgo: number }): PullData {
   return {
      repo: 'iFixit/ifixit',
      number: ++n,
      user: { login: over.author ?? 'alice' },
      labels: labels(...(over.labels ?? [])),
      merged_at: iso(NOW - over.daysAgo * DAY),
      closed_at: iso(NOW - over.daysAgo * DAY),
   } as unknown as PullData;
}

function project(over: Partial<Project> & { slug: string }): Project {
   return {
      name: over.slug.toUpperCase(),
      repo: 'iFixit/projects',
      number: ++n,
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

describe('projectSlugs / projectOf', () => {
   it('reads project labels in sorted order and skips the bare prefix', () => {
      expect(projectSlugs(labels('size: S', 'project:zeta', 'project:', 'project:alpha'), P)).toEqual([
         'alpha',
         'zeta',
      ]);
   });

   it('prefers a real project over misc, and is null with no project label', () => {
      expect(projectOf(labels('project:misc', 'project:zeta'), P)).toBe('zeta');
      expect(projectOf(labels('project:misc'), P)).toBe('misc');
      expect(projectOf(labels('security'), P)).toBeNull();
   });
});

describe('buildToday', () => {
   it('files open PRs into projects, misc, and not-sorted, and lists double labels', () => {
      const a = open({ labels: ['project:workbench'] });
      const b = open({ labels: ['project:misc'] });
      const c = open({ labels: [] });
      const d = open({ labels: ['project:workbench', 'project:search'] });
      const today = buildToday([project({ slug: 'workbench' })], [a, b, c, d], [], P, NOW);
      expect(today.misc).toEqual([b]);
      expect(today.unsorted).toEqual([c]);
      expect(today.doubleLabeled).toEqual([d]);
      // d files under its first label alphabetically ("search"), not workbench
      expect(today.live.map(g => [g.slug, g.open.length])).toEqual([
         ['search', 1],
         ['workbench', 1],
      ]);
   });

   it('keeps a project live on a merge in the last 14 days, but not an older one', () => {
      const today = buildToday(
         [project({ slug: 'recent' }), project({ slug: 'old' })],
         [],
         [
            merged({ labels: ['project:recent'], daysAgo: 13 }),
            merged({ labels: ['project:old'], daysAgo: 15 }),
         ],
         P,
         NOW
      );
      expect(today.live.map(g => g.slug)).toEqual(['recent']);
      expect(today.quiet.map(g => g.slug)).toEqual(['old']);
   });

   it('drops a closed project whose only activity is merges, keeps one with an open PR', () => {
      const today = buildToday(
         [
            project({ slug: 'done', state: 'closed', state_reason: 'completed' }),
            project({ slug: 'reopenme', state: 'closed', state_reason: 'completed' }),
         ],
         [open({ labels: ['project:reopenme'] })],
         [merged({ labels: ['project:done'], daysAgo: 2 })],
         P,
         NOW
      );
      expect(today.live.map(g => g.slug)).toEqual(['reopenme']);
      expect(today.live[0].flags).toContain('issue_closed');
      expect(today.quiet).toEqual([]);
   });

   it('shows a label with no issue under its slug', () => {
      const today = buildToday([], [open({ labels: ['project:new-thing'] })], [], P, NOW);
      expect(today.live[0].project).toBeNull();
      expect(today.live[0].slug).toBe('new-thing');
   });

   it('flags one person only past the minimum PR count', () => {
      const three = buildToday(
         [],
         [open({ labels: ['project:solo'], author: 'bob' })],
         [
            merged({ labels: ['project:solo'], author: 'bob', daysAgo: 1 }),
            merged({ labels: ['project:solo'], author: 'bob', daysAgo: 2 }),
         ],
         P,
         NOW
      );
      expect(three.live[0].flags).toEqual(['one_person']);
      const two = buildToday(
         [],
         [open({ labels: ['project:solo'], author: 'bob' })],
         [merged({ labels: ['project:solo'], author: 'bob', daysAgo: 1 })],
         P,
         NOW
      );
      expect(two.live[0].flags).toEqual([]);
   });

   it('flags a project when every open PR is waiting on review, from two PRs up', () => {
      const today = buildToday(
         [],
         [
            open({ labels: ['project:stuck'], status: 'needs_cr', author: 'a' }),
            open({ labels: ['project:stuck'], status: 'needs_qa', author: 'b' }),
            open({ labels: ['project:moving'], status: 'needs_cr', author: 'a' }),
            open({ labels: ['project:moving'], status: 'ready', author: 'b' }),
         ],
         [],
         P,
         NOW
      );
      const flags = Object.fromEntries(today.live.map(g => [g.slug, g.flags]));
      expect(flags.stuck).toEqual(['waiting_on_review']);
      expect(flags.moving).toEqual([]);
   });

   it('flags a lead who has work in three other live projects', () => {
      const pulls = ['one', 'two', 'three'].map(s => open({ labels: [`project:${s}`], author: 'lee' }));
      const led = open({ labels: ['project:led'], author: 'sam' });
      const today = buildToday([project({ slug: 'led', lead: 'lee' })], [...pulls, led], [], P, NOW);
      expect(today.live.find(g => g.slug === 'led')?.flags).toEqual(['lead_spread']);
   });

   it('reports idle days from the stalest open PR and sorts the busiest first', () => {
      const today = buildToday(
         [],
         [
            open({ labels: ['project:small'], idleDays: 2 }),
            open({ labels: ['project:big'], idleDays: 3 }),
            open({ labels: ['project:big'], idleDays: 40 }),
         ],
         [],
         P,
         NOW
      );
      expect(today.live.map(g => [g.slug, g.idleDays])).toEqual([
         ['big', 40],
         ['small', 2],
      ]);
   });
});

describe('dayStart', () => {
   it('parses real UTC days and rejects anything else', () => {
      expect(dayStart('2026-09-29')).toBe(Date.UTC(2026, 8, 29) / 1000);
      expect(dayStart('2026-02-30')).toBeNull();
      expect(dayStart('9/29/2026')).toBeNull();
   });
});

describe('windowStats', () => {
   const start = '2026-09-01';
   const end = '2026-09-10';
   const from = dayStart(start) as number;
   const to = (dayStart(end) as number) + DAY;
   const span = (over: Partial<PullSpan>): PullSpan => ({
      author: 'alice',
      project: null,
      opened: from - 5 * DAY,
      closed: null,
      merged: false,
      ...over,
   });
   const spans = [
      // open before, still open: backlog at both ends
      span({ project: 'workbench' }),
      // open before, merged inside
      span({ project: 'workbench', closed: from + 2 * DAY, merged: true }),
      // opened inside, closed without merging inside
      span({ author: 'bob', opened: from + DAY, closed: from + 3 * DAY }),
      // opened inside, still open
      span({ author: 'bob', project: 'misc', opened: from + 9 * DAY + 60 }),
      // entirely before the window: ignored
      span({ opened: from - 20 * DAY, closed: from - 10 * DAY, merged: true }),
      // opened after the window: ignored
      span({ opened: to + DAY }),
   ];
   const w = windowStats(spans, start, end);

   it('counts backlog and throughput with the identity holding in every bucket', () => {
      expect(w.totals).toMatchObject({
         backlog_start: 2,
         backlog_end: 2,
         opened: 2,
         merged: 1,
         closed: 1,
      });
      const buckets = [w.totals, w.unsorted, ...Object.values(w.projects), ...Object.values(w.people)];
      for (const c of buckets)
         expect(c.backlog_start + c.opened - c.merged - c.closed).toBe(c.backlog_end);
   });

   it('splits by project and person, leaving misc out of a person’s projects', () => {
      expect(w.projects.workbench).toMatchObject({ backlog_start: 2, backlog_end: 1, merged: 1 });
      expect(w.projects.misc).toMatchObject({ opened: 1, backlog_end: 1 });
      expect(w.unsorted).toMatchObject({ opened: 1, closed: 1, backlog_end: 0 });
      expect(w.people.alice.projects).toEqual(['workbench']);
      expect(w.people.bob.projects).toEqual([]);
   });

   it('gives the median age at each end in days', () => {
      // at the start, both open PRs are 5 days old
      expect(w.totals.median_age_start_days).toBe(5);
      // at the end: one is 15 days old, the other a minute short of 1 day
      expect(w.totals.median_age_end_days).toBe(8);
   });

   it('draws one cumulative point per day that ends on the closing backlog', () => {
      expect(w.days).toHaveLength(10);
      expect(w.days[0]).toEqual({ date: '2026-09-01', arrived: 2, departed: 0, backlog: 2 });
      expect(w.days[1]).toMatchObject({ arrived: 3, departed: 0 });
      expect(w.days[3]).toMatchObject({ arrived: 3, departed: 2, backlog: 1 });
      expect(w.days[9]).toMatchObject({ arrived: 4, departed: 2, backlog: w.totals.backlog_end });
   });
});

describe('windowStats: teams, reviews, weeks', () => {
   // Tue 2026-09-01 to Sun 2026-09-13: the weeks start Mon Aug 31, Sep 7
   const start = '2026-09-01';
   const end = '2026-09-13';
   const from = dayStart(start) as number;
   const teams: Record<string, string> = { dana: 'Store' };
   const teamOf = (login: string) => teams[login] ?? null;
   const w = windowStats(
      [
         // dana (a developer) opens and merges inside the first week: 2 days
         { author: 'dana', project: 'alpha', opened: from, closed: from + 2 * DAY, merged: true },
         // kyle (not a developer) opens in the second week, merged 4 days later
         { author: 'kyle', project: 'alpha', opened: from + 7 * DAY, closed: from + 11 * DAY, merged: true },
         // kyle again, with no project label, still open
         { author: 'kyle', project: null, opened: from + 8 * DAY, closed: null, merged: false },
      ],
      start,
      end,
      {
         teamOf,
         reviews: [
            { reviewer: 'dana', author: 'kyle', at: from + 9 * DAY },
            { reviewer: 'dana', author: 'dana', at: from + DAY }, // her own PR: not a review
            { reviewer: 'erin', author: 'dana', at: from + 3 * DAY },
            { reviewer: 'dana', author: 'kyle', at: from - DAY }, // before the window
         ],
      }
   );

   it('buckets opened and merged by developer or not, week by week from Monday', () => {
      expect(w.weeks.map(x => x.week)).toEqual(['2026-08-31', '2026-09-07']);
      expect(w.weeks[0].opened).toEqual({ developers: 1, non_developers: 0 });
      expect(w.weeks[1].opened).toEqual({ developers: 0, non_developers: 2 });
      expect(w.weeks[0].merged_by_project).toEqual({ alpha: 1 });
      expect(w.weeks[1].merged_by_project).toEqual({ alpha: 1 });
   });

   it('gives the median days to merge and the people split per bucket', () => {
      expect(w.totals.median_days_to_merge).toBe(3);
      expect(w.projects.alpha).toMatchObject({
         developers: 1,
         non_developers: 1,
         first_opened: '2026-09-01',
         last_closed: '2026-09-12',
      });
   });

   it('counts reviews given in the window on other people’s PRs, by whose PR', () => {
      expect(w.people.dana).toMatchObject({ team: 'Store', reviews: 1, reviews_on_non_dev: 1 });
      // erin reviewed but opened nothing: she still gets a row
      expect(w.people.erin).toMatchObject({ team: null, reviews: 1, reviews_on_non_dev: 0, opened: 0 });
      expect(w.weeks[0].reviews).toEqual({ on_developers: 1, on_non_developers: 0 });
      expect(w.weeks[1].reviews).toEqual({ on_developers: 0, on_non_developers: 1 });
   });
});
