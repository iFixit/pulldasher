// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecideRow } from '../../../../shared/model/decide';
import type { Initiative } from '../../../../shared/model/initiatives';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { loadInitiatives, useInitiativesValue } from '../../model/initiativesData';
import { loadRoadmap } from '../../model/roadmapData';
import type { ProjectsNav } from './parts';
import { Roadmap } from './Roadmap';
import { clearHolds, pressedBy } from '../../components/settle';

// the roadmap's window as the toolbar, the edge chip and the "Done before"
// fold move and fill it, on Oct 13, 2026

pressedBy.person = () => true;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan = (id: number, over: Partial<RoadmapItem>): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project: null,
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   start: '2026-10-05',
   weeks: 8,
   end_kind: 'soft',
   done_when: '',
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: 1,
   created_at: 1,
   update: null,
   ...over,
});

const PLANS = [
   plan(1, { name: 'Live work' }),
   // done a year ago: the fold's
   plan(2, { name: 'Old export', status: 'done', start: '2025-10-06', weeks: 4 }),
   // done a year ago, and Decide asks to reopen it: never folded
   plan(3, { name: 'Akeneo 4', project: 'akeneo', status: 'done', start: '2025-11-03', weeks: 6 }),
   // planned for last November and never started: a row with an edge chip
   plan(4, { name: 'Stale plan', status: 'planned', start: '2025-11-03', weeks: 3 }),
   // done, its one week the window's first: Jun 29 to Jul 5
   plan(5, { name: 'Edge done', status: 'done', start: '2026-06-29', weeks: 1 }),
   // under way, with no project: the No project yet lane
   plan(6, { name: 'Loose work', status: 'active', start: '2026-10-05', weeks: 2 }),
];
const REOPEN: DecideRow = {
   slug: 'akeneo',
   item: PLANS[2],
   reasons: [{ kind: 'reopened', open: 1, late: 1, as: 'done', by: 'issue' }],
};
const INITIATIVES: Initiative[] = [
   {
      id: 1,
      slug: 'catalog',
      name: 'Catalog',
      kind: 'initiative',
      goal: '',
      owner: null,
      priority: 1,
      status: 'open',
      status_at: null,
      created_by: null,
      created_at: null,
      updated_by: null,
      updated_at: 1,
      projects: [{ project: 'akeneo', set_by: null, set_at: 50, baseline_prs: 0 }],
   },
];

const asked: string[] = [];
beforeAll(() => {
   vi.useFakeTimers({ toFake: ['Date'] });
   vi.setSystemTime(new Date(2026, 9, 13, 12));
   vi.stubGlobal(
      'ResizeObserver',
      class {
         observe = () => undefined;
         disconnect = () => undefined;
      }
   );
   window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
   Element.prototype.scrollIntoView = () => undefined;
   vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
         asked.push(path);
         const patch = /^\/roadmap\/(\d+)$/.exec(path);
         if (patch && init?.method === 'PATCH') {
            const at = PLANS.findIndex(i => i.id === Number(patch[1]));
            PLANS[at] = { ...PLANS[at], ...JSON.parse(String(init.body)), updated_at: 2 };
            return {
               status: 200,
               ok: true,
               redirected: false,
               json: async () => ({ item: PLANS[at] }),
            } as Response;
         }
         const reply = (json: unknown, status = 200) =>
            ({ status, ok: status < 400, redirected: false, json: async () => json } as Response);
         if (path === '/roadmap') return reply({ items: PLANS });
         if (path === '/initiatives') return reply({ initiatives: INITIATIVES });
         return reply({}, 404);
      })
   );
});
afterAll(() => vi.useRealTimers());

