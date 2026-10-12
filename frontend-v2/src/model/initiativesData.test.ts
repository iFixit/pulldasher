import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Initiative } from '../../../shared/model/initiatives';

const initiative = (
   id: number,
   slug: string,
   projects: string[],
   over: Partial<Initiative> = {}
) => ({
   id,
   slug,
   name: slug,
   kind: 'initiative' as const,
   goal: '',
   owner: null,
   priority: id,
   status: 'open' as const,
   status_at: null,
   created_by: null,
   created_at: null,
   updated_by: null,
   updated_at: 100,
   projects: projects.map(project => ({ project, set_by: null, set_at: 50, baseline_prs: 0 })),
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
   return { answer: (json: unknown, status?: number) => pending.shift()?.(json, status) };
}

const sent = (call: number) => {
   const [path, init] = vi.mocked(fetch).mock.calls[call] as unknown as [string, RequestInit];
   return { path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null };
};

// a fresh module per test, so each starts with nothing loaded
const load = async () => {
   vi.resetModules();
   return import('./initiativesData');
};

afterEach(() => {
   vi.unstubAllGlobals();
});

describe('the initiatives store', () => {
   it('reads a server with no /initiatives as none, so nothing changes', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadInitiatives();
      answer({}, 404);
      await first;
      expect(data.readInitiatives().initiatives).toEqual([]);
   });

   it('files a project at once, checking the home the person saw, and hands back the old one', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadInitiatives();
      answer({ initiatives: [initiative(1, 'a', ['p']), initiative(2, 'b', [])] });
      await first;
      const filing = data.fileProject('p', 'b', { expect: 'a' });
      // on screen before the server answers
      expect(data.readInitiatives().initiatives?.map(i => i.projects.map(f => f.project))).toEqual([
         [],
         ['p'],
      ]);
      expect(sent(1)).toEqual({
         path: '/initiatives/file',
         method: 'PUT',
         body: { project: 'p', initiative: 'b', expect: 'a' },
      });
      const before = { initiative: 'a', set_at: 50, baseline_prs: 0 };
      answer({ project: 'p', before, home: { initiative: 'b' } });
      expect(await filing).toEqual({ before });
   });

   it('puts the home back with its time and count on an Undo', async () => {
      scriptedFetch();
      const data = await load();
      void data.fileProject('p', 'not-tracked', { set_at: 40, baseline_prs: 12 });
      expect(sent(0).body).toEqual({
         project: 'p',
         initiative: 'not-tracked',
         set_at: 40,
         baseline_prs: 12,
      });
   });

   it('takes a refused filing back off the screen and says why', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadInitiatives();
      answer({ initiatives: [initiative(1, 'a', ['p']), initiative(2, 'b', [])] });
      await first;
      const filing = data.fileProject('p', 'b', { expect: 'a' });
      answer({ error: 'its home changed; here it is now' }, 409);
      expect(await filing).toEqual({
         error: 'Couldn’t move the project: its home changed; here it is now.',
      });
      expect(data.readInitiatives().initiatives?.[0].projects.map(f => f.project)).toEqual(['p']);
   });

   it('moves an initiative above another at once, and sends one move', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadInitiatives();
      answer({
         initiatives: [initiative(1, 'a', []), initiative(2, 'b', []), initiative(3, 'c', [])],
      });
      await first;
      const move = data.moveInitiative(3, 1);
      expect(data.byRank(data.readInitiatives().initiatives ?? []).map(i => i.slug)).toEqual([
         'c',
         'a',
         'b',
      ]);
      expect(sent(1)).toEqual({ path: '/initiatives/3/move', method: 'POST', body: { before: 1 } });
      answer({ error: 'nope' }, 500);
      expect(await move).toEqual({ error: 'Couldn’t save the new order: nope.' });
      expect(data.byRank(data.readInitiatives().initiatives ?? []).map(i => i.slug)).toEqual([
         'a',
         'b',
         'c',
      ]);
   });

   it('closes an initiative, keeps one open with its status said again, and names what’s live', async () => {
      const { answer } = scriptedFetch();
      const data = await load();
      const first = data.loadInitiatives();
      answer({ initiatives: [initiative(1, 'a', ['p'])] });
      await first;
      const close = data.updateInitiative(1, { status: 'done' });
      answer({ error: 'move or finish the projects still going in it first', live: ['p'] }, 409);
      expect(await close).toMatchObject({ live: ['p'] });
      const keep = data.updateInitiative(1, { status: 'open' }, { restate: true });
      expect(sent(2).body).toEqual({ status: 'open', restate: true });
      answer({ initiative: initiative(1, 'a', ['p'], { status_at: 999 }) });
      expect(await keep).toMatchObject({ was: { status_at: null } });
   });
});

describe('untrackedNow', () => {
   it('takes a filing’s word over the server’s, and the server’s with none', async () => {
      const { untrackedNow } = await load();
      const list = [
         initiative(1, 'a', ['tracked']),
         initiative(2, 'nt', ['shelved'], { kind: 'untracked' }),
      ] as Initiative[];
      expect(untrackedNow('tracked', true, list)).toBe(false);
      expect(untrackedNow('shelved', false, list)).toBe(true);
      expect(untrackedNow('repo-default', true, list)).toBe(true);
      expect(untrackedNow('shelved', false, null)).toBe(false);
   });
});
