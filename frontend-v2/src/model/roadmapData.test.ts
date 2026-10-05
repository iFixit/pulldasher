import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoadmapItem } from '../../../shared/model/roadmap';

const item = (id: number, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
   id,
   name: `Item ${id}`,
   project: null,
   team: null,
   lead: null,
   status: 'planned',
   origin: null,
   start: '2026-09-28',
   weeks: 4,
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

   it('fetches the whole roadmap after an add before the first load, rather than a list of one', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const create = data.createRoadmapItem({ name: 'Item 2' });
      answer({ item: item(2) }, 201);
      await create;
      // every other plan would read as missing, so nothing shows yet
      expect(data.readRoadmap().items).toBeNull();
      answer({ items: [item(1), item(2)] }); // the load it asked for
      await settled();
      expect(data.readRoadmap().items?.map(i => i.id)).toEqual([1, 2]);
   });

   it('sends an Undo’s times and shows them at once, so the plan reads as never decided', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadRoadmap();
      answer({ items: [item(1, { status: 'done', updated_at: 5000, status_at: 5000 })] });
      await first;
      const undo = { updated_at: 2000, status_at: 1000 };
      const save = data.updateRoadmapItem(1, { status: 'active' }, { undo });
      // on screen before the server answers, with the old times, not now
      expect(data.readRoadmap().items?.[0]).toMatchObject({ status: 'active', ...undo });
      const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
      expect(sent).toEqual({ status: 'active', undo });
      answer({ item: item(1, { status: 'active', ...undo }) });
      expect(await save).toBe(true);
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

   it('puts a removed item back in its place, and what waited on it with the next load', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadRoadmap();
      answer({ items: [item(1), item(2, { waits_on: [1] }), item(3)] });
      await first;
      const remove = data.removeRoadmapItem(1);
      answer({ ok: true });
      await remove;
      const restore = data.restoreRoadmapItem(1);
      const [path, init] = vi.mocked(fetch).mock.calls[2];
      expect([path, init?.method, JSON.parse(String(init?.body))]).toEqual([
         '/roadmap/1',
         'PATCH',
         { restore: true },
      ]);
      answer({ item: item(1) });
      expect(await restore).toBe(true);
      expect(data.readRoadmap().items?.map(i => i.id)).toEqual([1, 2, 3]);
      // the load it asks for brings back what waited on it
      answer({ items: [item(1), item(2, { waits_on: [1] }), item(3)] });
      await settled();
      expect(data.readRoadmap().items?.[1].waits_on).toEqual([1]);
   });

   it('takes back an update just posted, and the one before is the latest again', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const update = (id: number) => ({
         id,
         item_id: 1,
         health: 'on_track' as const,
         body: '',
         plan_start: '2026-09-28',
         plan_weeks: 4,
         author: 'alice',
         at: id,
      });
      const first = data.loadRoadmap();
      answer({ items: [item(1, { update: update(7) })] });
      await first;
      const back = data.takeBackRoadmapUpdate(1, 7);
      const [path, init] = vi.mocked(fetch).mock.calls[1];
      expect([path, init?.method]).toEqual(['/roadmap/1/updates/7', 'DELETE']);
      answer({ update: update(6) });
      expect(await back).toEqual({ update: update(6) });
      expect(data.readRoadmap().items?.[0].update?.id).toBe(6);
      // a refusal comes back in words, and changes nothing
      const theirs = data.takeBackRoadmapUpdate(1, 6);
      answer({ error: 'only the person who posted an update can take it back' }, 403);
      expect(await theirs).toEqual({
         error: 'Couldn’t take the update back: only the person who posted an update can take it back.',
      });
      expect(data.readRoadmap().items?.[0].update?.id).toBe(6);
   });
});

describe('what fills itself in', () => {
   const lately = (activityAt: number | null) => ({
      merged: 1,
      open: { ready: 0, hold: 0, review: 1, work: 0 },
      activityAt,
      issues: null,
      grew: 0,
      medianAge: 4,
   });
   const monday = Date.parse('2026-09-28T00:00:00Z') / 1000;

   it('shows a plan still marked planned as in progress once its PRs moved after its start', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadRoadmap();
      answer({
         items: [
            item(1, { project: 'a', lately: lately(monday + 3600) }),
            item(2, { project: 'b', lately: lately(monday - 3600) }),
            item(3, { project: 'c', status: 'parked', lately: lately(monday + 3600) }),
         ],
      });
      await first;
      expect(data.readRoadmap().items?.map(i => i.status)).toEqual(['active', 'planned', 'parked']);
   });

   it('places a new plan by its issue’s Priority, above the first lower one under way', async () => {
      const { placedByPriority } = await load();
      const fields = (priority: string | null) => ({ start: null, target: null, priority });
      const projects = [
         { slug: 'high', fields: fields('high') },
         { slug: 'low', fields: fields('low') },
         { slug: 'none', fields: fields(null) },
      ];
      const order = [
         item(1),
         item(2, { project: 'none' }),
         item(3, { project: 'low', status: 'done' }),
         item(4, { project: 'low' }),
         item(5, { project: 'high' }),
      ];
      // past the plans that say nothing and the one that's finished
      expect(placedByPriority(order, 5, projects)).toEqual([1, 2, 3, 5, 4]);
      // none lower, or none said: where it is
      expect(placedByPriority(order, 4, projects)).toEqual([1, 2, 3, 4, 5]);
      expect(placedByPriority(order, 2, projects)).toEqual([1, 2, 3, 4, 5]);
   });

   it('reads what each project did lately the way the server does', async () => {
      const { latelyFrom } = await load();
      const now = monday + 2 * 86400;
      const iso = (daysAgo: number) => new Date((now - daysAgo * 86400) * 1000).toISOString();
      const pull = (status: string) => ({
         status,
         cryo: false,
         externalBlock: false,
         conflict: false,
         changesRequestedBy: [],
         data: { created_at: iso(4), status: {} },
      });
      const merged = (daysAgo: number) => ({
         created_at: iso(30),
         closed_at: iso(daysAgo),
         merged_at: iso(daysAgo),
      });
      const group = (slug: string, open: unknown[], mergedPrs: unknown[]) => ({
         slug,
         open,
         merged: mergedPrs,
         closed: [],
         lastActivity: now - 3600,
      });
      const today = {
         live: [group('a', [pull('needs_cr'), pull('dev_block')], [merged(2), merged(16)])],
         quiet: [group('b', [], [])],
      } as unknown as Parameters<typeof latelyFrom>[0];
      const open = { state: 'open', closedAt: null, attachedAt: now - 86400 };
      const attached = new Map([
         ['a', [open]],
         ['b', [open]],
      ]);
      const facts = latelyFrom(today, attached, new Set(['b']), now);
      expect(facts.get('a')).toEqual({
         merged: 1,
         open: { ready: 0, hold: 0, review: 1, work: 1 },
         activityAt: now - 3600,
         issues: { open: 1, closed: 0, added: 1 },
         // two opened four days ago, one of those open before merged since
         grew: 1,
         medianAge: 4,
      });
      // work with no end has no finish to forecast
      expect(facts.get('b')?.issues).toBeNull();
   });
});
