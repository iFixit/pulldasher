import { describe, expect, it } from 'vitest';
import { dayStart } from '../../../shared/model/projects';
import { labeledBy } from '../../../shared/model/projectLabel';
import { autoCalls, leadOf, IDLE_DAYS, type AutoPull } from '../../../shared/model/autoCalls';
import {
   answeredOnItsOwn,
   decideQueue,
   type DecideProject,
   type DecideRow,
} from '../../../shared/model/decide';
import type { RoadmapItem } from '../../../shared/model/roadmap';

const today = '2026-09-30';
const NOW = dayStart(today) as number;
const DAY = 86400;
const ago = (days: number) => NOW - days * DAY;

const item = (id: number, over: Partial<RoadmapItem>): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project: `p${id}`,
   team: null,
   lead: 'dana',
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 8,
   end_kind: 'soft',
   done_when: '',
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: 'dana',
   updated_at: ago(30),
   status_at: ago(30),
   created_at: ago(60),
   update: null,
   ...over,
});
const pull = (number: number, over: Partial<AutoPull> = {}): AutoPull => ({
   repo: 'iFixit/ifixit',
   number,
   author: 'erin',
   opened: ago(5),
   merged: null,
   pushed: null,
   open: true,
   labeledAt: ago(5),
   ...over,
});
const project = (slug: string, over: Partial<DecideProject> = {}): DecideProject => ({
   slug,
   firstOpened: '2026-09-21',
   lastActivity: ago(1),
   open: 0,
   prs: 3,
   due: null,
   ...over,
});

/** The calls for these plans and PRs, with Decide's rows read as the server does. */
function calls(
   items: RoadmapItem[],
   pulls: Record<string, AutoPull[]>,
   { rows = [] as DecideRow[], planned = new Set<string>(), ongoing = new Set<string>() } = {}
) {
   return autoCalls({
      rows,
      items,
      pulls: new Map(Object.entries(pulls)),
      planned: new Set([...planned, ...items.map(i => i.project ?? '')]),
      ongoing,
      now: NOW,
   });
}

describe('picked up again', () => {
   it('puts a done, dropped or parked plan back in progress on a PR opened after', () => {
      for (const status of ['done', 'dropped', 'parked'] as const) {
         const got = calls([item(1, { status, status_at: ago(10) })], {
            p1: [pull(7, { opened: ago(3), labeledAt: ago(3) })],
         });
         expect(got).toEqual([
            {
               kind: 'status',
               id: 1,
               from: status,
               status: 'active',
               note: 'Picked up again by iFixit/ifixit#7 on 2026-09-27',
            },
         ]);
      }
   });

   it('counts an older open PR newly labeled into it', () => {
      const got = calls([item(1, { status: 'done', status_at: ago(10) })], {
         p1: [pull(7, { opened: ago(40), labeledAt: ago(2) })],
      });
      expect(got[0]).toMatchObject({
         status: 'active',
         note: expect.stringContaining('2026-09-28'),
      });
   });

   it('leaves a plan marked done while its old PRs are still open', () => {
      const got = calls([item(1, { status: 'done', status_at: ago(2) })], {
         p1: [pull(7, { opened: ago(20), labeledAt: ago(20) })],
      });
      expect(got).toEqual([]);
   });

   it('reads only the latest plan, and none when another is under way', () => {
      const pulls = { p1: [pull(7, { opened: ago(1) })] };
      const old = item(1, { status: 'done', status_at: ago(40) });
      const later = item(2, { project: 'p1', status: 'done', status_at: ago(10) });
      expect(calls([old, later], pulls).map(c => 'id' in c && c.id)).toEqual([2]);
      const running = item(2, { project: 'p1', status: 'planned' });
      expect(calls([old, running], pulls)).toEqual([]);
   });

   it('lets work go on after a finished plan of an ongoing project', () => {
      const got = calls(
         [item(1, { status: 'done', status_at: ago(10) })],
         { p1: [pull(7, { opened: ago(1) })] },
         { ongoing: new Set(['p1']) }
      );
      expect(got).toEqual([]);
   });
});

