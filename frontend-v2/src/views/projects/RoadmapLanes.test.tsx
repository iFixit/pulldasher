// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecideRow } from '../../../../shared/model/decide';
import type { Initiative } from '../../../../shared/model/initiatives';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { loadInitiatives, useInitiativesValue } from '../../model/initiativesData';
import { loadRoadmap } from '../../model/roadmapData';
import type { ProjectsNav } from './parts';
import { Roadmap } from './Roadmap';
import { clearHolds, pressedBy } from '../../components/settle';

// jsdom makes no trusted events: every press here is a person's
pressedBy.person = () => true;

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
/** the next write of this kind fails, as the server says why */
let refuse: { undo?: string; file?: string; move?: string } = {};
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
         if (move && refuse.move) {
            const error = refuse.move;
            refuse = {};
            return reply({ error }, 500);
         }
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
         if (path === '/initiatives/file' && (body?.set_at == null ? refuse.file : refuse.undo)) {
            const error = (body?.set_at == null ? refuse.file : refuse.undo) as string;
            refuse = {};
            return reply({ error }, 409);
         }
         if (path === '/initiatives/file') {
            // as the server: nothing into a closed initiative
            const to = server.find(i => i.slug === body?.initiative);
            if (to && to.status !== 'open' && body?.set_at == null)
               return reply({ error: 'that initiative is closed' }, 409);
            const was = server.find(i => i.projects.some(f => f.project === body?.project));
            // filed: out of the home it had, into the one named
            server = server.map(i => ({
               ...i,
               projects: [
                  ...i.projects.filter(f => f.project !== body?.project),
                  ...(i.slug === body?.initiative
                     ? [{ project: body.project as string, set_by: null, set_at: 60, baseline_prs: 0 }]
                     : []),
               ],
            }));
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
   refuse = {};
   localStorage.clear();
   await loadInitiatives();
   await loadRoadmap();
   calls.length = 0;
});
afterEach(() => {
   clearHolds();
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
function Live({
   nav: start,
   decisions = [],
   goes = false,
}: {
   nav: ProjectsNav;
   decisions?: DecideRow[];
   /** it goes where it asks to (a link that opens another plan) */
   goes?: boolean;
}) {
   const { initiatives } = useInitiativesValue();
   const [nav, setNav] = useState(start);
   return (
      <Roadmap
         items={[]}
         initiatives={initiatives ? [...initiatives] : server}
         untracked={new Set(['ops'])}
         teamMembers={{}}
         nav={nav}
         navigate={to => {
            went.push(to);
            if (goes) setNav(n => ({ ...n, ...to }));
         }}
         decisions={decisions}
      />
   );
}

async function mount(
   nav: Partial<ProjectsNav> = {},
   live: { decisions?: DecideRow[]; goes?: boolean } = {}
) {
   host = document.createElement('div');
   document.body.append(host);
   const r = createRoot(host);
   root = r;
   await act(async () => r.render(<Live nav={{ ...NAV, ...nav }} {...live} />));
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

/** A drag from `from`, over and onto `to`, as the browser sends it,
 * dropped at `at` on the screen. */
function drag(from: Element, to: Element, at = { clientX: 0, clientY: 0 }): { refused: boolean } {
   const data = { effectAllowed: '', setData: () => undefined, getData: () => '' };
   const event = (type: string) =>
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
         dataTransfer: data,
         ...at,
      });
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

describe('a row’s question or clash', () => {
   const focusedId = () => (document.activeElement as HTMLElement).id;

   it('opens the details with the focus on the Plan line, the answers a Tab away', async () => {
      const asked: DecideRow = { slug: 'answers', item: PLANS[1], reasons: [{ kind: 'off_track' }] };
      const el = await mount({}, { decisions: [asked], goes: true });
      // named by the words it shows; the reason is its description
      const words = el.querySelector<HTMLButtonElement>('#roadmap-words-2') as HTMLButtonElement;
      expect(words.getAttribute('aria-label')).toBeNull();
      expect(words.querySelector('.sr-only')).toBeNull();
      const why = document.getElementById(words.getAttribute('aria-describedby') as string);
      expect(why?.hidden).toBe(true);
      expect(why?.textContent).toBe(words.title);
      act(() => words.click());
      await settle();
      expect(focusedId()).toBe('roadmap-plan-2');
      // an Enter there answers nothing
      const sent = writes().length;
      act(() => {
         document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
         );
      });
      await settle();
      expect(writes()).toHaveLength(sent);
   });

   it('opens the plan a clash waits on, the focus on its Plan line', async () => {
      // Image CDN waits on Cache warmer, which ends after it starts
      PLANS[0].waits_on = [3];
      try {
         await act(() => loadRoadmap());
         const el = await mount({}, { goes: true });
         act(() => el.querySelector<HTMLButtonElement>('#roadmap-words-1')?.click());
         await settle();
         expect(went.at(-1)).toMatchObject({ item: 3 });
         expect(focusedId()).toBe('roadmap-plan-3');
      } finally {
         PLANS[0].waits_on = [];
      }
   });
});

describe('the Not tracked lane', () => {
   it('opens while Decide asks about a row in it, and says the question there', async () => {
      const grew: DecideRow = {
         slug: 'ops',
         item: null,
         reasons: [{ kind: 'untracked_grew', since: 31, baseline: 2 }],
      };
      const el = await mount({}, { decisions: [grew], goes: true });
      const fold = el.querySelector(
         '[data-lane-id="roadmap:not-tracked"] details'
      ) as HTMLDetailsElement;
      expect(fold.open).toBe(true);
      const words = el.querySelector<HTMLButtonElement>('#roadmap-words-5') as HTMLButtonElement;
      expect(words.textContent).toContain('Still not tracked?');
      // its details answer it
      act(() => words.click());
      await settle();
      const details = el.querySelector('[aria-label="Runbooks: its plan"]') as HTMLElement;
      expect(details.textContent).toContain('Keep not tracked');
   });

   it('says a project’s question on one of its plans, the first in rank', async () => {
      const grew: DecideRow = {
         slug: 'ops',
         item: null,
         reasons: [{ kind: 'untracked_grew', since: 31, baseline: 2 }],
      };
      PLANS.push(plan(6, 'Alerting', 'ops', 0));
      try {
         await act(() => loadRoadmap());
         const el = await mount({}, { decisions: [grew] });
         const asking = [...el.querySelectorAll('[id^="roadmap-words-"]')].filter(w =>
            w.textContent?.includes('Still not tracked?')
         );
         expect(asking.map(w => w.id)).toEqual(['roadmap-words-6']);
      } finally {
         PLANS.pop();
         await act(() => loadRoadmap());
      }
   });

   it('says on Now, next, later where its asked plan is, its name the way to the question', async () => {
      const grew: DecideRow = {
         slug: 'ops',
         item: null,
         reasons: [{ kind: 'untracked_grew', since: 31, baseline: 2 }],
      };
      const el = await mount({ scale: 'now' }, { decisions: [grew] });
      expect(el.textContent).toContain(
         'Runbooks is Not tracked, so it’s in no column here, but Decide asks about it.'
      );
      went.length = 0;
      act(() => [...el.querySelectorAll('button')].find(b => b.textContent === 'Runbooks')?.click());
      expect(went.at(-1)).toMatchObject({ item: 5 });
   });

   it('rests closed when nothing in it is asked about', async () => {
      const el = await mount();
      const fold = el.querySelector(
         '[data-lane-id="roadmap:not-tracked"] details'
      ) as HTMLDetailsElement;
      expect(fold.open).toBe(false);
   });
});

describe('File elsewhere in a plan’s details', () => {
   it('leaves a receipt with Undo under the row in its new lane, the focus on its words', async () => {
      const el = await mount({ item: 2 });
      const details = el.querySelector('[aria-label="Answer search: its plan"]') as HTMLElement;
      act(() => details.querySelector<HTMLButtonElement>('[aria-label^="File elsewhere"]')?.click());
      const select = details.querySelector('select') as HTMLSelectElement;
      act(() => {
         select.value = 'site-speed';
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      act(() => [...details.querySelectorAll('button')].find(b => b.textContent === 'File')?.click());
      await settle();
      await settle();
      // the plan and its details moved to Site speed's lane; the receipt went too
      const words = document.activeElement as HTMLElement;
      expect(words.textContent).toBe('Filed Answer search in Site speed.');
      expect(lane(el, 'site-speed').contains(words)).toBe(true);
      expect(receipts(el, 'Filed Answer search in Site speed')).toBe(1);
      // an extra Enter lands on words; Undo puts it back, its words take the focus
      act(() =>
         el.querySelector<HTMLButtonElement>('[aria-label="Undo: Filed Answer search in Site speed"]')?.click()
      );
      await settle();
      await settle();
      expect((document.activeElement as HTMLElement).textContent).toBe(
         'Put Answer search back in FixBot chat.'
      );
      expect(lane(el, 'fixbot').contains(document.activeElement)).toBe(true);
      expect(writes().filter(c => c.path === '/initiatives/file')).toHaveLength(2);
   });
});

describe('a plan’s details while Decide asks where its project goes', () => {
   it('offer filing once: the Plan line’s File, and no File elsewhere', async () => {
      // Cache warmer's project is filed nowhere
      server = START.map(i =>
         i.slug === 'site-speed' ? { ...i, projects: i.projects.filter(f => f.project !== 'cache') } : i
      );
      await loadInitiatives();
      const unfiled: DecideRow = { slug: 'cache', item: null, reasons: [{ kind: 'unfiled' }] };
      const el = await mount({ item: 3 }, { decisions: [unfiled] });
      const details = el.querySelector('[aria-label="Cache warmer: its plan"]') as HTMLElement;
      expect(details.querySelector('[aria-label^="File cache"]')).not.toBeNull();
      expect(details.querySelector('[aria-label^="File elsewhere"]')).toBeNull();
   });
});

describe('the Roadmap by initiative', () => {
   it('opens a linked plan’s details without putting the focus on an end to promise', async () => {
      // nobody has clicked or pressed a key on the page yet
      Object.defineProperty(navigator, 'userActivation', {
         value: { hasBeenActive: false },
         configurable: true,
      });
      try {
         const el = await mount({ item: 2 });
         expect(el.querySelector('[role="toolbar"]')).not.toBeNull();
         expect(document.activeElement).toBe(document.body);
      } finally {
         delete (navigator as { userActivation?: unknown }).userActivation;
      }
   });

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

   it('keeps one Undo for a run that moves two lanes, and it puts both back', async () => {
      server = [...START, initiative(4, 'alpha', 'Alpha', []), initiative(5, 'beta', 'Beta', [])];
      await loadInitiatives();
      const el = await mount();
      const up = (id: number, key = 'ArrowUp') =>
         act(() => {
            (el.querySelector(`#roadmap-lane-grip-${id}`) as HTMLElement).dispatchEvent(
               new KeyboardEvent('keydown', { key, bubbles: true })
            );
         });
      // Beta up two, then FixBot chat down one
      up(5);
      await settle();
      up(5);
      await settle();
      up(2, 'ArrowDown');
      await settle();
      const undos = [...el.querySelectorAll('button')].filter(b => b.textContent === 'Undo');
      expect(undos).toHaveLength(1);
      expect(undos[0].getAttribute('aria-label')).toBe(
         'Undo: Moved Beta to priority 2 and FixBot chat to priority 4'
      );
      act(() => undos[0].click());
      await settle();
      await settle();
      const order = [...server].sort((a, b) => a.priority - b.priority).map(i => i.slug);
      expect(order).toEqual(['site-speed', 'fixbot', 'catalog', 'alpha', 'beta', 'shelf']);
      expect(el.textContent).toContain('Put Beta and FixBot chat back at their priorities.');
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

/** A mouse's press at a point onto `el`, whatever sits there now. */
const pressAt = (el: Element, x: number, y: number) =>
   act(() => {
      const at = { bubbles: true, cancelable: true, clientX: x, clientY: y };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
         el.dispatchEvent(new MouseEvent(type, at));
      el.dispatchEvent(new MouseEvent('click', { ...at, detail: 1 }));
   });
const pointerTo = (x: number, y: number) =>
   act(() => {
      document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
   });

describe('a bar let go over another lane', () => {
   it('moves nothing, and says the grip is what files it', async () => {
      const el = await mount();
      const bar = el.querySelector('#roadmap-bar-1') as HTMLElement;
      const other = lane(el, 'fixbot');
      const rect = vi
         .spyOn(Element.prototype, 'getBoundingClientRect')
         .mockReturnValue({ left: 0, right: 700, width: 700, top: 0, bottom: 20, height: 20 } as DOMRect);
      // the pointer ends over FixBot chat's lane
      document.elementFromPoint = () => other;
      try {
         const at = (x: number) => ({ bubbles: true, cancelable: true, clientX: x, clientY: 300 });
         act(() => {
            bar.dispatchEvent(new MouseEvent('pointerdown', at(100)));
         });
         act(() => {
            window.dispatchEvent(new MouseEvent('pointermove', at(160)));
         });
         act(() => {
            window.dispatchEvent(new MouseEvent('pointerup', at(160)));
         });
         await settle();
      } finally {
         rect.mockRestore();
         delete (document as Partial<Document>).elementFromPoint;
      }
      expect(writes()).toEqual([]);
      expect(el.textContent).toContain(
         'Nothing moved: a bar moves its dates. To put it in another lane, drag its grip, left of its name.'
      );
   });
});

describe('after a click on the Roadmap', () => {
   /** Lay the page out as a browser would, as far as these tests look: a
    * sticky header 120 px tall, every receipt at `receiptTop`, its row's
    * line 40 px above it, and nothing else with a box. */
   function layout(receiptTop: () => number) {
      const header = document.createElement('div');
      header.className = 'sticky';
      header.style.position = 'sticky';
      header.style.top = '0px';
      document.body.prepend(header);
      const box = (top: number, height: number) =>
         ({ top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top }) as DOMRect;
      const real = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
         if (this === header) return box(0, 120);
         if (this.closest('[data-receipt]')) return box(receiptTop(), 30);
         if (this.parentElement?.matches('[data-roadmap-row]') && this === this.parentElement.firstElementChild)
            return box(receiptTop() - 40, 40);
         return { ...box(0, 0), width: 0, right: 0 } as DOMRect;
      };
      const scrolled: number[] = [];
      const spy = vi.spyOn(window, 'scrollBy').mockImplementation(((_x: number, y: number) => {
         scrolled.push(y);
      }) as typeof window.scrollBy);
      return {
         scrolled,
         restore: () => {
            HTMLElement.prototype.getBoundingClientRect = real;
            spy.mockRestore();
            header.remove();
         },
      };
   }

   const fileFromDetails = async (el: HTMLElement, plan: string, to: string) => {
      const details = el.querySelector(`[aria-label="${plan}: its plan"]`) as HTMLElement;
      act(() => details.querySelector<HTMLButtonElement>('[aria-label^="File elsewhere"]')?.click());
      const select = details.querySelector('select') as HTMLSelectElement;
      act(() => {
         select.value = to;
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      act(() => [...details.querySelectorAll('button')].find(b => b.textContent === 'File')?.click());
      await settle();
      await settle();
   };

   it('shows a details filing’s receipt below the sticky header when its lane is above', async () => {
      // the receipt lands in Site speed's lane, above, scrolled under the header
      const page = layout(() => 50);
      try {
         const el = await mount({ item: 2 });
         await fileFromDetails(el, 'Answer search', 'site-speed');
         expect((document.activeElement as HTMLElement).textContent).toBe(
            'Filed Answer search in Site speed.'
         );
         // brought down to just below the header with its row's line, and
         // no further
         expect(page.scrolled.at(-1)).toBe(50 - 40 - 120 - 8);
      } finally {
         page.restore();
      }
   });

   it('shows a details filing’s receipt above the window’s bottom when its lane is below', async () => {
      const page = layout(() => innerHeight + 200);
      try {
         const el = await mount({ item: 3 });
         await fileFromDetails(el, 'Cache warmer', 'fixbot');
         expect((document.activeElement as HTMLElement).textContent).toBe(
            'Filed Cache warmer in FixBot chat.'
         );
         expect(page.scrolled.at(-1)).toBe(200 + 30 + 8);
      } finally {
         page.restore();
      }
   });

   it('holds a drop’s point: the Undo that slid there takes no press until the pointer moves', async () => {
      const el = await mount();
      drag(el.querySelector('#roadmap-grip-1') as HTMLElement, lane(el, 'fixbot'), {
         clientX: 240,
         clientY: 400,
      });
      await settle();
      expect(el.textContent).toContain('Filed Image CDN in FixBot chat.');
      const undo = [...el.querySelectorAll('button')].find(
         b => b.textContent === 'Undo'
      ) as HTMLButtonElement;
      const sent = writes().length;
      // a second press where the drop let go, with the pointer still
      pressAt(undo, 240, 400);
      await settle();
      expect(writes()).toHaveLength(sent);
      pointerTo(400, 600);
      pressAt(undo, 240, 400);
      await settle();
      expect(writes()).toHaveLength(sent + 1);
      expect(el.textContent).toContain('Put Image CDN back in Site speed');
   });

   it('keeps a second Undo on one receipt as still as the first, and leaves no style on the page', async () => {
      const el = await mount();
      const grip = () => el.querySelector('#roadmap-lane-grip-2') as HTMLElement;
      for (const k of [1, 2]) {
         act(() => {
            grip().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
         });
         await settle();
         const undo = [...el.querySelectorAll('button')].find(
            b => b.getAttribute('aria-label') === 'Undo: Moved FixBot chat to priority 1'
         ) as HTMLButtonElement;
         // a pointer's Undo, each time somewhere new
         pressAt(undo, 100 * k, 100 * k);
         await settle();
         expect(el.textContent).toContain('Put FixBot chat back at priority 2');
         const receipt = el.querySelector('[data-receipt="initiative:2"]') as HTMLElement;
         expect(receipt.style.marginTop).toBe('');
         expect(receipt.style.transition).toBe('');
         expect(document.body.getAttribute('style')).toBeNull();
         pointerTo(900, 900);
      }
      expect(writes().filter(c => c.path === '/initiatives/2/move')).toHaveLength(4);
   });
});

describe('a write on the Roadmap that fails', () => {
   const undoOf = (el: HTMLElement) =>
      [...el.querySelectorAll('button')].find(b => b.textContent === 'Undo') as HTMLButtonElement;

   it('says the server’s reason when a drop’s Undo fails, and keeps a way to try again', async () => {
      const el = await mount();
      drag(el.querySelector('#roadmap-grip-1') as HTMLElement, lane(el, 'fixbot'));
      await settle();
      refuse = { undo: 'someone filed it in Catalog since' };
      act(() => undoOf(el).click());
      await settle();
      expect(el.textContent).toContain('someone filed it in Catalog since.');
      const again = el.querySelector<HTMLButtonElement>('[aria-label="Try the Undo again"]');
      expect(again).not.toBeNull();
      act(() => again?.click());
      await settle();
      expect(writes().at(-1)?.body).toMatchObject({ project: 'images', initiative: 'site-speed' });
      expect(el.textContent).toContain('Put Image CDN back in Site speed');
   });

   it('says the server’s reason when a lane move’s Undo fails, and keeps a way to try again', async () => {
      const el = await mount();
      act(() => {
         (el.querySelector('#roadmap-lane-grip-2') as HTMLElement).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
         );
      });
      await settle();
      refuse = { move: 'the database is down' };
      act(() => undoOf(el).click());
      await settle();
      expect(el.textContent).toContain('the database is down.');
      act(() => el.querySelector<HTMLButtonElement>('[aria-label="Try the Undo again"]')?.click());
      await settle();
      expect(el.textContent).toContain('Put FixBot chat back at priority 2');
   });

   it('puts the focus on why, when a filing from a plan’s details fails', async () => {
      const el = await mount({ item: 2 });
      const details = el.querySelector('[aria-label="Answer search: its plan"]') as HTMLElement;
      act(() => details.querySelector<HTMLButtonElement>('[aria-label^="File elsewhere"]')?.click());
      const select = details.querySelector('select') as HTMLSelectElement;
      act(() => {
         select.value = 'site-speed';
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      refuse = { file: 'its home changed; here it is now' };
      act(() => [...details.querySelectorAll('button')].find(b => b.textContent === 'File')?.click());
      await settle();
      await settle();
      expect((document.activeElement as HTMLElement).textContent).toContain(
         'its home changed; here it is now.'
      );
   });
});
