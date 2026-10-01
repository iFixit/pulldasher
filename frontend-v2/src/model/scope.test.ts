import { describe, expect, it } from 'vitest';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import {
   bodyLinks,
   itemState,
   parseChecklist,
   parseIssueRef,
   issueQuery,
   planOfWork,
   planScopes,
   projectIssues,
   scopeCounts,
   type ScopeItem,
   type WorkPull,
} from '../../../shared/model/scope';

const DAY = 86400;
const at = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;

const plan = (id: number, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project: 'workbench',
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   spec: null,
   start: '2026-05-18',
   weeks: 15,
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   created_at: at('2026-05-18'),
   update: null,
   ...over,
});

const pull = (number: number, day: string, over: Partial<WorkPull> = {}): WorkPull => ({
   repo: 'iFixit/ifixit',
   number,
   title: `PR ${number}`,
   author: 'dana',
   createdAt: at(day),
   mergedAt: null,
   state: 'open',
   ...over,
});

const item = (number: number, over: Partial<ScopeItem> = {}): ScopeItem => ({
   source: 'sub',
   ref: { repo: 'iFixit/ifixit', number },
   title: `Issue ${number}`,
   state: 'open',
   closedAt: null,
   joinedAt: null,
   ...over,
});

describe('parseIssueRef', () => {
   it('reads the ways people paste an issue', () => {
      expect(parseIssueRef('iFixit/ifixit#63681')).toEqual({
         repo: 'iFixit/ifixit',
         number: 63681,
      });
      expect(
         parseIssueRef(' https://github.com/iFixit/ifixit/issues/64797#issuecomment-1 ')
      ).toEqual({
         repo: 'iFixit/ifixit',
         number: 64797,
      });
      expect(parseIssueRef('#12', 'iFixit/ops')).toEqual({ repo: 'iFixit/ops', number: 12 });
      // a bare number needs a repo to mean anything
      expect(parseIssueRef('#12')).toBeNull();
      expect(parseIssueRef('the launch epic')).toBeNull();
   });
});

describe('parseChecklist', () => {
   it('reads each box, the first issue a line names, and skips fenced code', () => {
      const body = [
         '## Launch',
         '- [x] #63236 (PR up: #63445)',
         '* [ ] iFixit/ops#12 nightly export',
         '- [X] Decide the default units',
         '```',
         '- [ ] not a real task',
         '```',
         '  + [ ] https://github.com/iFixit/ifixit/issues/61513 pick a name',
         '- not a box',
         '- [ ] Mobile drawer, keeping the language row from #63064',
         '- [ ] **#64776** stop the double submit',
      ].join('\n');
      expect(parseChecklist(body, 'iFixit/ifixit')).toEqual([
         {
            checked: true,
            text: '#63236 (PR up: #63445)',
            ref: { repo: 'iFixit/ifixit', number: 63236 },
         },
         {
            checked: false,
            text: 'iFixit/ops#12 nightly export',
            ref: { repo: 'iFixit/ops', number: 12 },
         },
         { checked: true, text: 'Decide the default units', ref: null },
         {
            checked: false,
            text: 'https://github.com/iFixit/ifixit/issues/61513 pick a name',
            ref: { repo: 'iFixit/ifixit', number: 61513 },
         },
         // an issue named further in is context, not the task
         { checked: false, text: 'Mobile drawer, keeping the language row from #63064', ref: null },
         {
            checked: false,
            text: '**#64776** stop the double submit',
            ref: { repo: 'iFixit/ifixit', number: 64776 },
         },
      ]);
      expect(parseChecklist(null, 'iFixit/ifixit')).toEqual([]);
   });
});

describe('bodyLinks', () => {
   it('reads the issues a PR body links on purpose, not the ones it mentions in passing', () => {
      const body = [
         'Parts of #62502, #62503 and iFixit/ops#12',
         'Fixes: https://github.com/iFixit/ifixit/issues/64170',
         'connects to #9',
         'Unlike #63000, this keeps the old header. See #1.',
         'Not part of the #63000 audit',
      ].join('\n');
      expect(bodyLinks(body, 'iFixit/ifixit')).toEqual([
         { repo: 'iFixit/ifixit', number: 62502 },
         { repo: 'iFixit/ifixit', number: 62503 },
         { repo: 'iFixit/ops', number: 12 },
         { repo: 'iFixit/ifixit', number: 64170 },
         { repo: 'iFixit/ifixit', number: 9 },
      ]);
      expect(bodyLinks(null, 'iFixit/ifixit')).toEqual([]);
   });
});