describe('put down', () => {
   it(`parks a plan in progress after ${IDLE_DAYS} days with no PR opened, merged or pushed`, () => {
      const got = calls([item(1, { status_at: ago(90) })], {
         p1: [pull(7, { opened: ago(80), merged: ago(40), open: false, pushed: ago(30) })],
      });
      expect(got).toEqual([
         {
            kind: 'status',
            id: 1,
            from: 'active',
            status: 'parked',
            note: 'Put down: no PR opened, merged or pushed to since 2026-08-31',
         },
      ]);
   });

   it('keeps one with a push inside the window', () => {
      const got = calls([item(1, { status_at: ago(90) })], {
         p1: [pull(7, { opened: ago(80), pushed: ago(3) })],
      });
      expect(got).toEqual([]);
   });

   it('keeps one whose status someone set inside the window', () => {
      const got = calls([item(1, { status_at: ago(5) })], {
         p1: [pull(7, { opened: ago(80) })],
      });
      expect(got).toEqual([]);
   });

   it('says so for a plan whose project never had a PR', () => {
      const got = calls([item(1, { status_at: ago(40) })], {});
      expect(got[0]).toMatchObject({
         status: 'parked',
         note: `Put down: no PRs in ${IDLE_DAYS} days`,
      });
   });

   it('leaves planned plans alone', () => {
      expect(calls([item(1, { status: 'planned', status_at: ago(90) })], {})).toEqual([]);
   });
});

describe('finished', () => {
   /** Decide's rows for one project's plan, asked without `auto`. */
   const rowsFor = (plan: RoadmapItem, live: DecideProject[], over = {}) =>
      decideQueue({ live, items: [plan], today, now: NOW, ...over });
   const closedOn = (as: 'done' | 'dropped', daysAgo: number) =>
      new Map([['p1', { as, at: ago(daysAgo) }]]);

   it('finishes a plan whose issue closed with no PRs open, as the issue says', () => {
      const plan = item(1, {});
      for (const [as, word] of [
         ['done', 'completed'],
         ['dropped', 'not planned'],
      ] as const) {
         const rows = rowsFor(plan, [project('p1')], { closed: closedOn(as, 3) });
         expect(calls([plan], { p1: [] }, { rows })).toEqual([
            {
               kind: 'status',
               id: 1,
               from: 'active',
               status: as,
               note: `Finished: its issue was closed as ${word} on 2026-09-27`,
            },
         ]);
      }
   });

   it('leaves it, and Decide asks, while PRs are still open', () => {
      const plan = item(1, {});
      const rows = rowsFor(plan, [project('p1', { open: 2 })], { closed: closedOn('done', 3) });
      expect(calls([plan], { p1: [pull(7, { opened: ago(1) })] }, { rows })).toEqual([]);
      expect(answeredOnItsOwn(rows[0].reasons[0], plan)).toBe(false);
   });

   it('finishes a plan all of whose issues closed, dropped when none was done', () => {
      const plan = item(1, { start: '2026-09-07' });
      const counts = (done: number, dropped: number) =>
         new Map([['p1', { total: done + dropped, open: 0, done, dropped, lastClosedAt: ago(2) }]]);
      const done = rowsFor(plan, [project('p1')], { issues: counts(2, 1) });
      expect(calls([plan], { p1: [] }, { rows: done })[0]).toMatchObject({
         status: 'done',
         note: 'Finished: all 3 of its issues are closed, no PRs open',
      });
      const dropped = rowsFor(plan, [project('p1')], { issues: counts(0, 2) });
      expect(calls([plan], { p1: [] }, { rows: dropped })[0]).toMatchObject({ status: 'dropped' });
   });

   it('finishes a plan past its hard end with none open, until someone reopens it', () => {
      const plan = item(1, { end_kind: 'hard', start: '2026-08-03', weeks: 4, status_at: ago(60) });
      const rows = rowsFor(plan, [project('p1')]);
      expect(calls([plan], { p1: [] }, { rows })).toEqual([
         {
            kind: 'status',
            id: 1,
            from: 'active',
            status: 'done',
            note: 'Finished: its end, 2026-08-30, passed with no PRs open',
         },
      ]);
      // a person put it back in progress after its end: theirs stands
      const reopened = { ...plan, status_at: ago(2), updated_at: ago(2) };
      const again = rowsFor(reopened, [project('p1')]);
      expect(calls([reopened], { p1: [] }, { rows: again })).toEqual([]);
   });
});

