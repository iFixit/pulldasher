import { describe, expect, it } from 'vitest';
import {
   addWeeks,
   checkRoadmapFields,
   checkRoadmapUpdate,
   endShift,
   healthStanding,
   mondayOf,
   moveBefore,
   planEnd,
   type RoadmapUpdate,
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
         error: 'a project needs a name',
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
   });

   it('says what is wrong in words', () => {
      const error = (input: unknown) =>
         (checkRoadmapFields(input, { partial: true }) as { error: string }).error;
      expect(error({ weeks: 0 })).toMatch(/weeks/);
      expect(error({ weeks: 2.5 })).toMatch(/weeks/);
      expect(error({ status: 'someday' })).toMatch(/status/);
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
      const active = { status: 'active' as const, start: '2026-09-07' };
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
   });
});
