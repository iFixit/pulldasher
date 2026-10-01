import { useEffect } from 'react';
import { isDummy } from '../backend/dummy';
import { DUMMY_ROADMAP, DUMMY_ROADMAP_UPDATES } from '../backend/dummyProjects';
import { createMemoryStore } from '../storage';
import {
   checkRoadmapFields,
   mondayOf,
   checkRoadmapUpdate,
   waitsOnProblem,
   type RoadmapFields,
   type RoadmapHealth,
   type RoadmapItem,
   type RoadmapUpdate,
} from '../../../shared/model/roadmap';
import { utcDay } from '../../../shared/model/projects';

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

const byPriority = (items: RoadmapItem[]) =>
   [...items].sort((a, b) => a.priority - b.priority || a.id - b.id);

type Reply = { status: number; json: Record<string, unknown> };

interface Api {
   list: () => Promise<Reply>;
   create: (fields: Partial<RoadmapFields>) => Promise<Reply>;
   /** `restate`: a status sent as it already was is a call made again */
   update: (id: number, fields: Partial<RoadmapFields>, restate?: boolean) => Promise<Reply>;
   remove: (id: number) => Promise<Reply>;
   reorder: (ids: number[]) => Promise<Reply>;
   updates: (id: number) => Promise<Reply>;
   postUpdate: (id: number, fields: UpdateFields) => Promise<Reply>;
}

type UpdateFields = { health: RoadmapHealth; body: string };

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
      update: (id, fields, restate) =>
         send('PATCH', `/roadmap/${id}`, restate ? { ...fields, restate } : fields),
      remove: id => send('DELETE', `/roadmap/${id}`),
      reorder: ids => send('PUT', '/roadmap/order', { ids }),
      updates: id => send('GET', `/roadmap/${id}/updates`),
      postUpdate: (id, fields) => send('POST', `/roadmap/${id}/updates`, fields),
   };
}

/** The dummy board's stand-in for the server: the same checks, a table in
 * memory, gone on reload. */
