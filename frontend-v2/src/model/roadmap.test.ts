import { describe, expect, it } from 'vitest';
import { ORIGIN_KEYS } from '../lens';
import {
   addWeeks,
   blockersOf,
   bucketOf,
   checkRoadmapFields,
   checkRoadmapUpdate,
   endShift,
   healthStanding,
   inProgress,
   issuePace,
   mondayOf,
   moveBefore,
   paceFinish,
   periodPlan,
   planEnd,
   planFor,
   ROADMAP_ORIGINS,
   updatesOwed,
   updateStanding,
   type PlanLately,
   type RoadmapItem,
   type RoadmapUpdate,
   waitsOnProblem,
   weeksThrough,
} from '../../../shared/model/roadmap';
import { dayStart } from '../../../shared/model/projects';

describe('roadmap dates', () => {
   it('moves any day to its week’s Monday and counts whole weeks from it', () => {
      expect(mondayOf('2026-10-01')).toBe('2026-09-28'); // a Thursday
      expect(mondayOf('2026-09-28')).toBe('2026-09-28');
      expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // a Sunday
      expect(addWeeks('2026-09-28', 2)).toBe('2026-10-12');
      expect(planEnd({ start: '2026-09-28', weeks: 2 })).toBe('2026-10-11');
   });
});

describe('checkRoadmapFields', () => {
   it('needs a name on a new item, trims it, and snaps the start to Monday', () => {
      expect(checkRoadmapFields({}, { partial: false })).toEqual({
         error: 'a plan needs a name',
      });
      expect(
         checkRoadmapFields({ name: '  Checkout  ', start: '2026-10-01' }, { partial: false })
      ).toEqual({ fields: { name: 'Checkout', start: '2026-09-28' } });
   });

   it('lets an edit send any subset, and clears optional fields with null or empty', () => {
      expect(checkRoadmapFields({ weeks: 6 }, { partial: true })).toEqual({ fields: { weeks: 6 } });
      expect(checkRoadmapFields({ lead: '', project: null }, { partial: true })).toEqual({
         fields: { lead: null, project: null },
      });
      expect(checkRoadmapFields({ origin: 'fire' }, { partial: true })).toEqual({
         fields: { origin: 'fire' },
      });
      expect(checkRoadmapFields({ origin: '' }, { partial: true })).toEqual({
         fields: { origin: null },
      });
   });

   it('says what is wrong in words', () => {
      const error = (input: unknown) =>
         (checkRoadmapFields(input, { partial: true }) as { error: string }).error;
      expect(error({ weeks: 0 })).toMatch(/weeks/);
      expect(error({ weeks: 2.5 })).toMatch(/weeks/);
      expect(error({ status: 'someday' })).toMatch(/status/);
      expect(error({ origin: 'boss' })).toMatch(/origin is one of asked, fire, chosen/);
      expect(error({ project: 'Not A Slug' })).toMatch(/slug/);
      expect(error({ lead: 'two words' })).toMatch(/login/);
      expect(error({ start: 'next week' })).toMatch(/YYYY-MM-DD/);
      expect(error([])).toMatch(/object/);
   });
});

