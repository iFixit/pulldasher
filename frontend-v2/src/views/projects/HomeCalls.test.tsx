// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DecideRow } from '../../../../shared/model/decide';
import type { Initiative } from '../../../../shared/model/initiatives';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { loadInitiatives } from '../../model/initiativesData';
import type { PortfolioItem } from '../../model/portfolio';
import {
   AllItemsContext,
   answerWords,
   callWords,
   DecideCall,
   keepCalls,
   type Made,
} from './Decide';

// React's act() warns unless the environment says it's a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initiative = (
   id: number,
   slug: string,
   name: string,
   projects: string[],
   over: Partial<Initiative> = {}
): Initiative => ({
   id,
   slug,
   name,
   kind: 'initiative',
   goal: '',
   owner: 'dana',
   priority: id,
   status: 'open',
   status_at: null,
   created_by: null,
   created_at: null,
   updated_by: null,
   updated_at: 100,
   projects: projects.map(project => ({ project, set_by: null, set_at: 50, baseline_prs: 0 })),
   ...over,
});

const INITIATIVES = [
   initiative(1, 'site-speed', 'Site speed', ['cache', 'filed']),
   initiative(2, 'fixbot', 'FixBot chat', ['answers']),
   initiative(3, 'catalog', 'Catalog', ['akeneo'], { status: 'done' }),
   initiative(4, 'onboarding', 'Onboarding', ['emails']),
   initiative(9, 'not-tracked', 'Not tracked', ['ops'], { kind: 'untracked' }),
];

const created: RoadmapItem = {
   id: 77,
   name: 'New thing',
   project: 'new-thing',
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   start: '2026-10-05',
   weeks: 4,
   end_kind: 'hard',
   done_when: '',
   priority: 9,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: 1,
   created_at: 1,
   update: null,
};

/** The server, by route: each write answers as the real one would. */
const calls: { method: string; path: string; body: unknown }[] = [];
beforeAll(async () => {
   vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
         const method = init?.method ?? 'GET';
         const body = init?.body ? JSON.parse(String(init.body)) : null;
         calls.push({ method, path, body });
         const reply = (json: unknown, status = 200) =>
            ({ status, redirected: false, json: async () => json } as Response);
         if (path === '/initiatives' && method === 'GET')
            return reply({ initiatives: INITIATIVES });
         if (path === '/initiatives/file') {
            const before =
               body.project === 'ops'
                  ? { initiative: 'not-tracked', set_at: 50, baseline_prs: 2 }
                  : body.project === 'filed'
                  ? { initiative: 'site-speed', set_at: 50, baseline_prs: 0 }
                  : { initiative: null, set_at: null, baseline_prs: 0 };
            return reply({ project: body.project, before, home: null });
         }
         if (path.startsWith('/initiatives/')) {
            return reply({ initiative: { ...INITIATIVES[3], ...body } });
         }
         if (path === '/roadmap' && method === 'POST') return reply({ item: created }, 201);
         if (path === '/roadmap' && method === 'GET') return reply({ items: [] });
         if (path.startsWith('/roadmap/') && method === 'DELETE') return reply({ ok: true });
         return reply({}, 404);
      })
   );
   await loadInitiatives();
});

let host: HTMLDivElement | null = null;
afterEach(() => {
   host?.remove();
   host = null;
   calls.length = 0;
});

const person = (slug: string, developers: string[]) =>
   ({ slug, name: slug, developers, nonDevelopers: [] } as unknown as PortfolioItem);
const ITEMS = [
   person('new-thing', ['erin']),
   person('cache', ['dana']),
   person('answers', ['erin']),
   person('filed', ['dana']),
];