function dummyApi(): Api {
   let rows = DUMMY_ROADMAP.map(item => ({ ...item }));
   let nextId = Math.max(0, ...rows.map(r => r.id)) + 1;
   let updates = DUMMY_ROADMAP_UPDATES.map(u => ({ ...u }));
   const ok = (json: Record<string, unknown>, status = 200) => Promise.resolve({ status, json });
   const bad = (error: string, status = 400) => ok({ error }, status);
   // stamped at each write, the way the server does: the Decide queue
   // compares it with PR activity and updates
   const touch = () => ({
      updated_by: 'danielbeardsley',
      updated_at: Math.floor(Date.now() / 1000),
   });
   return {
      list: () => ok({ items: byPriority(rows) }),
      create: fields => {
         const checked = checkRoadmapFields(fields, { partial: false });
         if ('error' in checked) return bad(checked.error);
         const f = checked.fields;
         const loop = f.waits_on && waitsOnProblem(null, f.waits_on, rows);
         if (loop) return bad(loop);
         const item: RoadmapItem = {
            id: nextId++,
            name: f.name ?? '',
            project: f.project ?? null,
            team: f.team ?? null,
            lead: f.lead ?? null,
            status: f.status ?? 'planned',
            origin: f.origin ?? null,
            start: f.start ?? mondayOf(utcDay(Date.now() / 1000)),
            weeks: f.weeks ?? 4,
            notes: f.notes ?? '',
            waits_on: f.waits_on ?? [],
            priority: Math.max(-1, ...rows.map(r => r.priority)) + 1,
            ...touch(),
            created_at: Math.floor(Date.now() / 1000),
            status_at: Math.floor(Date.now() / 1000),
            update: null,
         };
         rows.push(item);
         return ok({ item }, 201);
      },
      update: (id, fields, restate) => {
         const checked = checkRoadmapFields(fields, { partial: true });
         if ('error' in checked) return bad(checked.error);
         const loop = checked.fields.waits_on && waitsOnProblem(id, checked.fields.waits_on, rows);
         if (loop) return bad(loop);
         const row = rows.find(r => r.id === id);
         if (!row) return bad('no such roadmap item', 404);
         // when it stopped is when its status changed (or a call restated
         // it), not its last edit
         const moved =
            checked.fields.status != null && (checked.fields.status !== row.status || !!restate);
         Object.assign(row, checked.fields, touch());
         if (moved) row.status_at = row.updated_at;
         return ok({ item: { ...row } });
      },
      remove: id => {
         const before = rows.length;
         rows = rows
            .filter(r => r.id !== id)
            .map(r => ({ ...r, waits_on: r.waits_on.filter(other => other !== id) }));
         updates = updates.filter(u => u.item_id !== id);
         return rows.length < before ? ok({ ok: true }) : bad('no such roadmap item', 404);
      },
      updates: id => ok({ updates: updates.filter(u => u.item_id === id).reverse() }),
      postUpdate: (id, fields) => {
         const checked = checkRoadmapUpdate(fields);
         if ('error' in checked) return bad(checked.error);
         const row = rows.find(r => r.id === id);
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
      reorder: ids => {
         ids.forEach((id, i) => {
            const row = rows.find(r => r.id === id);
            if (row) row.priority = i;
         });
         return ok({ items: byPriority(rows) });
      },
   };
}

const api = isDummy() ? dummyApi() : liveApi();

function problemOf(reply: Reply, doing: string): string {
   if (reply.status === 401) return 'Your sign-in expired. Reload the page to sign in again.';
   const error = typeof reply.json.error === 'string' ? reply.json.error : null;
   return error ? `Couldn’t ${doing}: ${error}.` : `Couldn’t ${doing}. Try again in a minute.`;
}

// Counts writes, so a load that went out before one and answers after it
// can't put the old plan back on screen; the next load brings the new one.
let writes = 0;

export async function loadRoadmap(): Promise<void> {
   const seen = writes;
   try {
      const reply = await api.list();
      if (reply.status !== 200) throw new Error(String(reply.status));
      if (seen !== writes) return;
      store.set({ ...store.get(), items: reply.json.items as RoadmapItem[], loadFailed: false });
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

/** Add an item at the bottom. Resolves to it, or null when the server said no. */
export async function createRoadmapItem(
   fields: Partial<RoadmapFields>
): Promise<RoadmapItem | null> {
   writes++;
   const reply = await api.create(fields).catch((): Reply => ({ status: 0, json: {} }));
   // nothing was shown early, so there's nothing to take back
   if (!settle(reply, 'add the plan', () => undefined)) return null;
   const item = reply.json.item as RoadmapItem;
   // a load that already had it mustn't make it show twice
   const others = (store.get().items ?? []).filter(i => i.id !== item.id);
   store.set({ ...store.get(), items: byPriority([...others, item]) });
   return item;
}

export async function updateRoadmapItem(
   id: number,
   fields: Partial<RoadmapFields>,
   { restate = false }: { restate?: boolean } = {}
): Promise<boolean> {
   // stamped now, as the server will: a decision shows as made right away
   const now = Math.floor(Date.now() / 1000);
   const undo = optimistic(items =>
      items.map(i =>
         i.id === id
            ? {
                 ...i,
                 ...fields,
                 updated_at: now,
                 ...(fields.status && (fields.status !== i.status || restate)
                    ? { status_at: now }
                    : {}),
              }
            : i
      )
   );
   const reply = await api
      .update(id, fields, restate)
      .catch((): Reply => ({ status: 0, json: {} }));
   if (!settle(reply, 'save the plan', undo)) return false;
   const saved = reply.json.item as RoadmapItem;
   store.set({
      ...store.get(),
      items: (store.get().items ?? []).map(i => (i.id === id ? saved : i)),
   });
   return true;
}

export async function removeRoadmapItem(id: number): Promise<boolean> {
   // the server takes it off what other items wait on; so does the screen
   const undo = optimistic(items =>
      items
         .filter(i => i.id !== id)
         .map(i =>
            i.waits_on.includes(id) ? { ...i, waits_on: i.waits_on.filter(x => x !== id) } : i
         )
   );
   const reply = await api.remove(id).catch((): Reply => ({ status: 0, json: {} }));
   return settle(reply, 'remove the plan', undo);
}

/** Put the items in this order, top first. If someone else changed the
 * roadmap meanwhile, the server's list wins and the person hears why. */
export async function reorderRoadmap(ids: number[]): Promise<void> {
   const undo = optimistic(items =>
      byPriority(items.map(i => ({ ...i, priority: ids.indexOf(i.id) })))
   );
   const reply = await api.reorder(ids).catch((): Reply => ({ status: 0, json: {} }));
   if (reply.status === 409) {
      store.set({
         ...store.get(),
         items: reply.json.items as RoadmapItem[],
         problem:
            'Someone else just added or removed a plan, so your new order wasn’t saved. This is the order now; try again.',
      });
      return;
   }
   if (settle(reply, 'save the new order', undo)) {
      store.set({ ...store.get(), items: reply.json.items as RoadmapItem[] });
   }
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
