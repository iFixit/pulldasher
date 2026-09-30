import { describe, expect, it } from 'vitest';
import {
   addWeeks,
   checkRoadmapFields,
   mondayOf,
   moveBefore,
   planEnd,
} from '../../../shared/model/roadmap';

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
      expect(checkRoadmapFields({}, { partial: false })).toEqual({ error: 'a project needs a name' });
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
