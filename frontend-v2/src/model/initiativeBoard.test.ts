import { describe, expect, it } from 'vitest';
import type { Initiative } from '../../../shared/model/initiatives';
import type { Project, ProjectGroup, Today } from '../../../shared/model/projects';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import {
   bandGloss,
   grownProjects,
   guessHome,
   homeChoices,
   homeWords,
   spanWords,
   trackedToday,
} from './initiativeBoard';
import { groupItems, portfolioItems, type PortfolioItem } from './portfolio';
import { trackedData, untrackedSlugs, type ProjectsData } from './projectData';
import { mergeOrder, trackedPlans } from './roadmapData';

const NOW = Date.UTC(2026, 9, 11, 12);

const initiative = (
   id: number,
   slug: string,
   projects: string[],
   over: Partial<Initiative> = {}
): Initiative => ({
   id,
   slug,
   name: slug.replace(/-/g, ' '),
   kind: 'initiative',
   goal: '',
   owner: null,
   priority: id,
   status: 'open',
   status_at: null,
   created_by: null,
   created_at: null,
   updated_by: null,
   updated_at: null,
   projects: projects.map(project => ({ project, set_by: null, set_at: 0, baseline_prs: 0 })),
   ...over,
});

const group = (slug: string, people: string[] = []): ProjectGroup => ({
   slug,
   project: null,
   open: [],
   merged: [],
   closed: [],
   people,
   idleDays: null,
   lastActivity: null,
   flags: [],
});

const plan = (id: number, project: string, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project,
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 4,
   end_kind: 'soft',
   done_when: '',
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   created_at: null,
   update: null,
   ...over,
});

const person = (
   slug: string,
   developers: string[]
): Pick<PortfolioItem, 'slug' | 'developers' | 'nonDevelopers'> => ({
   slug,
   developers,
   nonDevelopers: [],
});

describe('trackedToday', () => {
   it('leaves the Not tracked projects out, and the PRs in no project in', () => {
      const today: Today = {
         live: [group('kept'), group('ops')],
         quiet: [group('quiet-ops')],
         misc: [],
         unsorted: [],
         doubleLabeled: [],
      };
      const tracked = trackedToday(today, new Set(['ops', 'quiet-ops']));
      expect(tracked.live.map(g => g.slug)).toEqual(['kept']);
      expect(tracked.quiet).toEqual([]);
      expect(trackedToday(today, new Set())).toBe(today);
   });
});

describe('grownProjects', () => {
   it('asks about the grown ones still Not tracked, with their counts', () => {
      const data = {
         grew: ['ops', 'moved'],
         grew_counts: { ops: { since: 31, baseline: 2 }, moved: { since: 40, baseline: 9 } },
      };
      // moved was filed in an initiative on this board since
      const filed = [initiative(1, 'site', ['moved'])];
      expect(grownProjects(data, filed)).toEqual([{ slug: 'ops', since: 31, baseline: 2 }]);
      expect(grownProjects(undefined, null)).toEqual([]);
   });
});

describe('guessHome', () => {
   const initiatives = [
      initiative(1, 'site-speed', ['cache', 'cdn']),
      initiative(2, 'fixbot', ['answers']),
      initiative(3, 'not-tracked', ['dotfiles'], { kind: 'untracked' }),
      initiative(4, 'old', ['legacy'], { status: 'done' }),
   ];
   const items = [
      person('new-thing', ['dana', 'erin']),
      person('cache', ['dana']),
      person('cdn', ['dana', 'finn']),
      person('answers', ['erin']),
      person('dotfiles', ['dana', 'erin']),
      person('legacy', ['dana', 'erin']),
   ];

   it('picks the initiative its people work in most', () => {
      expect(guessHome('new-thing', items, initiatives)?.slug).toBe('site-speed');
   });

   it('never guesses Not tracked or a closed initiative', () => {
      const only = items.filter(i => ['new-thing', 'dotfiles', 'legacy'].includes(i.slug));
      expect(guessHome('new-thing', only, initiatives)).toBeNull();
   });

   it('breaks a tie by rank', () => {
      const tie = [
         person('new-thing', ['erin']),
         person('cache', ['erin']),
         person('answers', ['erin']),
      ];
      expect(guessHome('new-thing', tie, initiatives)?.slug).toBe('site-speed');
   });
});

