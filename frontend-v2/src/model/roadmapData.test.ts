import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoadmapItem } from '../../../shared/model/roadmap';

const item = (id: number, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
   id,
   name: `Item ${id}`,
   project: null,
   team: null,
   lead: null,
   status: 'planned',
   start: '2026-09-28',
   weeks: 4,
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   update: null,
   ...over,
});

/** A fetch whose replies the test hands out one call at a time. */
function scriptedFetch() {
   const pending: ((json: unknown, status?: number) => void)[] = [];
   const fetch = vi.fn(
      () =>
         new Promise<Response>(resolve => {
            pending.push((json, status = 200) =>
               resolve({ status, redirected: false, json: async () => json } as Response)
            );
         })
   );
   vi.stubGlobal('fetch', fetch);
   return {
      /** answer the oldest call still waiting, or the `which`th of them */
      answer: (json: unknown, status?: number, which = 0) =>
         pending.splice(which, 1)[0]?.(json, status),
   };
}

// a fresh module per test, so each starts with an empty roadmap
const load = async () => {
   vi.resetModules();
   return import('./roadmapData');
};
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
   vi.unstubAllGlobals();
});

describe('the roadmap store', () => {
   it('ignores a load that went out before a save and answers after it', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadRoadmap();
      answer({ items: [item(1)] });
      await first;
      const stale = data.loadRoadmap();
      const save = data.updateRoadmapItem(1, { weeks: 6 });
      answer({ items: [item(1)] }); // the load, still saying 4 weeks
      answer({ item: item(1, { weeks: 6 }) }); // the save
      await Promise.all([stale, save]);
      expect(data.readRoadmap().items?.[0].weeks).toBe(6);
   });

   it('shows a new item once, even when a load brought it first', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const create = data.createRoadmapItem({ name: 'Item 2' });
      await settled();
      const reload = data.loadRoadmap();
      answer({ items: [item(1), item(2)] }, 200, 1); // the load, which already has it
      await reload;
      answer({ item: item(2) }, 201); // then the create
      await create;
      expect(data.readRoadmap().items?.map(i => i.id)).toEqual([1, 2]);
   });

   it('takes a removed item off what others wait on, and puts it all back on a refusal', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadRoadmap();
      answer({ items: [item(1), item(2, { waits_on: [1] })] });
      await first;
      const remove = data.removeRoadmapItem(1);
      expect(data.readRoadmap().items).toEqual([item(2)]);
      answer({ error: 'nope' }, 500);
      expect(await remove).toBe(false);
      expect(data.readRoadmap().items?.[1].waits_on).toEqual([1]);
      expect(data.readRoadmap().problem).toMatch(/nope/);
   });
});
