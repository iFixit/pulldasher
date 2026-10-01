import { describe, expect, it } from 'vitest';
import { dayStart } from '../../../../shared/model/projects';
import {
   healthStanding,
   type RoadmapItem,
   type RoadmapUpdate,
} from '../../../../shared/model/roadmap';
import { healthWords, loadWords, planCellWords, waitsWords } from './roadmapHealth';

const NOW = dayStart('2026-09-30') as number;
const item = (id: number, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
   id,
   name: `Item ${id}`,
   project: null,
   team: null,
   lead: null,
   status: 'active',
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
const update = (daysAgo: number, health: RoadmapUpdate['health']): RoadmapUpdate => ({
   id: 1,
   item_id: 1,
   health,
   body: '',
   plan_start: '2026-09-07',
   plan_weeks: 4,
   author: 'dana',
   at: NOW - daysAgo * 86400,
});

describe('amber means someone owes something', () => {
   it('on health: at risk, off track, or an update owed', () => {
      const words = (u: RoadmapUpdate | null) =>
         healthWords(healthStanding(item(1, { update: u }), NOW));
      expect(words(update(2, 'on_track'))).toMatchObject({ text: 'On track', warn: false });
      expect(words(update(2, 'at_risk'))).toMatchObject({ text: 'At risk', warn: true });
      expect(words(update(20, 'on_track'))?.text).toMatch(/On track · no update since/);
      expect(words(update(20, 'on_track'))?.warn).toBe(true);
      expect(words(null)).toMatchObject({ text: 'No update yet', warn: true });
   });

   it('in the table, a stale on track reads as the update it owes', () => {
      expect(planCellWords(item(1, { update: update(20, 'on_track') })).text).toBe('Update due');
      expect(planCellWords(item(1, { update: update(20, 'off_track') })).text).toBe('Off track');
   });

   it('on what an item waits on: only when the plan clashes', () => {
      const shopify = item(2, { name: 'Shopify sync', start: '2026-09-07', weeks: 4 }); // to Oct 4
      const all = [shopify, item(3, { name: 'Old thing', status: 'dropped' })];
      expect(waitsWords(item(1, { start: '2026-10-05', waits_on: [2] }), all)).toMatchObject({
         text: 'after Shopify sync',
         warn: false,
      });
      expect(waitsWords(item(1, { start: '2026-09-28', waits_on: [2] }), all)).toMatchObject({
         text: 'starts before Shopify sync ends',
         warn: true,
      });
      expect(waitsWords(item(1, { waits_on: [3] }), all)?.text).toBe(
         'waits on Old thing, which was dropped'
      );
      expect(waitsWords(item(1, { status: 'done', waits_on: [2] }), all)).toBeNull();
   });

   it('on a lane: once a week has as much in flight as developers', () => {
      const origins = { asked: 0, fire: 0, chosen: 0, unsaid: 1 };
      const weeks = [
         { week: '2026-09-28', onPlan: 1, origins, offPlan: 1, projected: false },
         { week: '2026-10-05', onPlan: 1, origins, offPlan: 0, projected: true },
      ];
      expect(loadWords(weeks, 3, '2026-09-30')).toMatchObject({ warn: false });
      expect(loadWords(weeks, 2, '2026-09-30')?.text).toMatch(/^2 in progress the week of/);
      expect(loadWords(weeks, 2, '2026-09-30')?.warn).toBe(true);
      expect(loadWords([], 2, '2026-09-30')).toBeNull();
   });
});