describe('itemState', () => {
   it('counts not planned and duplicate as dropped, any other close as done', () => {
      expect(itemState('OPEN', null)).toBe('open');
      expect(itemState('closed', 'completed')).toBe('done');
      expect(itemState('CLOSED', 'NOT_PLANNED')).toBe('dropped');
      expect(itemState('closed', 'duplicate')).toBe('dropped');
      expect(itemState('closed', null)).toBe('done');
   });
});

describe('planOfWork', () => {
   const launch = plan(1, { start: '2026-05-18', weeks: 15 });
   const feedback = plan(2, { start: '2026-09-21', weeks: 12 });

   it('gives work to the latest plan that had started when it arrived', () => {
      expect(planOfWork([feedback, launch], at('2026-08-01'))?.id).toBe(1);
      expect(planOfWork([feedback, launch], at('2026-09-22'))?.id).toBe(2);
      // before every plan: the first one
      expect(planOfWork([feedback, launch], at('2026-01-05'))?.id).toBe(1);
      expect(planOfWork([], at('2026-01-05'))).toBeNull();
   });

   it('lets a link into one plan’s scope beat the date', () => {
      expect(planOfWork([launch, feedback], at('2026-09-29'), new Set([1]))?.id).toBe(1);
      // linking both: back to the date
      expect(planOfWork([launch, feedback], at('2026-09-29'), new Set([1, 2]))?.id).toBe(2);
   });

   it('ignores a link into a plan that hadn’t started yet', () => {
      expect(planOfWork([launch, feedback], at('2026-09-05'), new Set([2]))?.id).toBe(1);
   });
});

