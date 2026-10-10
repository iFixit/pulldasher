import { useEffect } from 'react';
import { isDummy, loadDummy } from '../backend/dummy';
import { DUMMY_PROJECTS, DUMMY_ROADMAP, DUMMY_ROADMAP_UPDATES } from '../backend/dummyProjects';
import { createMemoryStore } from '../storage';
import {
   checkRoadmapFields,
   inProgress,
   isUnderWay,
   issuePace,
   mondayOf,
   checkRoadmapUpdate,
   moveBefore,
   planLately,
   waitsOnProblem,
   type PlanLately,
   type RoadmapFields,
   type RoadmapHealth,
   type RoadmapItem,
   type RoadmapUpdate,
} from '../../../shared/model/roadmap';
import { buildToday, dayStart, utcDay, type Project } from '../../../shared/model/projects';
import { derive } from '../../../shared/model/status';
import { isBotLogin } from '../../../shared/model/visibility';
import { dummyWorkInputs } from './workData';

/**
 * The roadmap's state on the board: the items (null until the first load),
 * and the last problem saving, in words. Changes show at once and are rolled
 * back if the server says no, so dragging a bar never waits on a round trip.
 * Other people's changes arrive on the next load: every minute while the
 * roadmap is open, and whenever the window regains focus.
 */
interface RoadmapState {
   items: RoadmapItem[] | null;
   loadFailed: boolean;
   problem: string | null;
}

const store = createMemoryStore<RoadmapState>({ items: null, loadFailed: false, problem: null });

/** Items in the roadmap's order: by priority, the older first on a tie. */
export const byPriority = (items: readonly RoadmapItem[]) =>
   [...items].sort((a, b) => a.priority - b.priority || a.id - b.id);

/**
 * A plan as the board shows it: one still marked planned whose PRs moved
 * after its start is in progress by the numbers (shared/model/roadmap.ts
 * inProgress), so every view says so and nobody has to flip it. What's
 * stored stays as it was, so no one's name goes on a change they didn't make.
 */
const shown = (item: RoadmapItem): RoadmapItem & { marked?: RoadmapItem['status'] } =>
   item.status === 'planned' && inProgress(item)
      ? // `marked` keeps what it was saved as, for Decide's weekly list
        { ...item, status: 'active', marked: 'planned' }
      : item;

/** The status a plan was saved with: what Undo writes back, not the
 * In progress that `shown` read off its PRs. */
export const storedStatus = (item: RoadmapItem): RoadmapItem['status'] =>
   (item as { marked?: RoadmapItem['status'] }).marked ?? item.status;

type Reply = { status: number; json: Record<string, unknown> };

interface Api {
   list: () => Promise<Reply>;
   create: (fields: Partial<RoadmapFields>) => Promise<Reply>;
   /** `restate`: a status sent as it already was is a call made again */
   update: (
      id: number,
      fields: Partial<RoadmapFields>,
      restate?: boolean,
      undo?: UndoTimes
   ) => Promise<Reply>;
   remove: (id: number) => Promise<Reply>;
   /** a removed item back as it was: Remove's Undo */
   restore: (id: number) => Promise<Reply>;
   reorder: (ids: number[]) => Promise<Reply>;
   updates: (id: number) => Promise<Reply>;
   postUpdate: (id: number, fields: UpdateFields) => Promise<Reply>;
   /** an update its author just posted, taken back */
   removeUpdate: (id: number, updateId: number) => Promise<Reply>;
}

type UpdateFields = { health: RoadmapHealth; body: string };

/** The times an Undo puts back with the fields, so the plan reads as if the
 * call it takes back never happened (stamped now, that call would count as
 * answered after a reload). */
export interface UndoTimes {
   updated_at: number;
   status_at: number | null;
}