describe('moveBefore', () => {
   it('drops an id in front of another, or at the end', () => {
      expect(moveBefore([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
      expect(moveBefore([1, 2, 3, 4], 1, 4)).toEqual([2, 3, 1, 4]);
      expect(moveBefore([1, 2, 3], 1, null)).toEqual([2, 3, 1]);
      expect(moveBefore([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
   });
});

describe('updates', () => {
   const DAY = 86400;
   const now = dayStart('2026-09-30') as number;
   const update = (
      daysAgo: number,
      health: RoadmapUpdate['health'] = 'on_track'
   ): RoadmapUpdate => ({
      id: 1,
      item_id: 1,
      health,
      body: '',
      plan_start: '2026-09-07',
      plan_weeks: 4,
      author: 'dana',
      at: now - daysAgo * DAY,
   });

   it('checks the health and trims the words, which may be empty', () => {
      expect(checkRoadmapUpdate({ health: 'at_risk', body: ' Slipping. ' })).toEqual({
         fields: { health: 'at_risk', body: 'Slipping.' },
      });
      expect(checkRoadmapUpdate({ health: 'on_track' })).toEqual({
         fields: { health: 'on_track', body: '' },
      });
      expect((checkRoadmapUpdate({ health: 'fine' }) as { error: string }).error).toMatch(/health/);
   });

   it('counts how far a plan’s end moved, later positive', () => {
      const was = { start: '2026-09-07', weeks: 4 };
      expect(endShift(was, { start: '2026-09-07', weeks: 6 })).toBe(2);
      expect(endShift(was, { start: '2026-08-31', weeks: 4 })).toBe(-1);
      expect(endShift(was, was)).toBe(0);
   });

   it('owes an update only on work in progress, after two weeks', () => {
      const active = { status: 'active' as const, start: '2026-09-07', weeks: 4, created_at: null };
      expect(healthStanding({ ...active, update: null }, now).kind).toBe('missing');
      expect(healthStanding({ ...active, start: '2026-09-21', update: null }, now).kind).toBe(
         'quiet'
      );
      expect(healthStanding({ ...active, update: update(3) }, now).kind).toBe('current');
      expect(healthStanding({ ...active, update: update(15) }, now)).toMatchObject({
         kind: 'stale',
         days: 15,
      });
      // a plan that hasn't started, or finished work, owes nothing
      expect(healthStanding({ ...active, status: 'planned', update: update(40) }, now).kind).toBe(
         'current'
      );
      expect(healthStanding({ ...active, status: 'done', update: null }, now).kind).toBe('quiet');
      // work begun weeks ago but put on the roadmap three days ago owes nothing yet
      expect(
         healthStanding({ ...active, created_at: now - 3 * 86400, update: null }, now).kind
      ).toBe('quiet');
   });

   // Sep 7, 8 weeks: it ends Nov 1
   const going = { status: 'active' as const, start: '2026-09-07', weeks: 8, created_at: null };
   const lately = (over: Partial<PlanLately> = {}): PlanLately => ({
      merged: 2,
      open: { ready: 0, hold: 0, review: 1, work: 1 },
      activityAt: now - DAY,
      issues: null,
      ...over,
   });

   it('owes nothing while its PRs merge, inside its end and its issues’ pace', () => {
      expect(healthStanding({ ...going, update: null, lately: lately() }, now)).toEqual({
         kind: 'quiet',
         vouch: { merged: 2, finish: null },
      });
      // the last update stays the word on it, with why none is owed now
      expect(healthStanding({ ...going, update: update(20), lately: lately() }, now)).toEqual({
         kind: 'current',
         update: update(20),
         vouch: { merged: 2, finish: null },
      });
      // 2 open, 3 closed and 1 added in four weeks: done in four weeks, Oct 28
      const onPace = lately({ issues: { open: 2, closed: 3, added: 1 } });
      expect(healthStanding({ ...going, update: null, lately: onPace }, now)).toMatchObject({
         vouch: { finish: now + 28 * DAY },
      });
   });

   it('owes one when its PRs didn’t merge, it’s past its end, or its issues finish late', () => {
      const owes = (over: Partial<PlanLately>, item: Partial<typeof going> = {}) =>
         healthStanding({ ...going, ...item, update: null, lately: lately(over) }, now).kind;
      expect(owes({ merged: 0 })).toBe('missing');
      expect(owes({}, { weeks: 2 })).toBe('missing');
      // 4 open at one a week: Oct 28 is too late for an Oct 18 end
      expect(owes({ issues: { open: 4, closed: 4, added: 0 } }, { weeks: 6 })).toBe('missing');
      // arriving as fast as they close never finishes
      expect(owes({ issues: { open: 2, closed: 3, added: 3 } })).toBe('missing');
      // no pace to run on (none closed) leaves the merges to vouch
      expect(owes({ issues: { open: 2, closed: 0, added: 2 } })).toBe('quiet');
      expect(healthStanding({ ...going, update: update(20), lately: null }, now).kind).toBe(
         'stale'
      );
   });

   it('never vouches over a lead’s at risk or off track: their word stands until a new one', () => {
      for (const health of ['at_risk', 'off_track'] as const) {
         expect(
            healthStanding({ ...going, update: update(20, health), lately: lately() }, now)
         ).toEqual({ kind: 'stale', update: update(20, health), days: 20 });
      }
   });

   it('judges a plan past its end, and its issues’ finish, by the team’s day, not UTC’s', () => {
      const plan = { ...going, update: null, lately: lately() };
      // 9pm on Sunday Nov 1 in California, its last day, is Monday in UTC
      const evening = Date.UTC(2026, 10, 2, 5) / 1000;
      expect(healthStanding(plan, evening, '2026-11-01').kind).toBe('quiet');
      expect(healthStanding(plan, evening, '2026-11-02').kind).toBe('missing');
      // 9pm on Oct 4 there: its issues done in four weeks, on its last day
      const paced = { ...plan, lately: lately({ issues: { open: 2, closed: 3, added: 1 } }) };
      const oct4 = Date.UTC(2026, 9, 5, 4) / 1000;
      expect(healthStanding(paced, oct4, '2026-10-04').kind).toBe('quiet');
   });

   it('says where a plan’s updates stand in one word, as the API does', () => {
      const vouch = { merged: 2, finish: null };
      expect(updateStanding({ kind: 'missing' })).toBe('owed');
      expect(updateStanding({ kind: 'stale', update: update(20), days: 20 })).toBe('owed');
      expect(updateStanding({ kind: 'quiet', vouch })).toBe('vouched');
      expect(updateStanding({ kind: 'current', update: update(20), vouch })).toBe('vouched');
      expect(updateStanding({ kind: 'current', update: update(3) })).toBe('current');
      expect(updateStanding({ kind: 'quiet' })).toBeNull();
   });

   it('reads a plan still marked planned as in progress once its PRs moved after its start', () => {
      const planned = { status: 'planned' as const, start: '2026-09-07', lately: lately() };
      expect(inProgress(planned)).toBe(true);
      expect(inProgress({ ...planned, lately: lately({ activityAt: now - 30 * DAY }) })).toBe(
         false
      );
      expect(inProgress({ ...planned, lately: lately({ activityAt: null }) })).toBe(false);
      expect(inProgress({ ...planned, lately: null })).toBe(false);
      expect(inProgress({ ...planned, status: 'parked' })).toBe(false);
      // so it owes updates as one marked in progress does
      expect(
         healthStanding({ ...going, ...planned, update: null, lately: lately({ merged: 0 }) }, now)
            .kind
      ).toBe('missing');
   });

   it('runs a project’s issues at the last four weeks’ pace', () => {
      const issues = [
         { state: 'open', closedAt: null, attachedAt: now - 3 * DAY },
         { state: 'open', closedAt: null, attachedAt: null },
         { state: 'done', closedAt: now - 2 * DAY, attachedAt: now - 60 * DAY },
         { state: 'dropped', closedAt: now - 40 * DAY, attachedAt: now - 60 * DAY },
      ];
      expect(issuePace(issues, now)).toEqual({ open: 2, closed: 1, added: 1 });
      // 3 open, one fewer a week: three weeks
      expect(paceFinish({ open: 3, closed: 5, added: 1 }, now)).toBe(now + 21 * DAY);
      expect(paceFinish({ open: 3, closed: 1, added: 1 }, now)).toBe(Infinity);
      expect(paceFinish({ open: 3, closed: 0, added: 0 }, now)).toBeNull();
      expect(paceFinish({ open: 0, closed: 4, added: 0 }, now)).toBeNull();
   });
});

describe('updatesOwed', () => {
   const NOW = dayStart('2026-09-30') as number;
   const DAY = 86400;
   const item = (id: number, over: Partial<RoadmapItem>): RoadmapItem => ({
      id,
      name: `Item ${id}`,
      project: null,
      team: null,
      lead: null,
      status: 'active',
      origin: null,
      start: '2026-06-01',
      weeks: 30,
      priority: id,
      notes: '',
      waits_on: [],
      updated_by: null,
      updated_at: null,
      created_at: null,
      update: null,
      ...over,
   });
   const update = (daysAgo: number) => ({
      id: 1,
      item_id: 1,
      health: 'on_track' as const,
      body: '',
      plan_start: '2026-06-01',
      plan_weeks: 30,
      author: 'x',
      at: NOW - daysAgo * DAY,
   });

   it('lists each lead’s overdue plans, the most owed first, no lead last', () => {
      const owed = updatesOwed(
         [
            item(1, { lead: 'dana', update: update(20) }),
            item(2, { lead: 'erin', update: update(30) }),
            item(3, { lead: 'erin' }),
            item(4, { lead: 'dana', update: update(3) }),
            item(5, {}),
            item(6, { lead: 'finn', status: 'planned' }),
         ],
         NOW
      );
      expect(owed.map(o => [o.lead, o.owed.map(x => [x.item.id, x.kind, x.days])])).toEqual([
         [
            'erin',
            [
               [3, 'missing', 121],
               [2, 'stale', 30],
            ],
         ],
         ['dana', [[1, 'stale', 20]]],
         [null, [[5, 'missing', 121]]],
      ]);
   });

   it('leaves out a plan its numbers vouch for, the way every view does', () => {
      const lately = { merged: 3, open: { ready: 0, hold: 0, review: 0, work: 1 } };
      const owed = updatesOwed(
         [
            item(1, {
               lead: 'dana',
               update: update(20),
               lately: { ...lately, activityAt: NOW, issues: null },
            }),
            item(2, { lead: 'dana', update: update(20) }),
         ],
         NOW
      );
      expect(owed.flatMap(o => o.owed.map(x => x.item.id))).toEqual([2]);
   });
});

describe('bucketOf', () => {
   it('puts work in progress and started plans now, the next quarter next, the rest later', () => {
      const today = '2026-09-30';
      expect(bucketOf({ status: 'active', start: '2026-12-07' }, today)).toBe('now');
      expect(bucketOf({ status: 'planned', start: '2026-09-28' }, today)).toBe('now');
      expect(bucketOf({ status: 'planned', start: '2026-12-28' }, today)).toBe('next');
      expect(bucketOf({ status: 'planned', start: '2027-01-04' }, today)).toBe('later');
      expect(bucketOf({ status: 'done', start: '2026-09-28' }, today)).toBeNull();
   });
});

describe('waits on', () => {
   const item = (id: number, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
      id,
      name: `Item ${id}`,
      project: null,
      team: null,
      lead: null,
      status: 'planned',
      origin: null,
      start: '2026-09-07',
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

   it('picks the plan that speaks for a project: the first under way, or the latest call', () => {
      const all = [
         item(1, { project: 'a', status: 'done', updated_at: 100 }),
         item(2, { project: 'a', status: 'active' }),
         item(3, { project: 'b', status: 'done', updated_at: 100 }),
         item(4, { project: 'b', status: 'dropped', updated_at: 200 }),
      ];
      expect(planFor('a', all)?.id).toBe(2);
      expect(planFor('b', all)?.id).toBe(4);
      expect(planFor('c', all)).toBeNull();
   });

   it('refuses itself, unknown ids, and loops, however long', () => {
      const all = [item(1), item(2, { waits_on: [1] }), item(3, { waits_on: [2] })];
      expect(waitsOnProblem(3, [1], all)).toBeNull();
      expect(waitsOnProblem(null, [3], all)).toBeNull();
      expect(waitsOnProblem(1, [1], all)).toMatch(/itself/);
      expect(waitsOnProblem(1, [9], all)).toMatch(/no plan 9/);
      expect(waitsOnProblem(1, [3], all)).toMatch(/loop/);
   });

   it('clashes when it starts before what it waits on ends, or that was dropped', () => {
      const all = [
         item(1, { start: '2026-09-07', weeks: 4 }), // ends Oct 4
         item(2, { status: 'done' }),
         item(3, { status: 'dropped' }),
      ];
      const clash = (start: string, waits_on: number[]) =>
         blockersOf({ start, waits_on }, all).map(b => [b.item.id, b.clash]);
      expect(clash('2026-09-28', [1])).toEqual([[1, true]]);
      expect(clash('2026-10-05', [1])).toEqual([[1, false]]);
      expect(clash('2026-09-07', [2, 3, 9])).toEqual([
         [2, false],
         [3, true],
      ]);
   });
});

describe('weeksThrough', () => {
   it('counts through the week holding the end, one week at least and two years at most', () => {
      // Oct 31 is a Saturday, in the week of Oct 26: five weeks from Sep 28
      expect(weeksThrough('2026-09-28', '2026-10-31')).toBe(5);
      expect(planEnd({ start: '2026-09-28', weeks: 5 })).toBe('2026-11-01');
      expect(weeksThrough('2026-09-28', '2026-09-28')).toBe(1);
      expect(weeksThrough('2026-09-28', '2026-08-01')).toBe(1);
      expect(weeksThrough('2026-09-28', '2031-01-01')).toBe(104);
   });
});

describe('periodPlan', () => {
   it('fills this or next month or quarter in whole weeks', () => {
      const today = '2026-09-30'; // a Wednesday in the last week of Q3
      expect(periodPlan('month', 'this', today)).toEqual({ start: '2026-09-28', weeks: 1 });
      expect(periodPlan('month', 'next', today)).toEqual({ start: '2026-09-28', weeks: 5 });
      expect(periodPlan('quarter', 'next', today)).toEqual({ start: '2026-09-28', weeks: 14 });
      expect(periodPlan('quarter', 'this', '2026-08-12')).toEqual({
         start: '2026-08-10',
         weeks: 8,
      });
      // December's next month is January of the next year
      expect(periodPlan('month', 'next', '2026-12-10').start).toBe('2026-12-28');
   });
});

describe('origins', () => {
   it('are the same in the URL as in the model, plus not said', () => {
      expect([...ORIGIN_KEYS]).toEqual([...ROADMAP_ORIGINS, 'unsaid']);
   });
});