describe('planScopes', () => {
   const launch = plan(1, {
      spec: { repo: 'iFixit/ifixit', number: 63681 },
      start: '2026-05-18',
      weeks: 15,
      created_at: at('2026-05-18'),
   });
   const feedback = plan(2, {
      spec: { repo: 'iFixit/ifixit', number: 64797 },
      start: '2026-09-21',
      weeks: 12,
      created_at: at('2026-09-20'),
   });
   const specs = new Map([
      [
         'iFixit/ifixit#63681',
         {
            title: 'Workbench release burndown',
            found: true,
            items: [
               item(63023, {
                  state: 'done',
                  closedAt: at('2026-08-20'),
                  joinedAt: at('2026-08-05'),
               }),
               // added to the launch's spec after the launch's end
               item(62957, { joinedAt: at('2026-09-03') }),
               item(61513, { source: 'check' }),
            ],
         },
      ],
      [
         'iFixit/ifixit#64797',
         {
            title: 'Resolve open Workbench feedback',
            found: true,
            items: [
               item(64825, { joinedAt: at('2026-09-25') }),
               item(64826, {
                  state: 'dropped',
                  closedAt: at('2026-09-27'),
                  joinedAt: at('2026-09-25'),
               }),
            ],
         },
      ],
   ]);
   const scopes = planScopes({
      plans: [launch, feedback],
      specs,
      attached: new Map([
         [
            'workbench',
            [
               // labeled in August: the launch's
               item(62000, { source: 'label', joinedAt: at('2026-08-10') }),
               // already a launch sub-issue: stays there, counted once
               item(62957, { source: 'label', joinedAt: at('2026-09-28') }),
            ],
         ],
      ]),
      pulls: new Map([
         [
            'workbench',
            [
               pull(1, '2026-07-01'),
               // after the launch's end (Aug 30), before feedback started
               pull(2, '2026-09-05'),
               // after feedback started, but "Parts of #62957", a launch issue
               pull(3, '2026-09-28'),
               // after feedback started, no link: feedback's
               pull(4, '2026-09-29'),
            ],
         ],
      ]),
      links: new Map([['iFixit/ifixit#3', [{ repo: 'iFixit/ifixit', number: 62957 }]]]),
   });
   const [l, f] = scopes;

   it('builds each plan’s scope from its spec and its project’s labeled issues', () => {
      expect(l.items.map(i => i.ref?.number)).toEqual([63023, 62957, 61513, 62000]);
      expect([l.done, l.open, l.dropped]).toEqual([1, 3, 0]);
      expect([f.done, f.open, f.dropped]).toEqual([0, 1, 1]);
      expect(l.specTitle).toBe('Workbench release burndown');
   });

   it('puts each issue’s PRs on it, with title and state when the project has them', () => {
      expect(l.items[1].prs).toEqual([
         { repo: 'iFixit/ifixit', number: 3, title: 'PR 3', state: 'open' },
      ]);
      expect(l.items[0].prs).toEqual([]);
   });

   it('counts what joined a plan’s spec after its end, and its open PRs', () => {
      expect(l.addedAfterEnd).toBe(1);
      expect(f.addedAfterEnd).toBe(0);
      expect([l.openPulls, f.openPulls]).toEqual([3, 1]);
   });

   it('lists the PRs that arrived after a plan’s end, split by date and link', () => {
      expect(l.afterEnd.map(p => p.number)).toEqual([2, 3]);
      expect(f.afterEnd).toEqual([]);
   });

   it('gives Decide the counts it needs', () => {
      expect(scopeCounts(l)).toEqual({
         total: 4,
         done: 1,
         dropped: 0,
         lastClosedAt: at('2026-08-20'),
         afterEnd: 2,
         afterDone: 0,
         openPulls: 3,
      });
   });

   it('counts PRs that opened more than a week after a plan was marked done', () => {
      const done = plan(5, {
         project: 'trusted-shops',
         status: 'done',
         start: '2026-05-11',
         weeks: 6,
         updated_at: at('2026-06-20'),
      });
      const [s] = planScopes({
         plans: [done],
         specs: new Map(),
         attached: new Map(),
         pulls: new Map([
            [
               'trusted-shops',
               [
                  pull(10, '2026-06-24'),
                  pull(11, '2026-09-28', { state: 'closed', mergedAt: at('2026-09-29') }),
               ],
            ],
         ]),
         links: new Map(),
      });
      // #10 is the tail (within a week of done); #11 came back months later
      expect(s.afterDone.map(p => p.number)).toEqual([11]);
      expect(s.afterEnd.map(p => p.number)).toEqual([10, 11]);
      expect(at('2026-06-24') - at('2026-06-20')).toBeLessThan(7 * DAY);
   });
});

describe('planScopes, between back-to-back plans', () => {
   const v1 = plan(1, {
      spec: { repo: 'iFixit/ifixit', number: 100 },
      start: '2026-05-18',
      weeks: 15,
   });
   const v2 = plan(2, {
      spec: { repo: 'iFixit/ifixit', number: 200 },
      start: '2026-09-21',
      weeks: 12,
   });
   // keyed the way a person might type the repo: keys ignore case
   const specs = new Map([
      [
         'ifixit/IFIXIT#100',
         {
            title: 'v1.0',
            found: true,
            items: [
               item(101, { state: 'done', closedAt: at('2026-08-01') }),
               // not finished in v1.0, and listed again for v1.1
               item(102),
            ],
         },
      ],
      ['iFixit/ifixit#200', { title: 'v1.1', found: true, items: [item(102), item(201)] }],
   ]);
   const scopes = planScopes({
      plans: [v1, v2],
      specs,
      attached: new Map(),
      pulls: new Map([['workbench', [pull(1, '2026-09-25')]]]),
      links: new Map([
         // "Parts of #100": the v1.0 epic itself
         ['iFixit/ifixit#1', [{ repo: 'iFixit/ifixit', number: 100 }]],
         ['iFixit/ifixit#7', [{ repo: 'iFixit/ifixit', number: 101 }]],
         ['iFixit/ifixit#8', [{ repo: 'iFixit/ifixit', number: 201 }]],
      ]),
      unlabeled: [
         // no project label, but it links a v1.0 issue
         pull(7, '2026-09-10', { state: 'closed', mergedAt: at('2026-09-11') }),
         // it links only v1.1's scope, before v1.1 started: not the project's
         pull(8, '2026-09-12'),
      ],
   });
   const [a, b] = scopes;

   it('counts an open item a later plan lists too as moved, so the earlier plan can finish', () => {
      expect(a.items[1].movedTo).toBe(2);
      expect([a.done, a.open, a.moved]).toEqual([1, 0, 1]);
      expect(scopeCounts(a)).toMatchObject({ total: 1, done: 1 });
      // the later plan still has it open
      expect([b.open, b.moved]).toEqual([2, 0]);
   });

   it('links a PR to the plan whose spec issue it names, and counts unlabeled PRs that link a scope', () => {
      // #1 opened after v1.1 started, but it names v1.0's epic
      expect(a.afterEnd.map(p => p.number)).toEqual([7, 1]);
      expect(b.afterEnd).toEqual([]);
      expect(a.items[0].prs).toEqual([
         { repo: 'iFixit/ifixit', number: 7, title: 'PR 7', state: 'merged' },
      ]);
   });
});

