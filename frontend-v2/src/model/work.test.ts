import { describe, expect, it } from 'vitest';
import { decideQueue } from '../../../shared/model/decide';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import {
   bodyLinks,
   issueCounts,
   issueQuery,
   itemState,
   parseIssueRef,
   planOfWork,
   planWork,
   projectWork,
   type AttachedIssue,
   type IssueHit,
   type IssueRef,
   type WorkPull,
} from '../../../shared/model/work';

const at = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;
const NOW = at('2026-09-30');
const ref = (number: number, repo = 'iFixit/ifixit'): IssueRef => ({ repo, number });
const key = (number: number) => `ifixit/ifixit#${number}`;

const plan = (id: number, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project: 'workbench',
   team: null,
   lead: null,
   status: 'active',
   origin: null,
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
   closedAt: null,
   state: 'open',
   links: [],
   ...over,
});
const merged = (day: string): Partial<WorkPull> => ({
   state: 'closed',
   mergedAt: at(day),
   closedAt: at(day),
});

const issue = (number: number, over: Partial<AttachedIssue> = {}): AttachedIssue => ({
   ref: ref(number),
   title: `Issue ${number}`,
   state: 'open',
   closedAt: null,
   author: 'sam',
   createdAt: at('2026-09-01'),
   via: ['label'],
   attachedAt: null,
   addedBy: null,
   ...over,
});

const hit = (number: number, over: Partial<IssueHit> = {}): IssueHit => ({
   ...ref(number),
   title: `Issue ${number}`,
   state: 'open',
   author: 'sam',
   createdAt: at('2026-09-01'),
   ...over,
});

describe('parseIssueRef', () => {
   it('reads the ways people paste an issue', () => {
      expect(parseIssueRef('iFixit/ifixit#63681')).toEqual(ref(63681));
      expect(
         parseIssueRef(' https://github.com/iFixit/ifixit/issues/64797#issuecomment-1 ')
      ).toEqual(ref(64797));
      expect(parseIssueRef('#12', 'iFixit/ops')).toEqual(ref(12, 'iFixit/ops'));
      // a bare number needs a repo to mean anything
      expect(parseIssueRef('#12')).toBeNull();
      expect(parseIssueRef('the launch epic')).toBeNull();
   });
});