function liveApi(): Api {
   const send = async (method: string, path: string, body?: unknown): Promise<Reply> => {
      const res = await fetch(path, {
         method,
         headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
         body: body === undefined ? undefined : JSON.stringify(body),
      });
      // a dead session redirects toward GitHub's sign-in page, which isn't JSON
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.redirected ? 401 : res.status, json };
   };
   return {
      list: () => send('GET', '/roadmap'),
      create: fields => send('POST', '/roadmap', fields),
      update: (id, fields, restate, undo) =>
         send('PATCH', `/roadmap/${id}`, {
            ...fields,
            ...(restate ? { restate } : {}),
            ...(undo ? { undo } : {}),
         }),
      remove: id => send('DELETE', `/roadmap/${id}`),
      restore: id => send('PATCH', `/roadmap/${id}`, { restore: true }),
      reorder: ids => send('PUT', '/roadmap/order', { ids }),
      updates: id => send('GET', `/roadmap/${id}/updates`),
      postUpdate: (id, fields) => send('POST', `/roadmap/${id}/updates`, fields),
      removeUpdate: (id, updateId) => send('DELETE', `/roadmap/${id}/updates/${updateId}`),
   };
}

/** GitHub's Priority field's options, most urgent first, as the server ranks
 * them (lib/roadmap.js) */
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const rankOf = (priority: string | null | undefined) =>
   PRIORITIES.indexOf((priority ?? '').toLowerCase());

/**
 * The order of plan ids with plan `id` placed by its project issue's
 * Priority, as the server places a new one (lib/roadmap.js createItem):
 * just above the first plan under way whose own issue says a lower
 * priority. Left where it is when its issue says none, or none is lower.
 */
export function placedByPriority(
   order: readonly RoadmapItem[],
   id: number,
   projects: readonly Pick<Project, 'slug' | 'fields'>[]
): number[] {
   const priorityOf = (slug: string | null) => projects.find(p => p.slug === slug)?.fields.priority;
   const ids = order.map(i => i.id);
   const rank = rankOf(priorityOf(order.find(i => i.id === id)?.project ?? null));
   const below =
      rank >= 0 &&
      order.find(i => i.id !== id && isUnderWay(i.status) && rankOf(priorityOf(i.project)) > rank);
   return below ? moveBefore(ids, id, below.id) : ids;
}

/**
 * What each project did lately, by slug, as the server sends it with each
 * plan (lib/roadmap.js latelyBySlug, both through shared planLately): from
 * Today, its merges, its open PRs by stage, how many more are open than two
 * weeks ago and how old they are, and its newest activity; and its issues'
 * pace from its attached issues, which work with no end (`ongoing`) goes
 * without.
 */
export function latelyFrom(
   today: Pick<ReturnType<typeof buildToday>, 'live' | 'quiet'>,
   attached: ReadonlyMap<string, readonly Parameters<typeof issuePace>[0][number][]>,
   ongoing: ReadonlySet<string>,
   now: number
): Map<string, PlanLately> {
   const out = new Map<string, PlanLately>();
   for (const g of [...today.live, ...today.quiet]) {
      const issues = attached.get(g.slug);
      const pace = issues && !ongoing.has(g.slug) ? issuePace(issues, now) : null;
      out.set(g.slug, planLately(g, pace, now));
   }
   return out;
}

// the dummy board's facts, kept a minute as the server keeps its own
let dummyFacts: { at: number; bySlug: Map<string, PlanLately> } | null = null;

/** The dummy board's PRs and issues read the way the server reads its own:
 * Today from the fixture's PRs, each in its project by the links too, and
 * the issues from the work model's twin. */
async function dummyLately(plans: readonly RoadmapItem[]): Promise<Map<string, PlanLately>> {
   if (dummyFacts && Date.now() - dummyFacts.at < 60_000) return dummyFacts.bySlug;
   const now = Date.now() / 1000;
   const [{ pulls, bots = [], projectLabelPrefix }, { attached, linked }] = await Promise.all([
      loadDummy(),
      dummyWorkInputs(plans),
   ]);
   const people = pulls.filter(p => !isBotLogin(p.user.login, new Set(bots)));
   const today = buildToday(
      DUMMY_PROJECTS,
      people.filter(p => p.state === 'open').map(p => derive(p, undefined, now)),
      people.filter(p => p.state !== 'open'),
      projectLabelPrefix ?? 'project:',
      now,
      linked
   );
   const ongoing = new Set(DUMMY_PROJECTS.filter(p => p.ongoing).map(p => p.slug));
   dummyFacts = { at: Date.now(), bySlug: latelyFrom(today, attached, ongoing, now) };
   return dummyFacts.bySlug;
}

