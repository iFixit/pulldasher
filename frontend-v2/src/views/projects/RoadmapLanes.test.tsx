// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Initiative } from '../../../../shared/model/initiatives';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { loadInitiatives, useInitiativesValue } from '../../model/initiativesData';
import { loadRoadmap } from '../../model/roadmapData';
import type { ProjectsNav } from './parts';
import { Roadmap } from './Roadmap';

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
   owner: null,
   priority: id,
   status: 'open',
   status_at: null,
   created_by: null,
   created_at: null,
   updated_by: null,
   updated_at: 1,
   projects: projects.map(project => ({ project, set_by: null, set_at: 50, baseline_prs: 0 })),
   ...over,
});

const plan = (id: number, name: string, project: string | null, priority = id): RoadmapItem => ({
   id,
   name,
   project,
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   start: '2026-10-05',
   weeks: 8,
   end_kind: 'soft',
   done_when: '',
   priority,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: 1,
   created_at: 1,
   update: null,
});

const START: Initiative[] = [
   initiative(1, 'site-speed', 'Site speed', ['cache', 'images']),
   initiative(2, 'fixbot', 'FixBot chat', ['answers']),
   initiative(3, 'catalog', 'Catalog', [], { status: 'done', status_at: 1 }),
   initiative(9, 'shelf', 'Not tracked', ['ops'], { kind: 'untracked' }),
];
const PLANS = [
   plan(1, 'Image CDN', 'images'),
   plan(2, 'Answer search', 'answers'),
   plan(3, 'Cache warmer', 'cache'),
   plan(4, 'Checkout redesign', null),
   plan(5, 'Runbooks', 'ops'),
];

let server: Initiative[] = [];
const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
beforeAll(() => {
   vi.stubGlobal(
      'ResizeObserver',
      class {
         observe = () => undefined;
         disconnect = () => undefined;
      }
   );
   Element.prototype.scrollIntoView = () => undefined;
   vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
         const method = init?.method ?? 'GET';
         const body = init?.body ? JSON.parse(String(init.body)) : null;
         calls.push({ method, path, body });
         const reply = (json: unknown, status = 200) =>
            ({ status, redirected: false, json: async () => json } as Response);
         if (path === '/roadmap' && method === 'GET') return reply({ items: PLANS });
         if (path === '/roadmap/order') {
            const ids = body?.ids as number[];
            return reply({
               items: PLANS.map(p => ({ ...p, priority: ids.indexOf(p.id) })).sort(
                  (a, b) => a.priority - b.priority
               ),
            });
         }
         if (path === '/initiatives' && method === 'GET') return reply({ initiatives: server });
         const move = path.match(/^\/initiatives\/(\d+)\/move$/);
         if (move) {
            const id = Number(move[1]);
            const ranked = [...server].sort((a, b) => a.priority - b.priority);
            const moving = ranked.find(i => i.id === id) as Initiative;
            const rest = ranked.filter(i => i.id !== id);
            const at = body?.before == null ? rest.length : rest.findIndex(i => i.id === body.before);
            rest.splice(at, 0, moving);
            server = rest.map((i, k) => ({ ...i, priority: k }));
            return reply({ initiatives: server });
         }
         if (path === '/initiatives/file') {
            // as the server: nothing into a closed initiative
            const to = server.find(i => i.slug === body?.initiative);
            if (to && to.status !== 'open' && body?.set_at == null)
               return reply({ error: 'that initiative is closed' }, 409);
            const was = server.find(i => i.projects.some(f => f.project === body?.project));
            return reply({
               project: body?.project,
               before: { initiative: was?.slug ?? null, set_at: 50, baseline_prs: 0 },
               home: null,
            });
         }
         return reply({}, 404);
      })
   );
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;
beforeEach(async () => {
   server = START.map(i => ({ ...i }));
   localStorage.clear();
   await loadInitiatives();
   await loadRoadmap();
   calls.length = 0;
});
afterEach(() => {
   // an unmounted tree stops listening to the stores the next test writes
   act(() => root?.unmount());
   root = null;
   host?.remove();
   host = null;
});

const NAV = {
   view: 'roadmap',
   project: null,
   initiative: null,
   within: null,
   range: '30d',
   status: 'live',
   group: 'initiative',
   sort: 'plan',
   find: '',
   scale: 'quarter',
   item: null,
   show: 'all',
   week: null,
   zoom: null,
   team: null,
   origin: null,
   by: 'team',
   kind: 'all',
   who: null,
   only: null,
   psort: '',
} as ProjectsNav;

const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

/** where the Roadmap asked to go */
const went: Partial<ProjectsNav>[] = [];

/** The Roadmap with the initiatives as the board holds them, as the app
 * passes them, so a move shows in the next render. */