describe('new project', () => {
   const rows: DecideRow[] = [
      { slug: 'ga4-events', item: null, reasons: [{ kind: 'new', since: '2026-09-21' }] },
   ];
   const prs = {
      'ga4-events': [
         pull(1, { opened: ago(20), author: 'erin' }),
         pull(2, { opened: ago(9), author: 'kim' }),
         pull(3, { opened: ago(8), author: 'kim' }),
      ],
   };

   it('plans it in progress with no end, from its first PR’s week, named from its slug', () => {
      expect(calls([], prs, { rows })).toEqual([
         {
            kind: 'new',
            fields: {
               name: 'GA4 events',
               project: 'ga4-events',
               status: 'active',
               start: '2026-09-07',
               end_kind: 'ongoing',
               lead: 'kim',
            },
            note:
               'Planned on its own: 3 or more PRs and no plan. ' +
               'Lead: kim, with the most PRs here in the last 60 days (2)',
         },
      ]);
   });

   it('takes the name its issue gives it', () => {
      const got = autoCalls({
         rows,
         items: [],
         pulls: new Map(Object.entries(prs)),
         planned: new Set(),
         names: new Map([['ga4-events', 'GA4 event tracking']]),
         now: NOW,
      });
      expect(got[0]).toMatchObject({ fields: { name: 'GA4 event tracking' } });
   });

   it('never makes again a plan someone removed', () => {
      expect(calls([], prs, { rows, planned: new Set(['ga4-events']) })).toEqual([]);
   });
});

describe('lead', () => {
   it('fills an empty lead with the author of the most recent PRs', () => {
      const got = calls([item(1, { lead: null, status_at: ago(3) })], {
         p1: [
            pull(1, { author: 'erin', opened: ago(200), open: false, merged: ago(190) }),
            pull(2, { author: 'erin', opened: ago(190), open: false, merged: ago(180) }),
            pull(3, { author: 'kim', opened: ago(10) }),
         ],
      });
      expect(got).toEqual([
         {
            kind: 'lead',
            id: 1,
            lead: 'kim',
            note: 'Lead: kim, with the most PRs here in the last 60 days (1)',
         },
      ]);
   });

   it('takes its issue’s assignee first', () => {
      const got = autoCalls({
         rows: [],
         items: [item(1, { lead: null, status_at: ago(3) })],
         pulls: new Map([['p1', [pull(3, { author: 'kim' })]]]),
         planned: new Set(['p1']),
         leads: new Map([['p1', 'dana']]),
         now: NOW,
      });
      expect(got).toEqual([
         { kind: 'lead', id: 1, lead: 'dana', note: "Lead: dana, its issue's assignee" },
      ]);
   });

   it('never replaces a lead someone set', () => {
      expect(calls([item(1, { status_at: ago(3) })], { p1: [pull(3)] })).toEqual([]);
   });

   it('breaks a tie by login', () => {
      expect(leadOf([pull(1, { author: 'zed' }), pull(2, { author: 'amy' })], ago(60))).toEqual({
         login: 'amy',
         prs: 1,
      });
   });
});

describe('labeledBy', () => {
   const runs = [{ actor: 'jarstelfox', from: '2026-10-10T07:55:00Z', to: '2026-10-10T08:05:00Z' }];
   const isBot = (login: string) => login.endsWith('[bot]') || login === 'fixture-bot';
   const at = (iso: string) => Date.parse(iso) / 1000;

   it('says the job added a label its run added with a person’s token', () => {
      expect(labeledBy('jarstelfox', at('2026-10-10T08:00:00Z'), { isBot, runs })).toBe('job');
      expect(labeledBy('JarStelfox', at('2026-10-10T08:05:00Z'), { isBot, runs })).toBe('job');
   });

   it('says the person added one outside the run, or another person inside it', () => {
      expect(labeledBy('jarstelfox', at('2026-10-10T08:05:01Z'), { isBot, runs })).toBe('person');
      expect(labeledBy('dana', at('2026-10-10T08:00:00Z'), { isBot, runs })).toBe('person');
   });

   it('says the job added one a bot added, or one whose adder is not known', () => {
      expect(labeledBy('github-actions[bot]', at('2026-10-01T00:00:00Z'), { isBot })).toBe('job');
      expect(labeledBy('fixture-bot', null, { isBot })).toBe('job');
      expect(labeledBy(null, null, { isBot })).toBe('job');
   });
});
