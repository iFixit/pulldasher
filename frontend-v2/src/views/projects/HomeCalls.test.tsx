// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DecideRow } from '../../../../shared/model/decide';
import type { Initiative } from '../../../../shared/model/initiatives';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { loadInitiatives } from '../../model/initiativesData';
import type { PortfolioItem } from '../../model/portfolio';
import { HomeLine, InitiativePage } from './Initiatives';
import { clearHomePicks, InitiativeSwitch } from './HomeCalls';
import { NO_PROJECT, UNSORTED } from '../../model/initiativeBoard';
import { PROJECT_SLUG } from '../../../../shared/model/roadmap';
import type { ProjectsNav } from './parts';
import { DecideCall, DecideRowView, keepCalls, SectionCalls, type Made } from './Decide';
import { AllItemsContext, answerWords, callWords } from '../../model/decideCalls';

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
   initiative(4, 'onboarding', 'Onboarding', ['emails'], {
      goal: 'New customers get a welcome series',
   }),
   initiative(5, 'fragile', 'Fragile', []),
   // Not tracked under a slug of its own: the board finds it by its kind
   initiative(9, 'shelf', 'Not tracked', ['ops'], { kind: 'untracked' }),
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

/** An active plan with no project. */
const unlinked: RoadmapItem = { ...created, id: 5, name: 'Checkout redesign', project: null };

/** The server, by route: each write answers as the real one would. */
const calls: { method: string; path: string; body: unknown }[] = [];
let flakyFailed = false;
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
            // someone filed it elsewhere since the board last looked
            if (body.project === 'raced')
               return reply(
                  {
                     error: 'its home changed; here it is now',
                     home: { initiative: 'fixbot', set_at: 60, baseline_prs: 0 },
                  },
                  409
               );
            const before =
               body.project === 'ops'
                  ? { initiative: 'shelf', set_at: 50, baseline_prs: 2 }
                  : body.project === 'filed'
                  ? { initiative: 'site-speed', set_at: 50, baseline_prs: 0 }
                  : { initiative: null, set_at: null, baseline_prs: 0 };
            return reply({ project: body.project, before, home: null });
         }
         if (path.startsWith('/initiatives/')) {
            const id = Number(path.split('/')[2]);
            // a database gone between a save and its Undo
            if (id === 5 && body.undo) return reply({ error: 'the database is down' }, 500);
            const was = INITIATIVES.find(i => i.id === id) ?? INITIATIVES[3];
            return reply({ initiative: { ...was, ...body } });
         }
         if (path === '/roadmap' && method === 'POST') {
            // a plan that fails once, after its filing saved
            if (body.project === 'flaky' && !flakyFailed) {
               flakyFailed = true;
               return reply({ error: 'the database is down' }, 500);
            }
            return reply({ item: created }, 201);
         }
         if (path === '/roadmap' && method === 'GET') return reply({ items: [] });
         if (path.startsWith('/roadmap/') && method === 'DELETE') return reply({ ok: true });
         if (path.startsWith('/roadmap/') && method === 'PATCH')
            return reply({ item: { ...unlinked, ...body } });
         return reply({}, 404);
      })
   );
   await loadInitiatives();
});