/** The dummy board's stand-in for the server: the same checks, a table in
 * memory, gone on reload. */
function dummyApi(): Api {
   const rows = DUMMY_ROADMAP.map(item => ({ ...item }));
   let nextId = Math.max(0, ...rows.map(r => r.id)) + 1;
   let updates = DUMMY_ROADMAP_UPDATES.map(u => ({ ...u }));
   // removed plans keep their rows and updates until Undo puts them back,
   // left off what others wait on meanwhile, as on the server
   const removed = new Set<number>();
   const live = () =>
      rows
         .filter(r => !removed.has(r.id))
         .map(r => ({ ...r, waits_on: r.waits_on.filter(other => !removed.has(other)) }));
   const rowOf = (id: number) => rows.find(r => r.id === id && !removed.has(id));
   const ok = (json: Record<string, unknown>, status = 200) => Promise.resolve({ status, json });
   const bad = (error: string, status = 400) => ok({ error }, status);
   // stamped at each write, the way the server does: the Decide queue
   // compares it with PR activity and updates
   const touch = () => ({
      updated_by: 'danielbeardsley',
      updated_at: Math.floor(Date.now() / 1000),
   });
   // copies, as a server's JSON would be: handing out its own rows let a
   // later write change rows the page already held, under React's feet;
   // each with what its project did lately, as the server sends it
   const sent = async (items: readonly RoadmapItem[]) => {
      const bySlug = await dummyLately(live());
      return items.map(r => ({
         ...r,
         waits_on: r.waits_on.filter(other => !removed.has(other)),
         lately: (r.project && bySlug.get(r.project)) || null,
      }));
   };
   return {
      list: async () => ok({ items: await sent(byPriority(live())) }),
      create: async fields => {
         const checked = checkRoadmapFields(fields, { partial: false });
         if ('error' in checked) return bad(checked.error);
         const f = checked.fields;
         const loop = f.waits_on && waitsOnProblem(null, f.waits_on, live());
         if (loop) return bad(loop);
         // its project's issue says when it starts, when nobody did
         const issue = DUMMY_PROJECTS.find(p => p.slug === f.project)?.fields;
         const start =
            issue?.start && dayStart(issue.start) != null ? issue.start : utcDay(Date.now() / 1000);
         const item: RoadmapItem = {
            id: nextId++,
            name: f.name ?? '',
            project: f.project ?? null,
            team: f.team ?? null,
            lead: f.lead ?? null,
            status: f.status ?? 'planned',
            origin: f.origin ?? null,
            start: f.start ?? mondayOf(start),
            weeks: f.weeks ?? 4,
            // an estimate, as on the server, until someone commits
            end_kind: f.end_kind ?? 'soft',
            done_when: f.done_when ?? '',
            notes: f.notes ?? '',
            waits_on: f.waits_on ?? [],
            priority: Math.max(-1, ...rows.map(r => r.priority)) + 1,
            ...touch(),
            created_at: Math.floor(Date.now() / 1000),
            status_at: Math.floor(Date.now() / 1000),
            update: null,
         };
         rows.push(item);
         // and where it goes, by its Priority
         placedByPriority(byPriority(live()), item.id, DUMMY_PROJECTS).forEach((id, i) => {
            const row = rows.find(r => r.id === id);
            if (row) row.priority = i;
         });
         return ok({ item: (await sent([item]))[0] }, 201);
      },
      update: async (id, fields, restate, undo) => {
         const checked = checkRoadmapFields(fields, { partial: true });
         if ('error' in checked) return bad(checked.error);
         const loop =
            checked.fields.waits_on && waitsOnProblem(id, checked.fields.waits_on, live());
         if (loop) return bad(loop);
         const row = rowOf(id);
         if (!row) return bad('no such roadmap item', 404);
         // when it stopped is when its status changed (or a call restated
         // it), not its last edit
         const moved =
            checked.fields.status != null && (checked.fields.status !== row.status || !!restate);
         Object.assign(row, checked.fields, touch());
         if (undo) Object.assign(row, undo);
         else if (moved) row.status_at = row.updated_at;
         return ok({ item: (await sent([row]))[0] });
      },
      remove: id => {
         if (!rowOf(id)) return bad('no such roadmap item', 404);
         removed.add(id);
         return ok({ ok: true });
      },
      restore: async id => {
         const row = rows.find(r => r.id === id);
         if (!row || !removed.delete(id)) return bad('no removed roadmap item by that id', 404);
         return ok({ item: (await sent([row]))[0] });
      },
      updates: id => ok({ updates: updates.filter(u => u.item_id === id).reverse() }),
      postUpdate: (id, fields) => {
         const checked = checkRoadmapUpdate(fields);
         if ('error' in checked) return bad(checked.error);
         const row = rowOf(id);
         if (!row) return bad('no such roadmap item', 404);
         const update: RoadmapUpdate = {
            id: Math.max(0, ...updates.map(u => u.id)) + 1,
            item_id: id,
            ...checked.fields,
            plan_start: row.start,
            plan_weeks: row.weeks,
            author: touch().updated_by,
            at: Math.floor(Date.now() / 1000),
         };
         updates.push(update);
         row.update = update;
         return ok({ update }, 201);
      },
      removeUpdate: (id, updateId) => {
         const gone = updates.find(u => u.id === updateId && u.item_id === id);
         if (!gone) return bad('no such update on that item', 404);
         if (gone.author !== touch().updated_by) {
            return bad('only the person who posted an update can take it back', 403);
         }
         updates = updates.filter(u => u !== gone);
         // kept oldest first, so the item's latest is its last
         const update = updates.filter(u => u.item_id === id).at(-1) ?? null;
         const row = rows.find(r => r.id === id);
         if (row) row.update = update;
         return ok({ update });
      },
      reorder: async ids => {
         ids.forEach((id, i) => {
            const row = rows.find(r => r.id === id);
            if (row) row.priority = i;
         });
         return ok({ items: await sent(byPriority(live())) });
      },
   };
}