describe('bodyLinks', () => {
   it('reads the issues a PR body links on purpose, not the ones it mentions in passing', () => {
      const body = [
         'Parts of #62502, #62503 and iFixit/ops#12',
         'Fixes: https://github.com/iFixit/ifixit/issues/64170',
         'connects to #9',
         // named again: still one link
         'Closes #62502',
         'Unlike #63000, this keeps the old header. See #1.',
         'Not part of the #63000 audit',
      ].join('\n');
      expect(bodyLinks(body, 'iFixit/ifixit')).toEqual([
         ref(62502),
         ref(62503),
         ref(12, 'iFixit/ops'),
         ref(64170),
         ref(9),
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
   it('gives work to the latest plan that had started when it arrived', () => {
      const launch = plan(1, { start: '2026-05-18', weeks: 15 });
      const feedback = plan(2, { start: '2026-09-21', weeks: 12 });
      expect(planOfWork([feedback, launch], at('2026-08-01'))?.id).toBe(1);
      expect(planOfWork([feedback, launch], at('2026-09-22'))?.id).toBe(2);
      // before every plan: the first one
      expect(planOfWork([feedback, launch], at('2026-01-05'))?.id).toBe(1);
      expect(planOfWork([], at('2026-01-05'))).toBeNull();
   });

   it('skips a plan marked done or dropped before the PR opened, while another runs', () => {
      const launch = plan(1, { start: '2026-07-06', weeks: 6 });
      // started Sep 7, dropped the next day
      const extra = plan(2, {
         start: '2026-09-07',
         status: 'dropped',
         updated_at: at('2026-09-08'),
      });
      expect(planOfWork([launch, extra], at('2026-09-14'))?.id).toBe(1);
      // opened before the drop: it was that plan's
      expect(planOfWork([launch, extra], at('2026-09-07'))?.id).toBe(2);
      // every started plan stopped: the latest still takes it, as work after it
      const done = plan(3, { start: '2026-07-06', status: 'done', updated_at: at('2026-08-20') });
      expect(planOfWork([done], at('2026-09-14'))?.id).toBe(3);
   });

   it('skips a parked plan too, so an earlier one can’t take the work after a later', () => {
      const launch = plan(1, { start: '2026-07-06', weeks: 6 });
      // started Aug 3, parked Aug 20
      const extra = plan(2, {
         start: '2026-08-03',
         status: 'parked',
         updated_at: at('2026-08-20'),
      });
      expect(planOfWork([launch, extra], at('2026-09-14'))?.id).toBe(1);
      // parked Jul 20, then a plan from Aug 3 done Sep 1: the work after is the done plan's
      const parked = plan(3, {
         start: '2026-07-06',
         status: 'parked',
         updated_at: at('2026-07-20'),
      });
      const done = plan(4, { start: '2026-08-03', status: 'done', updated_at: at('2026-09-01') });
      expect(planOfWork([parked, done], at('2026-09-14'))?.id).toBe(4);
   });

   it('goes by when a plan’s status changed, not by a later edit', () => {
      const launch = plan(1, { start: '2026-07-06', weeks: 6 });
      // dropped Aug 20, its notes edited Sep 20
      const extra = plan(2, {
         start: '2026-08-03',
         status: 'dropped',
         status_at: at('2026-08-20'),
         updated_at: at('2026-09-20'),
      });
      expect(planOfWork([launch, extra], at('2026-09-14'))?.id).toBe(1);
   });
});

describe('issueCounts', () => {
   it('counts each state and takes the last close it knows', () => {
      expect(
         issueCounts([
            issue(1),
            issue(2, { state: 'done', closedAt: at('2026-09-20') }),
            issue(3, { state: 'dropped', closedAt: at('2026-09-25') }),
            // closed, time not known: counted, but it can't be the last close
            issue(4, { state: 'done' }),
         ])
      ).toEqual({ total: 4, open: 1, done: 2, dropped: 1, lastClosedAt: at('2026-09-25') });
      expect(issueCounts([])).toEqual({
         total: 0,
         open: 0,
         done: 0,
         dropped: 0,
         lastClosedAt: null,
      });
   });
});

describe('planWork', () => {
   // the launch ran to 2026-08-30; its feedback round began 2026-09-21
   const launch = plan(1, { start: '2026-05-18', weeks: 15 });
   const feedback = plan(2, { start: '2026-09-21', weeks: 12 });
   // done on 2026-09-01: a PR in the week after is its tail, one later a comeback
   const tool = plan(3, {
      project: 'tool',
      status: 'done',
      start: '2026-08-03',
      weeks: 4,
      updated_at: at('2026-09-01'),
   });
   const work = planWork({
      plans: [launch, feedback, tool, plan(4, { project: null })],
      attached: new Map([['workbench', [issue(100)]]]),
      pulls: new Map([
         [
            'workbench',
            [
               pull(1, '2026-06-01', merged('2026-06-02')),
               pull(2, '2026-09-05'),
               pull(3, '2026-09-22'),
               pull(4, '2026-09-01', merged('2026-09-03')),
            ],
         ],
         ['tool', [pull(10, '2026-09-05'), pull(11, '2026-09-10')]],
      ]),
      unlabeled: [
         // no label: joins by linking the project's issue in its body
         pull(5, '2026-09-23', { links: [ref(100)] }),
         // or by the issue's side naming it (a closing reference)
         pull(6, '2026-09-24'),
         // links nothing attached anywhere: no project's
         pull(7, '2026-09-24', { links: [ref(999)] }),
      ],
      links: new Map([[key(100), [ref(6)]]]),
   });
   const ids = (prs: WorkPull[]) => prs.map(p => p.number);

   it('gives each PR to the plan running when it opened', () => {
      expect(work.map(w => [w.planId, w.openPulls])).toEqual([
         [1, 1],
         [2, 3],
         [3, 2],
         [4, 0],
      ]);
   });

   it('lists the PRs that opened after a plan’s end, oldest first', () => {
      expect(ids(work[0].afterEnd)).toEqual([4, 2]);
      expect(ids(work[1].afterEnd)).toEqual([]);
   });

   it('counts the PRs that opened more than a week after a plan was marked done', () => {
      expect(ids(work[2].afterEnd)).toEqual([10, 11]);
      expect(ids(work[2].afterDone)).toEqual([11]);
      expect(ids(work[0].afterDone)).toEqual([]);
   });

   it('counts from when it was marked done, not from a later edit', () => {
      // done Sep 1, its notes edited Sep 20
      const edited = { ...tool, status_at: at('2026-09-01'), updated_at: at('2026-09-20') };
      const [late] = planWork({
         plans: [edited],
         attached: new Map(),
         pulls: new Map([['tool', [pull(11, '2026-09-10')]]]),
         links: new Map(),
      });
      expect(ids(late.afterDone)).toEqual([11]);
   });

   it('leaves the work after a done plan to it, so Decide still reopens it', () => {
      // parked Jul 20; a later plan was done Sep 1, and a PR opened Sep 14
      const parked = plan(5, {
         start: '2026-07-06',
         status: 'parked',
         updated_at: at('2026-07-20'),
      });
      const done = plan(6, { start: '2026-08-03', status: 'done', updated_at: at('2026-09-01') });
      const after = planWork({
         plans: [parked, done],
         attached: new Map(),
         pulls: new Map([['workbench', [pull(20, '2026-09-14', merged('2026-09-15'))]]]),
         links: new Map(),
      });
      expect(after.map(w => [w.planId, ids(w.afterDone)])).toEqual([
         [5, []],
         [6, [20]],
      ]);
      const rows = decideQueue({
         live: [
            {
               slug: 'workbench',
               firstOpened: null,
               lastActivity: at('2026-09-15'),
               open: 0,
               prs: 1,
               due: null,
            },
         ],
         items: [parked, done],
         planCounts: new Map(
            after.map(w => [
               w.planId,
               {
                  openPulls: w.openPulls,
                  afterEnd: w.afterEnd.length,
                  afterDone: w.afterDone.length,
               },
            ])
         ),
         today: '2026-09-30',
         now: NOW,
      });
      expect(rows.map(r => [r.item?.id, r.reasons.map(x => x.kind)])).toEqual([[6, ['reopened']]]);
   });
});

describe('projectWork', () => {
   const page = projectWork(
      {
         plans: [],
         attached: new Map([
            [
               'workbench',
               [
                  issue(100),
                  issue(101, { state: 'done', closedAt: at('2026-09-20'), via: ['hand'] }),
                  issue(102, { state: 'dropped' }),
               ],
            ],
         ]),
         pulls: new Map([
            [
               'workbench',
               [
                  pull(200, '2026-09-25', { links: [ref(100)] }),
                  pull(201, '2026-09-26', merged('2026-09-28')),
                  // merged long ago: off the page
                  pull(202, '2026-07-01', merged('2026-07-05')),
                  pull(203, '2026-09-27', { links: [ref(300)] }),
                  // merged, and newer than the open ones: it still lists after them
                  pull(209, '2026-09-29', merged('2026-09-29')),
                  pull(204, '2026-09-29', { links: [ref(301)] }),
                  pull(205, '2026-09-10', {
                     ...merged('2026-09-12'),
                     // the project's own issue, a PR, an issue closed long
                     // ago, one closed lately, and one #203 links too
                     links: [ref(1), ref(206), ref(302), ref(303), ref(300)],
                  }),
               ],
            ],
         ]),
         unlabeled: [pull(206, '2026-09-24', { links: [ref(101)] })],
         links: new Map([
            // from the issue's side: #200 again, and PRs the body doesn't say
            [key(100), [ref(200), ref(150)]],
            [key(101), [ref(208)]],
         ]),
         knownPulls: new Map([
            [key(208), pull(208, '2026-09-01', { ...merged('2026-09-02'), title: 'Elsewhere' })],
         ]),
         knownIssues: new Map([
            [key(301), hit(301, { title: 'Show the queue' })],
            [key(302), hit(302, { state: 'done', closedAt: at('2026-08-01') })],
            [key(303), hit(303, { state: 'done', closedAt: at('2026-09-15') })],
         ]),
         notIssues: new Set([key(1)]),
      },
      'workbench',
      NOW
   );
   const numbers = (list: { number: number }[]) => list.map(p => p.number);

   it('lists each issue with the PRs that link it from either side, newest first', () => {
      expect(page.issues.map(i => [i.ref.number, numbers(i.prs)])).toEqual([
         [100, [200, 150]],
         [101, [206, 208]],
         [102, []],
      ]);
      // a PR the board never read shows by its number alone
      expect(page.issues[0].prs[1]).toEqual({
         ...ref(150),
         title: null,
         author: null,
         createdAt: null,
         state: null,
      });
      expect(page.issues[1].prs[1]).toMatchObject({ title: 'Elsewhere', state: 'merged' });
   });

   it('lists its PRs that link none of its issues: open ones first, then closed lately', () => {
      expect(numbers(page.unlinked)).toEqual([204, 203, 209, 201]);
   });

   it('suggests the issues its recent PRs link that aren’t attached', () => {
      expect(page.suggested.map(s => [s.number, s.title, numbers(s.linkedBy)])).toEqual([
         // never seen by the board: just its number
         [300, '', [203, 205]],
         [301, 'Show the queue', [204]],
         [303, 'Issue 303', [205]],
      ]);
   });

   it('counts its issues', () => {
      expect(page.counts).toEqual({
         total: 3,
         open: 1,
         done: 1,
         dropped: 1,
         lastClosedAt: at('2026-09-20'),
      });
   });

   it('says which other projects have each issue, by label or by hand', () => {
      const shared = projectWork(
         {
            plans: [],
            attached: new Map([
               ['workbench', [issue(100), issue(101)]],
               ['printing', [issue(100), issue(300, { via: ['hand'] })]],
               ['labels', [issue(100, { via: ['label', 'hand'] })]],
            ]),
            pulls: new Map([
               ['workbench', [pull(200, '2026-09-25', { links: [ref(300), ref(301)] })]],
            ]),
            links: new Map(),
         },
         'workbench',
         NOW
      );
      expect(shared.issues.map(i => [i.ref.number, i.alsoIn])).toEqual([
         [100, ['labels', 'printing']],
         [101, []],
      ]);
      expect(shared.suggested.map(s => [s.number, s.alsoIn])).toEqual([
         [300, ['printing']],
         [301, []],
      ]);
   });

   it('lists nothing for a project with no issues and no PRs', () => {
      const empty = projectWork(
         { plans: [], attached: new Map(), pulls: new Map(), links: new Map() },
         'nothing',
         NOW
      );
      expect(empty).toEqual({
         issues: [],
         unlinked: [],
         suggested: [],
         counts: { total: 0, open: 0, done: 0, dropped: 0, lastClosedAt: null },
      });
   });
});

describe('issueQuery', () => {
   it('tells an issue link, a number and words apart', () => {
      expect(issueQuery('https://github.com/iFixit/ifixit/issues/64797')).toEqual({
         kind: 'ref',
         ref: ref(64797),
      });
      expect(issueQuery(' #64797 ')).toEqual({ kind: 'number', number: 64797 });
      expect(issueQuery('workbench feedback')).toEqual({
         kind: 'words',
         words: 'workbench feedback',
      });
      expect(issueQuery('w')).toBeNull();
      expect(issueQuery('  ')).toBeNull();
      // past GitHub's largest issue number: not a number to look up
      expect(issueQuery('99999999999')).toBeNull();
   });
});