function Live({ nav }: { nav: ProjectsNav }) {
   const { initiatives } = useInitiativesValue();
   return (
      <Roadmap
         items={[]}
         initiatives={initiatives ? [...initiatives] : server}
         untracked={new Set(['ops'])}
         teamMembers={{}}
         nav={nav}
         navigate={to => went.push(to)}
         decisions={[]}
      />
   );
}

async function mount(nav: Partial<ProjectsNav> = {}) {
   host = document.createElement('div');
   document.body.append(host);
   const r = createRoot(host);
   root = r;
   await act(async () => r.render(<Live nav={{ ...NAV, ...nav }} />));
   await settle();
   return host;
}

const lane = (el: HTMLElement, slug: string) =>
   el.querySelector<HTMLElement>(`[data-lane-id="roadmap:initiative:${slug}"]`) as HTMLElement;
/** the receipts drawn that say `words`: each has its own Undo */
const receipts = (el: HTMLElement, words: string) =>
   [...el.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === `Undo: ${words}`)
      .length;
const writes = () => calls.filter(c => c.method !== 'GET');

/** A drag from `from`, over and onto `to`, as the browser sends it. */
function drag(from: Element, to: Element): { refused: boolean } {
   const data = { effectAllowed: '', setData: () => undefined, getData: () => '' };
   const event = (type: string) =>
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: data });
   act(() => {
      from.dispatchEvent(event('dragstart'));
   });
   const over = event('dragover');
   act(() => {
      to.dispatchEvent(over);
   });
   act(() => {
      to.dispatchEvent(event('drop'));
   });
   return { refused: !over.defaultPrevented };
}