/**
 * Failures on demand for the dummy board: `?fail=load` fails the roadmap's
 * loads and `?fail=save` its writes, so a failed load or save can be
 * designed and checked there like any other state.
 */
function failing(inner: Api): Api {
   const fail = new URLSearchParams(window.location.search).get('fail');
   const down = () => Promise.resolve({ status: 503, json: { error: 'the server didn’t answer' } });
   if (fail === 'load') return { ...inner, list: down, updates: down };
   if (fail === 'save')
      return {
         ...inner,
         create: down,
         update: down,
         remove: down,
         restore: down,
         reorder: down,
         postUpdate: down,
         removeUpdate: down,
      };
   return inner;
}

/** The dummy board has no server to say projectsChanged after a write, so
 * its roadmap says it here, and the dummy backend hands it on: parking a
 * project on Decide then reaches the review board, as it would live. */
function announcing(inner: Api): Api {
   const said =
      <A extends unknown[]>(call: (...args: A) => Promise<Reply>) =>
      async (...args: A) => {
         const reply = await call(...args);
         if (reply.status < 300) window.dispatchEvent(new Event('pd:projectsChanged'));
         return reply;
      };
   return {
      ...inner,
      create: said(inner.create),
      update: said(inner.update),
      remove: said(inner.remove),
      reorder: said(inner.reorder),
   };
}

const api = isDummy() ? announcing(failing(dummyApi())) : liveApi();

function problemOf(reply: Reply, doing: string): string {
   if (reply.status === 401) return 'Your sign-in expired. Reload the page to sign in again.';
   const error = typeof reply.json.error === 'string' ? reply.json.error : null;
   return error ? `Couldn’t ${doing}: ${error}.` : `Couldn’t ${doing}. Try again in a minute.`;
}

// Counts writes, so a load that went out before one and answers after it
// can't put the old plan back on screen; the next load brings the new one.
let writes = 0;
// Removals still waiting on the server. A load answered meanwhile may have
// read before the DELETE committed and still list the plan, so it's dropped
// and asked for again once the last removal settles.
let removing = 0;
let droppedWhileRemoving = false;