let host: HTMLDivElement | null = null;
// every tree a test mounts, unmounted after it, so none listens on to the
// stores the next test writes
const roots: Root[] = [];
afterEach(() => {
   act(() => roots.splice(0).forEach(r => r.unmount()));
   clearHomePicks();
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
   person('flaky', ['erin']),
   // nobody it shares people with: no guess
   person('lonely', ['zed']),
   person('bulk-a', ['erin']),
   person('bulk-b', ['dana']),
   person('ops', ['dana']),
];

function render(row: DecideRow): HTMLDivElement {
   return mount(<DecideCall row={row} />);
}

function mount(node: React.ReactNode): HTMLDivElement {
   host = document.createElement('div');
   document.body.append(host);
   const root = createRoot(host);
   roots.push(root);
   act(() => root.render(<AllItemsContext.Provider value={ITEMS}>{node}</AllItemsContext.Provider>));
   return host;
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')].map(b => b.textContent);
const click = (el: HTMLElement, words: string) =>
   act(() =>
      [...el.querySelectorAll('button')].find(b => b.textContent?.startsWith(words))?.click()
   );
/** a callback the test doesn't watch */
const nothing = () => undefined;
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
      // the button clicked stays where it was; the others come after it
      expect(buttons(el)).toEqual([
         'Close as doneSuggested',
         'Other answers',
         'Close as dropped',
         'Keep open',
      ]);
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
      expect(buttons(el)).toEqual(['Reopen CatalogSuggested', 'File elsewhere']);
      click(el, 'File elsewhere');
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
         initiative: 'shelf',
         expect: 'shelf',
      });
      // Undo brings back its count as it stood, so the row comes back
      click(el, 'Undo');
      await settle();
      expect(calls.filter(c => c.path === '/initiatives/file').at(-1)?.body).toEqual({
         project: 'ops',
         initiative: 'shelf',
         set_at: 50,
         baseline_prs: 2,
      });
   });

   it('opens the chooser under Track it, with the focus and its own File button', () => {
      const el = render(grew);
      const [keep, track] = [...el.querySelectorAll('button')];
      click(el, 'Track it');
      // nothing that files took Track it's place: the same two buttons lead
      expect([...el.querySelectorAll('button')].slice(0, 2)).toEqual([keep, track]);
      expect(track.getAttribute('aria-expanded')).toBe('true');
      const select = el.querySelector('select') as HTMLSelectElement;
      expect(document.activeElement).toBe(select);
      // its File button sits on the chooser's line, out of the toolbar
      const file = [...el.querySelectorAll('button')].find(b => b.textContent?.startsWith('File in'));
      expect(file?.closest('[role="toolbar"]')).toBeNull();
      // the guess's hover says where the project is now, never Unsorted
      const guessed = [...el.querySelectorAll('span')].find(x => x.textContent === 'guessed');
      expect(guessed?.title).toBe(
         'It’s Not tracked now. This is the initiative its people work in most.'
      );
   });
});

