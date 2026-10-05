import { describe, expect, it } from 'vitest';
import type { RoadmapItem } from '../../../shared/model/roadmap';
import { teamLoad } from './teamLoad';

const today = '2026-09-30';
const plan = (id: number, over: Partial<RoadmapItem>): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project: null,
   team: 'Store',
   lead: null,
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 8,
   // a commitment, the end these tests ask about
   end_kind: 'hard',
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
/** a project's PRs: how many are open, and how many days since any moved */
const work = (slug: string, open: number, quietDays = 0, openSince = '2026-09-01') => ({
   slug,
   name: slug,
   team: 'Store',
   open,
   openSince,
   lastActivity: { at: 0, days: quietDays, pr: { repo: 'iFixit/ifixit', number: 1, title: '' } },
});
const names = (plans: RoadmapItem[], items: ReturnType<typeof work>[]) =>
   teamLoad('Store', plans, items, today).map(w => w.name);

describe('teamLoad', () => {
   it('counts the Store lane as the dummy board has it: done and parked work still moving too', () => {
      // the roadmap counted 5 and Decide 3: Akeneo is done and Store picker
      // parked, but both still have PRs open that moved this week
      const plans = [
         plan(2, { name: 'Shopify sync', project: 'shopify-sync' }),
         // no project and not started: nothing to staff yet
         plan(4, { name: 'Checkout redesign', status: 'planned', start: '2026-10-19' }),
         plan(8, { name: 'Akeneo 4', project: 'akeneo-4', status: 'done' }),
         // planned for later, but its PRs are already open
         plan(11, { name: 'Newsletter promo', project: 'newsletter', status: 'planned' }),
         plan(12, { name: 'Store picker', project: 'store-picker', status: 'parked' }),
         plan(13, { name: 'Type refresh', project: 'type-refresh' }),
      ];
      const items = [
         work('shopify-sync', 4),
         work('akeneo-4', 1),
         work('newsletter', 2),
         work('store-picker', 2),
         work('type-refresh', 3),
      ];
      expect(names(plans, items)).toEqual([
         'Shopify sync',
         'Akeneo 4',
         'Newsletter promo',
         'Store picker',
         'Type refresh',
      ]);
   });

   it('leaves out done or parked work whose PRs stopped, and plans with none open', () => {
      const plans = [
         plan(1, { name: 'Parked, quiet', project: 'a', status: 'parked' }),
         plan(2, { name: 'Done, all merged', project: 'b', status: 'done' }),
         plan(3, { name: 'Under way, none open', project: 'c' }),
         plan(4, { name: 'Under way, stalled', project: 'd' }),
      ];
      // a stalled plan under way still holds its people; a parked one doesn't
      expect(names(plans, [work('a', 2, 9), work('b', 0), work('c', 0), work('d', 1, 30)])).toEqual(
         ['Under way, stalled']
      );
   });

   it('counts a project once, for the plan under way, wherever its finished phase sits', () => {
      const plans = [
         plan(1, { name: 'Phase one', project: 'a', status: 'done' }),
         plan(2, { name: 'Phase two', project: 'a' }),
         plan(3, { name: 'Phase three', project: 'a', status: 'planned' }),
      ];
      expect(names(plans, [work('a', 3)])).toEqual(['Phase two']);
   });

   it('counts a plan with no project in its weeks, once marked in progress', () => {
      const plans = [
         plan(1, { name: 'Running' }),
         plan(2, { name: 'Not marked', status: 'planned' }),
         plan(3, { name: 'Ended', start: '2026-08-03', weeks: 4 }),
         plan(4, { name: 'Upkeep', start: '2026-08-03', weeks: 4, end_kind: 'ongoing' }),
      ];
      expect(names(plans, [])).toEqual(['Running', 'Upkeep']);
   });

   it('puts work with no plan after the plans, a dropped plan being none', () => {
      const plans = [plan(1, { name: 'Dropped', project: 'a', status: 'dropped' })];
      const items = [
         work('a', 1, 0, '2026-09-20'),
         work('older', 1, 0, '2026-08-01'),
         { ...work('theirs', 1), team: 'Other' },
      ];
      expect(names(plans, items)).toEqual(['older', 'a']);
   });
});