export async function loadRoadmap(): Promise<void> {
   const seen = writes;
   try {
      const reply = await api.list();
      if (reply.status !== 200) throw new Error(String(reply.status));
      if (seen !== writes) return;
      if (removing > 0) {
         droppedWhileRemoving = true;
         return;
      }
      const items = (reply.json.items as RoadmapItem[]).map(shown);
      store.set({ ...store.get(), items, loadFailed: false });
   } catch {
      if (seen === writes) store.set({ ...store.get(), loadFailed: true });
   }
}

/** Change the items on screen now; hand back a way to put them back. */
function optimistic(change: (items: RoadmapItem[]) => RoadmapItem[]): () => void {
   writes++;
   const before = store.get().items;
   store.set({ ...store.get(), items: change(before ?? []), problem: null });
   return () => store.set({ ...store.get(), items: before });
}

function settle(reply: Reply, doing: string, undo: () => void): boolean {
   if (reply.status >= 200 && reply.status < 300) return true;
   undo();
   store.set({ ...store.get(), problem: problemOf(reply, doing) });
   return false;
}

/** Add an item: at the bottom, or where its project issue's Priority puts it.
 * Resolves to it, or null when the server said no. */
export async function createRoadmapItem(
   fields: Partial<RoadmapFields>
): Promise<RoadmapItem | null> {
   writes++;
   const reply = await api.create(fields).catch((): Reply => ({ status: 0, json: {} }));
   // nothing was shown early, so there's nothing to take back
   if (!settle(reply, 'add the plan', () => undefined)) return null;
   const item = shown(reply.json.item as RoadmapItem);
   const before = store.get().items;
   // never loaded (still loading, or the load failed): a list of just this
   // one would read as the whole roadmap, every other project with no plan,
   // so the full list is fetched instead
   if (before == null) {
      void loadRoadmap();
      return item;
   }
   // a load that already had it mustn't make it show twice
   const others = before.filter(i => i.id !== item.id);
   store.set({ ...store.get(), items: byPriority([...others, item]) });
   // placed above others by its Priority, which moved their places too
   if (others.some(i => i.priority >= item.priority)) void loadRoadmap();
   return item;
}

export async function updateRoadmapItem(
   id: number,
   fields: Partial<RoadmapFields>,
   { restate = false, undo }: { restate?: boolean; undo?: UndoTimes } = {}
): Promise<boolean> {
   // stamped now, as the server will: a decision shows as made right away
   const now = Math.floor(Date.now() / 1000);
   const takeBack = optimistic(items =>
      items.map(i =>
         i.id === id
            ? {
                 ...i,
                 ...fields,
                 updated_at: now,
                 ...(fields.status && (fields.status !== i.status || restate)
                    ? { status_at: now }
                    : {}),
                 ...(undo ?? {}),
              }
            : i
      )
   );
   const reply = await api
      .update(id, fields, restate, undo)
      .catch((): Reply => ({ status: 0, json: {} }));
   if (!settle(reply, 'save the plan', takeBack)) return false;
   const saved = shown(reply.json.item as RoadmapItem);
   store.set({
      ...store.get(),
      items: (store.get().items ?? []).map(i => (i.id === id ? saved : i)),
   });
   return true;
}

/** Take an item off the roadmap. The server keeps it, so restoreRoadmapItem
 * can put it back. */
export async function removeRoadmapItem(id: number): Promise<boolean> {
   // the server leaves it off what other items wait on; so does the screen
   const undo = optimistic(items =>
      items
         .filter(i => i.id !== id)
         .map(i =>
            i.waits_on.includes(id) ? { ...i, waits_on: i.waits_on.filter(x => x !== id) } : i
         )
   );
   removing++;
   const reply = await api.remove(id).catch((): Reply => ({ status: 0, json: {} }));
   removing--;
   const ok = settle(reply, 'remove the plan', undo);
   if (removing === 0 && droppedWhileRemoving) {
      droppedWhileRemoving = false;
      void loadRoadmap();
   }
   return ok;
}

/** Put a removed item back as it was (Remove's Undo): its updates and its
 * place come with it, and what waited on it with the load that follows. */