describe('the Roadmap by initiative', () => {
   it('draws a lane per open initiative in its priority, then Unsorted, No project yet and Not tracked', async () => {
      const el = await mount();
      const bands = [...el.querySelectorAll('summary')].map(s => s.textContent ?? '');
      const at = (words: string) => bands.findIndex(b => b.includes(words));
      expect(at('1 Site speed')).toBeGreaterThan(-1);
      expect(at('2 FixBot chat')).toBeGreaterThan(at('1 Site speed'));
      expect(at('No project yet')).toBeGreaterThan(at('2 FixBot chat'));
      expect(at('Not tracked')).toBeGreaterThan(at('No project yet'));
      // the closed one holds nothing, so it has no band
      expect(at('Catalog')).toBe(-1);
      // Not tracked's plan sits in its own lane, not in an initiative's
      expect(lane(el, 'site-speed').textContent).not.toContain('Runbooks');
      expect(el.textContent).toContain('Runbooks');
   });

   it('numbers a lane’s rows by their place in it, with the whole roadmap’s on the grip', async () => {
      const el = await mount();
      const grips = [...lane(el, 'site-speed').querySelectorAll('[id^="roadmap-grip-"]')];
      expect(grips.map(g => g.getAttribute('aria-label')?.split('.')[0])).toEqual([
         'Image CDN: priority 1 in its lane, 1 on the whole roadmap',
         'Cache warmer: priority 2 in its lane, 3 on the whole roadmap',
      ]);
   });

   it('moves a lane with the arrow keys, says so once whether it’s open or closed, and Undo puts it back', async () => {
      const el = await mount();
      for (const open of [false, true]) {
         const band = lane(el, 'fixbot').querySelector('details') as HTMLDetailsElement;
         act(() => {
            band.open = open;
         });
         const grip = el.querySelector('#roadmap-lane-grip-2') as HTMLElement;
         act(() => {
            grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
         });
         await settle();
         expect(writes().at(-1)).toMatchObject({ path: '/initiatives/2/move', body: { before: 1 } });
         expect(receipts(el, 'Moved FixBot chat to priority 1')).toBe(1);
         const undo = [...el.querySelectorAll('button')].find(
            b => b.getAttribute('aria-label') === 'Undo: Moved FixBot chat to priority 1'
         ) as HTMLButtonElement;
         act(() => undo.click());
         await settle();
         // back above the one it sat above: Catalog, which sat after it
         expect(writes().at(-1)).toMatchObject({ path: '/initiatives/2/move', body: { before: 3 } });
         expect(el.textContent).toContain('Put FixBot chat back at priority 2');
      }
   });

   it('undoes a run of lane moves to where the run began, and holds its words in place', async () => {
      server = [
         ...START,
         initiative(4, 'alpha', 'Alpha', []),
         initiative(5, 'beta', 'Beta', []),
      ];
      await loadInitiatives();
      const el = await mount();
      for (let k = 0; k < 3; k++) {
         act(() => {
            (el.querySelector('#roadmap-lane-grip-5') as HTMLElement).dispatchEvent(
               new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
            );
         });
         await settle();
      }
      expect(receipts(el, 'Moved Beta to priority 1')).toBe(1);
      const undo = [...el.querySelectorAll('button')].find(
         b => b.getAttribute('aria-label') === 'Undo: Moved Beta to priority 1'
      ) as HTMLButtonElement;
      act(() => undo.click());
      await settle();
      // above the one it sat above before the first press: none, the bottom
      // of the list (Not tracked's own rank aside), so priority 4 again
      expect(writes().at(-1)).toMatchObject({ path: '/initiatives/5/move', body: { before: 9 } });
      expect(el.textContent).toContain('Put Beta back at priority 4.');
      // the words stay where the receipt was, with nothing to click in it,
      // so a second click on that spot does nothing
      const said = [...el.querySelectorAll('div')].find(d =>
         d.textContent?.startsWith('Put Beta back at priority 4')
      ) as HTMLElement;
      expect(said.querySelector('button, a')).toBeNull();
      const before = writes().length;
      act(() => undo.click());
      await settle();
      expect(writes().length).toBe(before);
   });

   it('refuses a plan dragged onto a closed initiative’s lane', async () => {
      // Catalog is closed, and holds a project still worked on, so it shows
      server = START.map(i =>
         i.slug === 'catalog'
            ? { ...i, projects: [{ project: 'images', set_by: null, set_at: 50, baseline_prs: 0 }] }
            : i.slug === 'site-speed'
            ? { ...i, projects: i.projects.filter(f => f.project !== 'images') }
            : i
      );
      await loadInitiatives();
      const el = await mount();
      const grip = el.querySelector('#roadmap-grip-2') as HTMLElement;
      expect(drag(grip, lane(el, 'catalog')).refused).toBe(true);
      // nor onto a row in that lane
      expect(drag(grip, el.querySelector('#roadmap-item-1') as HTMLElement).refused).toBe(true);
      expect(writes()).toEqual([]);
   });

   it('files a plan dropped on another lane, leaves its priority, and Undo files it back', async () => {
      const el = await mount();
      const grip = el.querySelector('#roadmap-grip-1') as HTMLElement;
      expect(drag(grip, lane(el, 'fixbot')).refused).toBe(false);
      await settle();
      expect(writes()).toEqual([
         {
            method: 'PUT',
            path: '/initiatives/file',
            body: { project: 'images', initiative: 'fixbot', expect: 'site-speed' },
         },
      ]);
      expect(el.textContent).toContain('Filed Image CDN in FixBot chat.');
      act(() => [...el.querySelectorAll('button')].find(b => b.textContent === 'Undo')?.click());
      await settle();
      expect(writes().at(-1)?.body).toMatchObject({ project: 'images', initiative: 'site-speed' });
      expect(el.textContent).toContain('Put Image CDN back in Site speed');
   });

   it('refuses a plan with no project on a lane, and says how to link it if one lands', async () => {
      const el = await mount();
      const grip = el.querySelector('#roadmap-grip-4') as HTMLElement;
      // nothing lights: the lane doesn't take the drag
      expect(drag(grip, lane(el, 'fixbot')).refused).toBe(true);
      expect(writes()).toEqual([]);
      // a row in another lane doesn't take it either
      expect(drag(grip, el.querySelector('#roadmap-item-2') as HTMLElement).refused).toBe(true);
      expect(writes()).toEqual([]);
   });

   it('renumbers a lane’s row moved with the arrow keys in the words its row shows', async () => {
      const el = await mount();
      const grip = el.querySelector('#roadmap-grip-3') as HTMLElement;
      act(() => {
         grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      });
      await settle();
      expect(writes().at(-1)).toMatchObject({ path: '/roadmap/order', body: { ids: [3, 1, 2, 4, 5] } });
      expect(el.textContent).toContain('Moved Cache warmer to priority 1 in Site speed.');
   });

   it('opens the lane a linked plan sits in', async () => {
      localStorage.clear();
      const el = await mount({ item: 2 });
      const band = lane(el, 'fixbot').querySelector('details') as HTMLDetailsElement;
      expect(band.open).toBe(true);
   });

   it('opens the plan a clash waits on when its words are clicked', async () => {
      // Cache warmer starts before Image CDN, which it waits on, is done
      const was = PLANS[2];
      PLANS[2] = { ...was, waits_on: [1] };
      try {
         await loadRoadmap();
         const el = await mount();
         const words = el.querySelector('#roadmap-words-3') as HTMLButtonElement;
         expect(words.textContent).toContain('Starts before Image CDN is done');
         went.length = 0;
         act(() => words.click());
         expect(went.at(-1)).toMatchObject({ item: 1 });
      } finally {
         PLANS[2] = was;
      }
   });

   it('links the initiative’s page with a real address', async () => {
      const el = await mount();
      const link = [...lane(el, 'site-speed').querySelectorAll('a')].find(
         a => a.textContent === 'Initiative page'
      );
      expect(link?.getAttribute('href')).toContain('initiative=site-speed');
   });
});