function render(row: DecideRow): HTMLDivElement {
   host = document.createElement('div');
   document.body.append(host);
   const root = createRoot(host);
   act(() =>
      root.render(
         <AllItemsContext.Provider value={ITEMS}>
            <DecideCall row={row} />
         </AllItemsContext.Provider>
      )
   );
   return host;
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')].map(b => b.textContent);
const click = (el: HTMLElement, words: string) =>
   act(() =>
      [...el.querySelectorAll('button')].find(b => b.textContent?.startsWith(words))?.click()
   );
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

describe('a row that asks about an initiative', () => {
   const goal: DecideRow = {
      slug: null,
      item: null,
      reasons: [{ kind: 'goal_reached', initiative: 4 }],
   };

   it('suggests closing it as done, with dropped and Keep open a click away', () => {
      const el = render(goal);
      expect(buttons(el)).toEqual(['Close as doneSuggested', 'Other answers']);
      click(el, 'Other answers');
      expect(buttons(el)).toEqual(['Close as doneSuggested', 'Close as dropped', 'Keep open']);
   });

   it('keeps it open by saying its status again, and Undo puts back the times', async () => {
      const el = render(goal);
      click(el, 'Other answers');
      click(el, 'Keep open');
      await settle();
      expect(el.textContent).toContain(
         'Kept open. Decide asks again once something in it changes.'
      );
      expect(calls.at(-1)).toMatchObject({
         method: 'PATCH',
         path: '/initiatives/4',
         body: { status: 'open', restate: true },
      });
      click(el, 'Undo');
      await settle();
      expect(calls.at(-1)).toMatchObject({
         method: 'PATCH',
         path: '/initiatives/4',
         body: { status: 'open', undo: { updated_at: 100, status_at: null } },
      });
   });

   it('suggests reopening a closed one a project is worked on in, or moving the project', () => {
      const el = render({
         slug: 'akeneo',
         item: null,
         reasons: [{ kind: 'reopened_in_closed', initiative: 3, as: 'done' }],
      });
      expect(buttons(el)).toEqual(['Reopen CatalogSuggested', 'Move the project']);
      click(el, 'Move the project');
      // the chooser leaves out the closed home and Not tracked
      const options = [...el.querySelectorAll('option')].map(o => o.textContent);
      expect(options).not.toContain('Catalog');
      expect(options).not.toContain('Not tracked');
   });
});

describe('a Not tracked project that grew', () => {
   const grew: DecideRow = {
      slug: 'ops',
      item: null,
      reasons: [{ kind: 'untracked_grew', since: 31, baseline: 2 }],
   };

   it('suggests keeping it not tracked, which files it there again', async () => {
      const el = render(grew);
      expect(buttons(el)).toEqual(['Keep not trackedSuggested', 'Track it']);
      click(el, 'Keep not tracked');
      await settle();
      expect(calls.find(c => c.path === '/initiatives/file')?.body).toEqual({
         project: 'ops',
         initiative: 'not-tracked',
         expect: 'not-tracked',
      });
      // Undo brings back its count as it stood, so the row comes back
      click(el, 'Undo');
      await settle();
      expect(calls.filter(c => c.path === '/initiatives/file').at(-1)?.body).toEqual({
         project: 'ops',
         initiative: 'not-tracked',
         set_at: 50,
         baseline_prs: 2,
      });
   });

   it('tracks it in the chooser’s pick from Track it', () => {
      const el = render(grew);
      click(el, 'Track it');
      expect(el.querySelector('select')).not.toBeNull();
   });
});

describe('the Initiative chooser on a row Decide asks to plan', () => {
   const fresh = (slug: string): DecideRow => ({
      slug,
      item: null,
      reasons: [{ kind: 'new', since: '2026-09-10' }],
   });
   const select = (el: HTMLElement) =>
      el.querySelector<HTMLSelectElement>('select[aria-label^="Initiative for"]');

   it('starts on the home a filed project has, so taking the answer blind moves nothing', async () => {
      const el = render(fresh('filed'));
      expect(select(el)?.value).toBe('site-speed');
      expect(el.textContent).not.toContain('guessed');
      click(el, 'Promise to finish by');
      await settle();
      expect(calls.some(c => c.path === '/initiatives/file')).toBe(false);
   });

   it('guesses for an Unsorted project from where its people work', () => {
      const el = render(fresh('new-thing'));
      expect(select(el)?.value).toBe('fixbot');
      expect(el.textContent).toContain('guessed');
   });

   it('files first, then plans, in one receipt, and Undo takes both back', async () => {
      const el = render(fresh('new-thing'));
      click(el, 'Promise to finish by');
      await settle();
      const writes = calls.filter(c => c.method !== 'GET');
      expect(writes.map(c => `${c.method} ${c.path}`)).toEqual([
         'PUT /initiatives/file',
         'POST /roadmap',
      ]);
      expect(writes[0].body).toEqual({ project: 'new-thing', initiative: 'fixbot', expect: null });
      expect(el.textContent).toMatch(
         /Promised to finish by .+, in FixBot chat\. Decide asks again/
      );
      calls.length = 0;
      click(el, 'Undo');
      await settle();
      expect(calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`)).toEqual([
         'DELETE /roadmap/77',
         'PUT /initiatives/file',
      ]);
      expect(calls.find(c => c.path === '/initiatives/file')?.body).toMatchObject({
         project: 'new-thing',
         initiative: null,
      });
   });
});

describe('the words for where a project belongs', () => {
   const row: DecideRow = { slug: 'x', item: null, reasons: [{ kind: 'unfiled' }] };
   it('say what each answer does', () => {
      expect(answerWords({ kind: 'file', to: 'fixbot', name: 'FixBot chat' }, null)).toBe(
         'File in FixBot chat'
      );
      expect(answerWords({ kind: 'file', to: 'not-tracked', name: 'Not tracked' }, null)).toBe(
         'Set not tracked'
      );
      expect(
         callWords(
            { kind: 'file', to: 'fixbot', name: 'FixBot chat' },
            row,
            undefined,
            '2026-10-11'
         )
      ).toBe('Filed in FixBot chat.');
      expect(
         callWords({ kind: 'park' }, row, undefined, '2026-10-11', {
            to: 'fixbot',
            name: 'FixBot chat',
         })
      ).toBe(
         'Parked, so it stops counting in the weeks ahead. Decide asks again if its PRs move. It’s in FixBot chat now.'
      );
   });

   it('keep two initiatives’ questions apart', () => {
      const ask = (initiative: number): DecideRow => ({
         slug: null,
         item: null,
         reasons: [{ kind: 'goal_reached', initiative }],
      });
      const made = new Map<string, Made>([
         [
            'initiative:1',
            {
               row: ask(1),
               call: { kind: 'keep_open' },
               words: '',
               state: 'made',
               origin: null,
               token: 1,
            },
         ],
      ]);
      const kept = keepCalls([ask(1), ask(2)], made);
      expect(kept.owed).toEqual([ask(2)]);
      expect(kept.all).toHaveLength(2);
   });
});