export async function restoreRoadmapItem(id: number): Promise<boolean> {
   writes++;
   const reply = await api.restore(id).catch((): Reply => ({ status: 0, json: {} }));
   // nothing was shown early, so there's nothing to take back
   if (!settle(reply, 'put the plan back', () => undefined)) return false;
   const item = shown(reply.json.item as RoadmapItem);
   const others = (store.get().items ?? []).filter(i => i.id !== id);
   store.set({ ...store.get(), items: byPriority([...others, item]) });
   void loadRoadmap();
   return true;
}

/** Put the items in this order, top first; resolves to whether it saved. If
 * someone else changed the roadmap meanwhile, the server's list wins and
 * the person hears why. */
export async function reorderRoadmap(ids: number[]): Promise<boolean> {
   const undo = optimistic(items =>
      byPriority(items.map(i => ({ ...i, priority: ids.indexOf(i.id) })))
   );
   const reply = await api.reorder(ids).catch((): Reply => ({ status: 0, json: {} }));
   if (reply.status === 409) {
      store.set({
         ...store.get(),
         items: (reply.json.items as RoadmapItem[]).map(shown),
         problem:
            'Someone else just added or removed a plan, so your new order wasn’t saved. This is the order now; try again.',
      });
      return false;
   }
   if (!settle(reply, 'save the new order', undo)) return false;
   store.set({ ...store.get(), items: (reply.json.items as RoadmapItem[]).map(shown) });
   return true;
}

/** An item's updates, newest first; null when they couldn't be loaded. */
export async function loadRoadmapUpdates(id: number): Promise<RoadmapUpdate[] | null> {
   const reply = await api.updates(id).catch((): Reply => ({ status: 0, json: {} }));
   return reply.status === 200 ? (reply.json.updates as RoadmapUpdate[]) : null;
}

/** Post an update. Once the server has it, the item's latest update changes
 * everywhere the roadmap shows; a refusal comes back in words for the form. */
export async function postRoadmapUpdate(
   id: number,
   fields: UpdateFields
): Promise<{ update: RoadmapUpdate } | { error: string }> {
   writes++;
   const reply = await api.postUpdate(id, fields).catch((): Reply => ({ status: 0, json: {} }));
   if (reply.status !== 201) return { error: problemOf(reply, 'post the update') };
   const update = reply.json.update as RoadmapUpdate;
   store.set({
      ...store.get(),
      items: (store.get().items ?? []).map(i => (i.id === id ? { ...i, update } : i)),
   });
   return { update };
}

/** Take back an update just posted (its Undo): the one before it is the
 * item's latest again everywhere the roadmap shows. A refusal comes back in
 * words. */
export async function takeBackRoadmapUpdate(
   id: number,
   updateId: number
): Promise<{ update: RoadmapUpdate | null } | { error: string }> {
   writes++;
   const reply = await api.removeUpdate(id, updateId).catch((): Reply => ({ status: 0, json: {} }));
   if (reply.status !== 200) return { error: problemOf(reply, 'take the update back') };
   const update = (reply.json.update as RoadmapUpdate | null) ?? null;
   store.set({
      ...store.get(),
      items: (store.get().items ?? []).map(i => (i.id === id ? { ...i, update } : i)),
   });
   return { update };
}

/** The roadmap as the board has it now, outside React. */
export function readRoadmap(): RoadmapState {
   return store.get();
}

export function dismissRoadmapProblem(): void {
   store.set({ ...store.get(), problem: null });
}

// One refresh for however many views show the roadmap: the first to mount
// loads it and starts the timer, the last to unmount stops it.
let watchers = 0;
let timer: number | undefined;
const reload = () => void loadRoadmap();

function watch(): () => void {
   if (watchers++ === 0) {
      void loadRoadmap();
      timer = window.setInterval(reload, 60_000);
      window.addEventListener('focus', reload);
   }
   return () => {
      if (--watchers > 0) return;
      window.clearInterval(timer);
      window.removeEventListener('focus', reload);
   };
}

/** The roadmap, loaded now and kept fresh while any view shows it. */
export function useRoadmap(): RoadmapState {
   useEffect(watch, []);
   return store.useValue();
}