let host: HTMLDivElement | null = null;
let root: Root | null = null;
beforeEach(async () => {
   localStorage.clear();
   await loadInitiatives();
   await loadRoadmap();
   asked.length = 0;
   went.length = 0;
});
afterEach(() => {
   clearHolds();
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
   group: 'none',
   sort: 'plan',
   find: '',
   scale: 'quarter',
   item: null,
   show: 'all',
   week: null,
   zoom: null,
   window: null,
   team: null,
   origin: null,
   by: 'team',
   kind: 'all',
   who: null,
   only: null,
   psort: '',
} as ProjectsNav;

const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));
const went: Partial<ProjectsNav>[] = [];

function Live({ nav: start }: { nav: ProjectsNav }) {
   const { initiatives } = useInitiativesValue();
   const [nav, setNav] = useState(start);
   return (
      <Roadmap
         items={[]}
         initiatives={initiatives ? [...initiatives] : INITIATIVES}
         teamMembers={{}}
         nav={nav}
         navigate={to => {
            went.push(to);
            setNav(n => ({ ...n, ...to }));
         }}
         decisions={[REOPEN]}
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

// the picker's panel is drawn at the end of the page, so look there too
const buttons = (el: HTMLElement) => [
   ...el.querySelectorAll<HTMLButtonElement>('button'),
   ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
];
const button = (el: HTMLElement, name: string | RegExp) =>
   buttons(el).find(b =>
      [b.getAttribute('aria-label') ?? '', b.textContent ?? ''].some(t =>
         typeof name === 'string' ? t === name : name.test(t)
      )
   );
const press = async (b: HTMLElement | undefined) => {
   expect(b).toBeTruthy();
   act(() => b?.click());
   await settle();
};
const text = (el: HTMLElement) => el.textContent ?? '';
const last = () => went.at(-1);

describe('the "Done before" fold', () => {
   it('holds old done plans, closed, but never one Decide asks about', async () => {
      const el = await mount();
      const fold = button(el, /^Done before Jul 2026/);
      expect(fold?.textContent).toMatch(/1$/);
      const details = fold?.closest('details');
      expect(details?.open).toBe(false);
      expect(el.querySelector('#roadmap-item-2')?.closest('details')).toBe(details);
      // asked to reopen: in the rows, with its call, not the fold
      const akeneo = el.querySelector('#roadmap-item-3');
      expect(akeneo).toBeTruthy();
      expect(akeneo?.closest('details')).not.toBe(details);
   });

   it('keeps a plan Decide asks about on the initiative lanes too', async () => {
      const el = await mount({ group: 'initiative' });
      expect(text(el)).toContain('Akeneo 4');
      expect(button(el, /^Done before/)).toBeUndefined();
   });

   it('goes while a week picked on the load chart counts none of it', async () => {
      const el = await mount({ week: '2026-10-12' });
      expect(button(el, /^Done before/)).toBeUndefined();
   });
});

describe('the toolbar', () => {
   it('names its window and picks a preset', async () => {
      const el = await mount();
      const trigger = button(el, 'Roadmap window: Q3 2026 to Q2 2027');
      await press(trigger);
      await press(button(el, 'Year to date'));
      expect(last()).toMatchObject({ window: 'ytd' });
      expect(button(el, 'Roadmap window: Year to date')).toBeTruthy();
   });

   it('steps by the window’s own length, and Today comes back', async () => {
      const el = await mount();
      expect(button(el, 'Today')).toBeUndefined();
      await press(button(el, 'Back 12 months'));
      expect(last()).toMatchObject({ window: '2025-Q3..2026-Q2' });
      await press(button(el, 'Back 12 months'));
      expect(last()).toMatchObject({ window: '2024-Q3..2025-Q2' });
      await press(button(el, 'Today'));
      expect(last()).toMatchObject({ window: null });
   });

   it('shows Today on a preset only while today is outside it', async () => {
      expect(button(await mount({ window: 'quarter' }), 'Today')).toBeUndefined();
      act(() => root?.unmount());
      const el = await mount({ window: 'quarter' });
      await press(button(el, 'On 3 months'));
      expect(button(el, 'Today')).toBeTruthy();
   });

   it('keeps the window on the lit switch, converts it on the other, and brings it back from now, next, later', async () => {
      const el = await mount({ window: '12m' });
      const option = (name: string) =>
         [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
            b => b.textContent === name
         );
      expect(option('Months')?.getAttribute('aria-checked')).toBe('true');
      await press(option('Months'));
      expect(went.every(to => to.window !== null)).toBe(true);
      await press(option('Quarters'));
      expect(last()).toMatchObject({ scale: 'quarter', window: '2025-Q4..2026-Q4' });
      await press(option('Months'));
      expect(last()).toMatchObject({ scale: 'month', window: '2025-10..2026-12' });
      await press(option('Now, next, later'));
      expect(last()).toMatchObject({ scale: 'now' });
      expect(last()?.window).toBeUndefined();
      await press(option('Months'));
      expect(last()).toMatchObject({ scale: 'month', window: '2025-10..2026-12' });
   });

   it('asks for no history before a window wholly ahead', async () => {
      await mount({ window: '2027-02..2027-05' });
      const inverted = asked
         .filter(p => p.startsWith('/projects-data'))
         .map(p => new URLSearchParams(p.split('?')[1]))
         .filter(q => (q.get('start') ?? '') > (q.get('end') ?? ''));
      expect(inverted).toEqual([]);
   });
});

describe('the edge chip', () => {
   it('moves the window to start at its plan', async () => {
      const el = await mount();
      await press(buttons(el).find(b => b.title.startsWith('Planned Nov 3, 2025 to')));
      expect(last()).toMatchObject({ window: '2025-Q4..2026-Q3' });
   });
});

const visible = (el: Element | null | undefined) => !!el && !el.closest('details:not([open])');

describe('a plan just saved', () => {
   it('moved out of the window keeps its receipt and Undo in view', async () => {
      const el = await mount();
      const bar = el.querySelector<HTMLElement>('#roadmap-bar-5');
      expect(visible(bar)).toBe(true);
      act(() => {
         bar?.focus();
         bar?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      });
      await settle();
      await settle();
      expect(text(el)).toContain('Moved Edge done 1 week earlier');
      expect(visible(buttons(el).find(b => b.textContent === 'Undo'))).toBe(true);
   });

   it('marked done from its open details on the initiative lanes keeps its row and receipt', async () => {
      const el = await mount({ group: 'initiative', item: 6 });
      expect(el.querySelector('#roadmap-item-6')).toBeTruthy();
      await press(button(el, 'Edit details'));
      const done = [
         ...el.querySelectorAll<HTMLElement>(
            '#roadmap-item-6 [role="radio"], #roadmap-item-6 button'
         ),
      ].find(b => b.textContent === 'Done');
      await press(done);
      await press(button(el, /^Save/));
      await settle();
      expect(text(el)).toContain('Marked Loose work done');
      expect(el.querySelector('#roadmap-item-6')).toBeTruthy();
   });
});

describe('the load chart', () => {
   it('counts a picked week only while it draws it, so the headline and the chip agree', async () => {
      const el = await mount({ week: '2026-09-14', window: '2027-Q3..2028-Q2' });
      // a window stepped away from the pick: no pick at all
      expect(text(el)).not.toContain('Week of Sep 14');
      expect(buttons(el).some(b => b.getAttribute('aria-pressed') === 'true')).toBe(false);
   });

   it('says where PR history starts on a window longer than the server keeps', async () => {
      const el = await mount({ window: '2022-Q1..2026-Q4' });
      const ask = asked.find(a => a.startsWith('/projects-data'));
      expect(ask).toContain('start=2025-');
      expect(text(el)).toContain('PR history from');
   });
});

describe('the lane glosses', () => {
   it('count the rows they head, not the done plans folded under them', async () => {
      const el = await mount();
      const label = text(el).match(/On the roadmap · (\d+) plans?/)?.[1];
      const gloss = text(el).match(/(\d+) plans? in priority order: what matters most/)?.[1];
      expect(gloss).toBe(label);
   });
});