describe('the Initiative chooser on a row Decide asks to plan', () => {
   const fresh = (slug: string): DecideRow => ({
      slug,
      item: null,
      reasons: [{ kind: 'new', since: '2026-09-10' }],
   });
   const select = (el: HTMLElement) =>
      el.querySelector<HTMLSelectElement>('select[aria-label^="File it in"]');

   it('isn’t shown for a filed project, so its answer stays a plan answer and moves nothing', async () => {
      const el = render(fresh('filed'));
      // filed in Site speed already: nothing asks to file it
      expect(select(el)).toBeNull();
      expect(el.textContent).not.toContain('File it in');
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
   it('keeps the filing when the plan fails, says so, and Try again only plans', async () => {
      const el = render(fresh('flaky'));
      click(el, 'Promise to finish by');
      await settle();
      expect(calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`)).toEqual([
         'PUT /initiatives/file',
         'POST /roadmap',
      ]);
      expect(el.textContent).toContain('Filed in FixBot chat; the plan didn’t save.');
      calls.length = 0;
      click(el, 'Try again');
      await settle();
      // its expect would be stale now: the filing isn't sent twice
      expect(calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`)).toEqual([
         'POST /roadmap',
      ]);
      expect(el.textContent).toMatch(/Promised to finish by .+, in FixBot chat\./);
   });
});

describe('a section’s one click on rows with a File it in chooser', () => {
   const fresh = (slug: string): DecideRow => ({
      slug,
      item: null,
      reasons: [{ kind: 'new', since: '2026-09-10' }],
   });
   // its own rows: a call made here stays made for the tests after
   const rows = [fresh('bulk-a'), fresh('lonely'), fresh('bulk-b')];

   it('files each where its chooser says and skips one whose chooser is empty', async () => {
      const el = mount(
         <SectionCalls title="Needs a plan" rows={rows} owed={rows} projectOf={() => undefined} main />
      );
      // lonely has no guess, so its own answer is off: the section leaves it,
      // and says "2", not "all 2"
      const all = [...el.querySelectorAll('button')].find(b => b.textContent?.startsWith('Promise'));
      expect(all?.textContent).toMatch(/^Promise 2 /);
      act(() => all?.click());
      await settle();
      await settle();
      // each guessed home rides along with its plan, as its own answer would
      expect(
         calls.filter(c => c.method !== 'GET').map(c => [c.path, (c.body as { project: string }).project])
      ).toEqual([
         ['/initiatives/file', 'bulk-a'],
         ['/roadmap', 'bulk-a'],
         ['/initiatives/file', 'bulk-b'],
         ['/roadmap', 'bulk-b'],
      ]);
      expect(calls.find(c => c.path === '/initiatives/file')?.body).toEqual({
         project: 'bulk-a',
         initiative: 'fixbot',
         expect: null,
      });
      // the board's homes as the server has them, for the tests after
      await act(() => loadInitiatives());
   });
});

describe('the words for where a project belongs', () => {
   const row: DecideRow = { slug: 'x', item: null, reasons: [{ kind: 'unfiled' }] };
   it('say what each answer does', () => {
      expect(answerWords({ kind: 'file', to: 'fixbot', name: 'FixBot chat' }, null)).toBe(
         'File in FixBot chat'
      );
      // by the home's kind, never its slug: any Not tracked initiative
      expect(
         answerWords({ kind: 'file', to: 'shelf', name: 'Shelf', untracked: true }, null)
      ).toBe('Set not tracked');
      expect(answerWords({ kind: 'link', project: 'pp', name: 'Parts pages' }, null)).toBe(
         'Link to Parts pages'
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

describe('the File it in chooser and the answer that waits on it', () => {
   const unfiled = (slug: string): DecideRow => ({ slug, item: null, reasons: [{ kind: 'unfiled' }] });
   const order = (el: HTMLElement) =>
      [...el.querySelectorAll('select, button')].map(n => n.tagName.toLowerCase());

   it('sits above the buttons it brings to life, which wait while nothing is picked', () => {
      // nobody it shares work with is filed anywhere: no guess
      const el = render(unfiled('loner'));
      expect(order(el)[0]).toBe('select');
      const file = [...el.querySelectorAll('button')].find(b => b.textContent === 'File it');
      expect(file?.disabled).toBe(true);
   });

   it('says Suggested only for the board’s own guess, never for a person’s pick', () => {
      const el = render(unfiled('new-thing'));
      expect(buttons(el)).toEqual(['File in FixBot chatSuggested']);
      const select = el.querySelector('select') as HTMLSelectElement;
      act(() => {
         select.value = 'site-speed';
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(buttons(el)).toEqual(['File in Site speed']);
   });

   it('holds a plan answer the same way while its chooser is empty', () => {
      const el = render({ slug: 'loner', item: null, reasons: [{ kind: 'new', since: '2026-09-10' }] });
      expect(order(el)[0]).toBe('select');
      const promise = [...el.querySelectorAll('button')].find(b =>
         b.textContent?.startsWith('Promise to finish by')
      );
      expect(promise?.disabled).toBe(true);
      expect(promise?.textContent).not.toContain('Suggested');
   });

   it('says the filing in the plan answer’s label', () => {
      const el = render({ slug: 'new-thing', item: null, reasons: [{ kind: 'new', since: '2026-09-10' }] });
      const promise = [...el.querySelectorAll('button')].find(b =>
         b.textContent?.startsWith('Promise to finish by')
      );
      expect(promise?.getAttribute('aria-label')).toMatch(/, in FixBot chat$/);
   });

   it('names where a project went when someone filed it first', async () => {
      const el = render(unfiled('raced'));
      const select = el.querySelector('select') as HTMLSelectElement;
      act(() => {
         select.value = 'site-speed';
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      click(el, 'File in Site speed');
      await settle();
      expect(el.textContent).toContain('Someone filed it in FixBot chat since, so nothing changed.');
      // and the board reads the homes again
      expect(calls.filter(c => c.path === '/initiatives' && c.method === 'GET')).toHaveLength(1);
   });
});

describe('a plan with no project', () => {
   const row: DecideRow = { slug: null, item: unlinked, reasons: [{ kind: 'no_project' }] };

   it('asks for its project, then links it, and Undo unlinks it', async () => {
      const el = render(row);
      expect(buttons(el)).toEqual(['Link it']);
      const select = el.querySelector('select') as HTMLSelectElement;
      act(() => {
         select.value = 'cache';
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      click(el, 'Link to cache');
      await settle();
      expect(calls.at(-1)).toMatchObject({
         method: 'PATCH',
         path: '/roadmap/5',
         body: { project: 'cache' },
      });
      expect(el.textContent).toContain('Linked to cache');
      click(el, 'Undo');
      await settle();
      expect(calls.at(-1)).toMatchObject({
         method: 'PATCH',
         path: '/roadmap/5',
         body: { project: null, undo: { updated_at: 1, status_at: null } },
      });
   });
});

describe('a project whose closed initiative and done plan are both asked about', () => {
   const both: DecideRow = {
      slug: 'akeneo',
      item: { ...created, id: 8, project: 'akeneo', status: 'done', status_at: 10 },
      reasons: [
         { kind: 'reopened', open: 3, late: 0, as: 'done', by: 'roadmap' },
         { kind: 'reopened_in_closed', initiative: 3, as: 'done' },
      ],
   };

   it('asks about the initiative first, on the one row', () => {
      const el = render(both);
      expect(buttons(el)).toEqual(['Reopen CatalogSuggested', 'File elsewhere']);
   });

   it('keeps the reopen’s receipt here, and the plan question owed everywhere else', () => {
      const made = new Map<string, Made>([
         [
            'akeneo:8',
            { row: both, call: { kind: 'reopen' }, words: '', state: 'made', origin: null, token: 1 },
         ],
      ]);
      const plan: DecideRow = { ...both, reasons: [both.reasons[0]] };
      const kept = keepCalls([plan], made);
      // still owed, so the Roadmap and the Overview keep the project in
      // sight; shown once, as the row with its receipt
      expect(kept.owed).toEqual([plan]);
      expect(kept.settled.has('akeneo:8')).toBe(true);
      expect(kept.all).toEqual([both]);
   });
});

describe('Decide’s Initiative switch', () => {
   it('offers a closed initiative while a project in it is asked about', () => {
      const owed: Record<string, number> = { catalog: 1, 'site-speed': 2 };
      const el = mount(
         <InitiativeSwitch
            initiatives={INITIATIVES}
            owedIn={slug => owed[slug] ?? 0}
            value={null}
            onChange={nothing}
         />
      );
      expect([...el.querySelectorAll('option')].map(o => o.textContent)).toEqual([
         'All initiatives',
         'Site speed · 2',
         'Catalog · 1',
      ]);
   });

   it('counts plans with no project apart from Unsorted, under keys no slug can take', () => {
      const owed: Record<string, number> = { [UNSORTED]: 3, [NO_PROJECT]: 1 };
      const el = mount(
         <InitiativeSwitch
            initiatives={INITIATIVES}
            owedIn={slug => owed[slug] ?? 0}
            value={null}
            onChange={nothing}
         />
      );
      const options = [...el.querySelectorAll('option')];
      expect(options.map(o => o.textContent)).toEqual([
         'All initiatives',
         'Unsorted · 3',
         'No project yet · 1',
      ]);
      // an initiative may be called "unsorted"; these keys can't be its slug
      for (const o of options.slice(1)) expect(PROJECT_SLUG.test(o.value)).toBe(false);
   });
});

describe('an initiative’s page', () => {
   const page = (slug: string, calls: DecideRow[] = [], items = ITEMS, plans: RoadmapItem[] = []) =>
      mount(
         <InitiativePage
            slug={slug}
            initiatives={INITIATIVES}
            items={items}
            plans={plans}
            calls={calls}
            nav={{} as ProjectsNav}
            navigate={nothing}
            onPerson={nothing}
         />
      );

   it('asks a closed one’s reopen at its head, and keeps live work out of Done', () => {
      const done = { ...created, id: 8, project: 'akeneo', status: 'done' as const };
      const asked: DecideRow = {
         slug: 'akeneo',
         item: done,
         reasons: [{ kind: 'reopened_in_closed', initiative: 3, as: 'done' }],
      };
      const akeneo = { ...person('akeneo', ['erin']), name: 'Akeneo 4', open: 3 } as PortfolioItem;
      const el = page('catalog', [asked], [...ITEMS, akeneo], [done]);
      expect(el.textContent).toContain('Akeneo 4: Catalog was closed as done');
      expect(buttons(el)).toContain('Reopen CatalogSuggested');
      // its PRs are open: it's still going, so not folded under Done or dropped
      expect(el.textContent).not.toContain('Done or dropped');
      expect(el.textContent).toMatch(/Health.*1 question on Decide/);
      // closed: its head says how; no estimated end beside the reopen question
      expect(el.textContent).not.toContain('Ends');
   });

   it('says no initiative is at a link that names none, in plain words', () => {
      const el = page('gone');
      expect(el.textContent).toContain('No initiative is at this link.');
      expect(el.textContent).not.toContain('slug');
   });

   it('asks each project’s own question on its row', () => {
      const going = { ...created, id: 9, project: 'cache', status: 'active' as const };
      const asked: DecideRow = { slug: 'cache', item: going, reasons: [{ kind: 'stalled', days: 30 }] };
      const el = page('site-speed', [asked], ITEMS, [going]);
      expect(el.textContent).toContain('Park it for now?');
   });

   it('shows Not tracked as a ledger: no owner, Edit, span or end', () => {
      const el = page('shelf');
      expect(el.querySelector('h2')?.textContent).toBe('Not tracked');
      expect(el.textContent).not.toContain('Not trackedNot tracked');
      expect(buttons(el)).not.toContain('Edit');
      expect(el.textContent).not.toContain('Span');
      expect(el.textContent).not.toContain('Ends');
   });

   it('keeps an edit’s receipt, saying why, when its Undo fails', async () => {
      const el = page('fragile');
      click(el, 'Edit');
      const goal = el.querySelectorAll('input')[1] as HTMLInputElement;
      act(() => {
         Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(goal, 'Holds');
         goal.dispatchEvent(new Event('input', { bubbles: true }));
      });
      click(el, 'Save');
      await settle();
      expect(el.textContent).toContain('Saved its goal.');
      click(el, 'Undo');
      await settle();
      expect(el.textContent).toContain('the database is down');
      expect(buttons(el)).toContain('Close');
   });
});

describe('a project page’s home line', () => {
   it('puts the chooser in place of its home, and File waits for another pick', () => {
      const el = mount(<HomeLine slug="cache" initiatives={INITIATIVES} navigate={nothing} />);
      expect(el.textContent).toContain('in Site speed');
      click(el, 'File elsewhere');
      expect(el.textContent).not.toContain('in Site speed');
      const move = [...el.querySelectorAll('button')].find(b => b.textContent === 'File');
      expect(move?.disabled).toBe(true);
      const select = el.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('site-speed');
      act(() => {
         select.value = '';
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect([...select.options].at(-1)?.textContent).toBe('Unsorted');
      expect(move?.disabled).toBe(false);
   });

   it('offers no File elsewhere while Decide’s question on the page files it', () => {
      const el = mount(
         <HomeLine slug="new-thing" initiatives={INITIATIVES} navigate={nothing} movable={false} />
      );
      expect(el.textContent).toBe('Unsorted');
      expect(el.querySelector('button')).toBeNull();
   });

   it('says the move once, and its Undo in the one Undo form', async () => {
      const said: string[] = [];
      const el = mount(
         <HomeLine
            slug="cache"
            initiatives={INITIATIVES}
            navigate={nothing}
            onSaid={words => said.push(words)}
         />
      );
      click(el, 'File elsewhere');
      const select = el.querySelector('select') as HTMLSelectElement;
      act(() => {
         select.value = 'fixbot';
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      act(() => [...el.querySelectorAll('button')].find(b => b.textContent === 'File')?.click());
      await settle();
      // the receipt names the new home; the home word isn't said beside it
      expect(el.textContent?.match(/FixBot chat/g)).toHaveLength(1);
      expect(el.textContent).toContain('Filed in FixBot chat.');
      click(el, 'Undo');
      await settle();
      expect(said.at(-1)).toBe('Put cache back in Site speed');
      // Undo's words hold the receipt's place with nothing to click; File
      // elsewhere comes back after them, on the line below
      const status = el.querySelector('[role="status"]') as HTMLElement;
      expect(status.textContent).toBe('Put cache back in Site speed.');
      expect(status.querySelector('button')).toBeNull();
      expect(buttons(el)).toEqual(['File elsewhere']);
      expect(document.activeElement?.textContent).toBe('Put cache back in Site speed.');
   });
});

describe('a row asking whether an initiative reached its goal', () => {
   it('shows the goal it asks about', () => {
      const el = mount(
         <DecideRowView
            row={{ slug: null, item: null, reasons: [{ kind: 'goal_reached', initiative: 4 }] }}
            decided={false}
            owner={INITIATIVES[3]}
            project={undefined}
            team={null}
            nav={{} as ProjectsNav}
            navigate={nothing}
         />
      );
      expect(el.textContent).toContain('Goal: New customers get a welcome series');
   });
});

describe('a pick left in a chooser that closed', () => {
   const closedHome: DecideRow = {
      slug: 'akeneo',
      item: null,
      reasons: [{ kind: 'reopened_in_closed', initiative: 3, as: 'done' }],
   };
   const plan: DecideRow = {
      slug: 'akeneo',
      item: { ...created, id: 8, project: 'akeneo', status: 'done', status_at: 10 },
      reasons: [{ kind: 'reopened', open: 3, late: 0, as: 'done', by: 'roadmap' }],
   };
   const pick = (el: HTMLElement, slug: string) =>
      act(() => {
         const select = el.querySelector('select') as HTMLSelectElement;
         select.value = slug;
         select.dispatchEvent(new Event('change', { bubbles: true }));
      });

   it('files nothing with the next answer', async () => {
      // pick FixBot chat in File elsewhere, then close it without filing
      const first = render(closedHome);
      click(first, 'File elsewhere');
      pick(first, 'fixbot');
      click(first, 'File elsewhere');
      // the row that asks about its plan shows no chooser: its answer files nothing
      const el = render(plan);
      expect(el.querySelector('select')).toBeNull();
      click(el, 'Keep it done');
      await settle();
      expect(calls.some(c => c.path === '/initiatives/file')).toBe(false);
   });

   it('closes on Escape, forgets its pick, and gives the focus back', async () => {
      const el = render(closedHome);
      click(el, 'File elsewhere');
      pick(el, 'fixbot');
      const opener = [...el.querySelectorAll('button')].find(
         b => b.textContent === 'File elsewhere'
      ) as HTMLButtonElement;
      act(() => {
         (el.querySelector('select') as HTMLSelectElement).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
         );
      });
      expect(el.querySelector('select')).toBeNull();
      expect(opener.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(opener);
      // opened again, it starts on the guess, not the abandoned pick
      click(el, 'File elsewhere');
      expect((el.querySelector('select') as HTMLSelectElement).value).not.toBe('fixbot');
   });

   it('is forgotten once a filing saves', async () => {
      const grew: DecideRow = {
         slug: 'ops',
         item: null,
         reasons: [{ kind: 'untracked_grew', since: 31, baseline: 2 }],
      };
      const el = render(grew);
      click(el, 'Track it');
      pick(el, 'fixbot');
      click(el, 'File in FixBot chat');
      await settle();
      click(el, 'Undo');
      await settle();
      calls.length = 0;
      // the row asks again, from a fresh chooser: nothing carries the old pick
      click(el, 'Track it');
      expect((el.querySelector('select') as HTMLSelectElement).value).not.toBe('fixbot');
   });
});

describe('Undo on a row', () => {
   const grew: DecideRow = {
      slug: 'ops',
      item: null,
      reasons: [{ kind: 'untracked_grew', since: 31, baseline: 2 }],
   };

   it('holds its words where the receipt was, so a second click there answers nothing', async () => {
      const el = render(grew);
      click(el, 'Keep not tracked');
      await settle();
      const undo = [...el.querySelectorAll('button')].find(
         b => b.textContent === 'Undo'
      ) as HTMLButtonElement;
      act(() => undo.click());
      await settle();
      // the slot says what Undo did, with nothing to click in it, and the
      // answers come back after it
      const slot = el.querySelector('p[data-decide-focus]') as HTMLElement;
      expect(slot.textContent).toBe('Put ops back as it was.');
      expect(slot.querySelector('button')).toBeNull();
      expect(slot.compareDocumentPosition(el.querySelector('button') as Node)).toBe(
         Node.DOCUMENT_POSITION_FOLLOWING
      );
      expect(document.activeElement).toBe(slot);
      // a double-click's second press lands on the old Undo: nothing is sent
      const sent = calls.length;
      act(() => undo.click());
      await settle();
      expect(calls.length).toBe(sent);
      expect(buttons(el)).toEqual(['Keep not trackedSuggested', 'Track it']);
   });
});

describe('a plan linked to a project', () => {
   const row: DecideRow = { slug: null, item: unlinked, reasons: [{ kind: 'no_project' }] };
   it('says where the link put it: in that project’s initiative, or Unsorted and asked', () => {
      const words = (project: string) =>
         callWords({ kind: 'link', project, name: project }, row, undefined, '2026-10-11');
      expect(words('cache')).toBe('Linked to cache, so it’s in Site speed.');
      expect(words('ops')).toBe('Linked to ops, so it’s Not tracked.');
      expect(words('lonely')).toBe('Linked to lonely. It’s Unsorted, so Decide asks where it goes.');
   });

   it('names the Unsorted row it becomes by its project', () => {
      const el = mount(
         <DecideRowView
            row={{ slug: 'lonely', item: unlinked, reasons: [{ kind: 'unfiled' }] }}
            decided={false}
            // a project with no issue is named by its plan elsewhere
            project={{ ...person('lonely', ['zed']), name: 'Checkout redesign' }}
            team={null}
            nav={{} as ProjectsNav}
            navigate={nothing}
         />
      );
      expect(el.querySelector('button')?.textContent).toBe('Lonely');
   });
});