describe('scopeCounts', () => {
   it('takes the last close it knows, past items with no close time', () => {
      const [s] = planScopes({
         plans: [plan(1, { spec: { repo: 'iFixit/ifixit', number: 100 } })],
         specs: new Map([
            [
               'iFixit/ifixit#100',
               {
                  title: 'Spec',
                  found: true,
                  items: [
                     item(1, { state: 'done', closedAt: at('2026-08-01') }),
                     item(2, { state: 'done', closedAt: null }),
                  ],
               },
            ],
         ]),
         attached: new Map(),
         pulls: new Map(),
         links: new Map(),
      });
      expect(scopeCounts(s).lastClosedAt).toBe(at('2026-08-01'));
   });
});

describe('projectIssues', () => {
   const launch = plan(1, {
      spec: { repo: 'iFixit/ifixit', number: 100 },
      start: '2026-05-18',
      weeks: 15,
   });
   const inputs = {
      plans: [launch],
      specs: new Map([
         [
            'iFixit/ifixit#100',
            {
               title: 'Launch',
               found: true,
               items: [
                  item(101),
                  item(102, { state: 'done' as const, closedAt: at('2026-08-01') }),
               ],
            },
         ],
      ]),
      attached: new Map([
         [
            'workbench',
            [
               // in the spec and labeled too: listed once
               item(101, { source: 'label', joinedAt: at('2026-08-10') }),
               // added by hand on the board
               item(103, { source: 'hand', joinedAt: at('2026-09-01'), addedBy: 'dana' }),
            ],
         ],
         // a project with no plans yet still lists its issues
         ['docs', [item(7, { source: 'label', joinedAt: at('2026-09-02') })]],
      ]),
      pulls: new Map(),
      links: new Map([['iFixit/ifixit#5', [{ repo: 'iFixit/ifixit', number: 103 }]]]),
   };

   it('lists a project’s spec items and attached issues once, with how each is attached', () => {
      const rows = projectIssues(inputs, 'workbench');
      expect(rows.map(r => [r.ref?.number, r.via, r.plans])).toEqual([
         [101, ['sub', 'label'], [1]],
         [102, ['sub'], [1]],
         [103, ['hand'], [1]],
      ]);
      expect(rows[2].addedBy).toBe('dana');
      // a PR that links an issue added by hand
      expect(rows[2].prs?.map(p => p.number)).toEqual([5]);
   });

   it('lists the issues of a project with no plans', () => {
      expect(projectIssues(inputs, 'docs').map(r => [r.ref?.number, r.plans])).toEqual([[7, []]]);
   });
});

describe('issueQuery', () => {
   it('tells an issue link, a number and words apart', () => {
      expect(issueQuery('https://github.com/iFixit/ifixit/issues/64797')).toEqual({
         kind: 'ref',
         ref: { repo: 'iFixit/ifixit', number: 64797 },
      });
      expect(issueQuery(' #64797 ')).toEqual({ kind: 'number', number: 64797 });
      expect(issueQuery('workbench feedback')).toEqual({
         kind: 'words',
         words: 'workbench feedback',
      });
      expect(issueQuery('w')).toBeNull();
      expect(issueQuery('  ')).toBeNull();
   });
});