describe('the words', () => {
   it('lists the homes to choose: open initiatives in rank, Not tracked last', () => {
      const list = [
         initiative(5, 'not-tracked', [], { kind: 'untracked', priority: 0 }),
         initiative(2, 'b', []),
         initiative(1, 'a', []),
         initiative(3, 'closed', [], { status: 'dropped' }),
      ];
      expect(homeChoices(list).map(i => i.slug)).toEqual(['a', 'b', 'not-tracked']);
   });

   it('says where a project lives', () => {
      expect(homeWords(initiative(1, 'site-speed', []))).toBe('in site speed');
      expect(homeWords(initiative(2, 'nt', [], { kind: 'untracked' }))).toBe('Not tracked');
      expect(homeWords(null)).toBe('in no initiative');
   });

   it('says a band’s dates and counts from its projects’ plans', () => {
      const plans = [
         plan(1, 'a', { start: '2026-07-13', weeks: 16 }),
         plan(2, 'a', { start: '2026-08-03', weeks: 4, end_kind: 'ongoing' }),
         plan(3, 'b', { start: '2026-06-01', status: 'done', weeks: 2 }),
         plan(4, 'c', { start: '2026-01-05', status: 'parked' }),
      ];
      expect(spanWords(['a', 'b', 'c'], plans, NOW)).toBe(
         'Jun 1 to Nov 1 · 1 with an end · 1 ongoing'
      );
      expect(spanWords(['b'], plans, NOW)).toBe('Ended Jun 14');
      expect(spanWords(['nothing'], plans, NOW)).toBe('');
   });

   it('glosses a band with its goal, what it holds and its owner', () => {
      const site = initiative(1, 'site', [], { goal: 'Pages load fast', owner: 'dana' });
      expect(bandGloss(site, 10, 7)).toBe(
         'Pages load fast. 10 projects, 7 being worked on. Owner: dana.'
      );
   });
});

/**
 * The tracked sources (R4): a Not tracked project is absent from every list
 * a view reads by default, and present in the three places that name the
 * full set: its own project page, the Roadmap's Not tracked lane and the
 * Overview's Not tracked group.
 */
describe('a Not tracked project', () => {
   const project = (slug: string): Project => ({
      slug,
      name: slug,
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
   });
   const data = {
      projects: [project('store'), project('ops')],
      untracked: ['ops'],
      window: {
         projects: { store: {}, ops: {} },
         totals: { opened: 9 },
      },
   } as unknown as ProjectsData;
   const fullToday: Today = {
      live: [group('store', ['dana']), group('ops', ['dana'])],
      quiet: [],
      misc: [],
      unsorted: [],
      doubleLabeled: [],
   };
   // the server set the flag on its plan
   const allPlans = [plan(1, 'store'), plan(2, 'ops', { untracked: true }), plan(3, 'store')];
   const initiatives = [initiative(1, 'store-work', ['store'])];
   const untracked = untrackedSlugs(data, initiatives);
   const today = trackedToday(fullToday, untracked);
   const plans = trackedPlans(allPlans, initiatives);
   const all = portfolioItems(data.projects, fullToday, {}, () => 'Store', NOW, allPlans);
   const items = all.filter(i => !untracked.has(i.slug));

   it('is in none of the default lists', () => {
      expect(untracked).toEqual(new Set(['ops']));
      expect(today.live.map(g => g.slug)).toEqual(['store']);
      expect(plans.map(p => p.id)).toEqual([1, 3]);
      expect(items.map(i => i.slug)).toEqual(['store']);
      const tracked = trackedData(data, initiatives);
      expect(tracked.projects.map(p => p.slug)).toEqual(['store']);
      expect(Object.keys(tracked.window.projects)).toEqual(['store']);
      // the server's aggregates count everything
      expect(tracked.window.totals).toBe(data.window.totals);
      // grouped by initiative it's in no group, Unsorted included
      expect(
         groupItems(items, 'initiative', undefined, [], initiatives).flatMap(g => g.items)
      ).toEqual(items);
   });

   it('is on its own page, in the Roadmap’s Not tracked lane and the Overview’s group', () => {
      // its page reads one slug from the full set
      expect(all.find(i => i.slug === 'ops')?.plan?.id).toBe(2);
      // the Roadmap's lane: every plan less the tracked ones
      const tracked = new Set(plans.map(p => p.id));
      expect(allPlans.filter(p => !tracked.has(p.id)).map(p => p.id)).toEqual([2]);
      // the Overview's group
      expect(all.filter(i => untracked.has(i.slug)).map(i => i.slug)).toEqual(['ops']);
      // and a reorder of the tracked plans keeps its place in the whole order
      expect(mergeOrder(allPlans, [3, 1])).toEqual([3, 2, 1]);
   });

   it('is tracked again the moment a filing on this board says so', () => {
      const filed = [...initiatives, initiative(2, 'ops-work', ['ops'])];
      expect(untrackedSlugs(data, filed)).toEqual(new Set());
      expect(trackedPlans(allPlans, filed).map(p => p.id)).toEqual([1, 2, 3]);
   });
});
