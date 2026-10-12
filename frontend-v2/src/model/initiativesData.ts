import { useEffect } from 'react';
import { isDummy } from '../backend/dummy';
import { DUMMY_GROWN, DUMMY_INITIATIVES } from '../backend/dummyProjects';
import { createMemoryStore } from '../storage';
import { UNSORTED_WORD } from './words';
import {
   homesOf,
   type Filing,
   type Initiative,
   type InitiativeFields,
} from '../../../shared/model/initiatives';

/**
 * The initiatives on the board (shared/model/initiatives.ts): the layer above
 * projects, each holding projects by slug, in their own rank order. Loaded
 * on first use, like the roadmap, and again whenever the server says the
 * projects changed (Projects.tsx). Changes show at once and are rolled back
 * if the server says no. Null until the first load; an older server with no
 * /initiatives reads as none, so the board shows what it showed before.
 */
interface InitiativesState {
   initiatives: Initiative[] | null;
   loadFailed: boolean;
}

const store = createMemoryStore<InitiativesState>({ initiatives: null, loadFailed: false });

type Reply = { status: number; json: Record<string, unknown> };

/** A project's home as a filing reply says it: the initiative's slug, or
 * null for Unsorted, with when it was set and its growth baseline. */
export interface Home {
   initiative: string | null;
   set_at: number | null;
   baseline_prs: number;
}

interface FileBody {
   project: string;
   initiative: string | null;
   expect?: string | null;
   baseline_prs?: number;
   set_at?: number;
}

interface Api {
   list: () => Promise<Reply>;
   file: (body: FileBody) => Promise<Reply>;
   move: (id: number, before: number | null) => Promise<Reply>;
   update: (
      id: number,
      fields: Partial<InitiativeFields>,
      extra?: { restate?: boolean; undo?: { updated_at: number; status_at: number | null } }
   ) => Promise<Reply>;
}

function liveApi(): Api {
   const send = async (method: string, path: string, body?: unknown): Promise<Reply> => {
      const res = await fetch(path, {
         method,
         headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
         body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.redirected ? 401 : res.status, json };
   };
   return {
      list: () => send('GET', '/initiatives'),
      file: body => send('PUT', '/initiatives/file', body),
      move: (id, before) => send('POST', `/initiatives/${id}/move`, { before }),
      update: (id, fields, extra) => send('PATCH', `/initiatives/${id}`, { ...fields, ...extra }),
   };
}

// the dummy board's table: what the server would hold, gone on reload
const dummy = {
   initiatives: DUMMY_INITIATIVES.map(i => ({ ...i, projects: i.projects.map(f => ({ ...f })) })),
   grown: new Map(Object.entries(DUMMY_GROWN)),
   // the growth a filing ended, which its Undo (a filing with set_at) puts back
   ended: new Map<string, { since: number; baseline: number }>(),
};

/** The dummy board's not-tracked slugs and the ones that grew, as
 * /projects-data sends them (`untracked`, `grew_counts`). */
export function dummyTracking(): {
   untracked: string[];
   grew: Record<string, { since: number; baseline: number }>;
} {
   const untracked = dummy.initiatives
      .filter(i => i.kind === 'untracked')
      .flatMap(i => i.projects.map(f => f.project));
   return { untracked, grew: Object.fromEntries(dummy.grown) };
}

function dummyApi(): Api {
   const ok = (json: Record<string, unknown>) => Promise.resolve({ status: 200, json });
   const bad = (error: string, status = 400) => Promise.resolve({ status, json: { error } });
   const copy = () =>
      [...dummy.initiatives]
         .sort((a, b) => a.priority - b.priority || a.id - b.id)
         .map(i => ({ ...i, projects: i.projects.map(f => ({ ...f })) }));
   const now = () => Math.floor(Date.now() / 1000);
   return {
      list: () => ok({ initiatives: copy() }),
      file: ({ project, initiative, expect, baseline_prs, set_at }) => {
         const homes = homesOf(dummy.initiatives);
         const current = homes.get(project);
         const was: Home = current
            ? {
                 initiative: current.initiative.slug,
                 set_at: current.filing.set_at,
                 baseline_prs: current.filing.baseline_prs,
              }
            : { initiative: null, set_at: null, baseline_prs: 0 };
         if (expect !== undefined && was.initiative !== expect) {
            return Promise.resolve({ status: 409, json: { error: 'its home changed', home: was } });
         }
         const target =
            initiative == null ? null : dummy.initiatives.find(i => i.slug === initiative);
         if (initiative != null && !target) return bad('no initiative has that slug', 404);
         // as the server: nothing into a closed one, but an Undo puts it back
         if (target && target.status !== 'open' && set_at == null) {
            return bad('that initiative is closed; reopen it before filing a project in it', 409);
         }
         if (current) {
            current.initiative.projects = current.initiative.projects.filter(
               f => f.project !== project
            );
         }
         // a filing restarts the growth check, as the server's does, and
         // an Undo's (with set_at) puts back the growth it ended
         const grown = dummy.grown.get(project);
         dummy.grown.delete(project);
         if (grown) dummy.ended.set(project, grown);
         const back = set_at != null ? dummy.ended.get(project) : undefined;
         if (back && target?.kind === 'untracked') dummy.grown.set(project, back);
         if (!target) return ok({ project, before: was, home: null });
         const filing: Filing = {
            project,
            set_by: 'danielbeardsley',
            set_at: set_at ?? now(),
            baseline_prs:
               baseline_prs ??
               (target.kind === 'untracked' ? (grown ? grown.baseline + grown.since : 0) : 0),
         };
         target.projects.push(filing);
         return ok({
            project,
            before: was,
            home: {
               initiative: target.slug,
               set_at: filing.set_at,
               baseline_prs: filing.baseline_prs,
            },
         });
      },
      move: (id, before) => {
         const order = copy().map(i => i.id);
         if (!order.includes(id)) return bad('no such initiative', 404);
         const rest = order.filter(x => x !== id);
         const at = before == null ? rest.length : rest.indexOf(before);
         rest.splice(at < 0 ? rest.length : at, 0, id);
         rest.forEach((x, i) => {
            const row = dummy.initiatives.find(r => r.id === x);
            if (row) row.priority = i;
         });
         return ok({ initiatives: copy() });
      },
      update: (id, fields, extra) => {
         const row = dummy.initiatives.find(i => i.id === id);
         if (!row) return bad('no such initiative', 404);
         const stamp = now();
         const restated =
            fields.status != null && (fields.status !== row.status || !!extra?.restate);
         Object.assign(row, fields, { updated_by: 'danielbeardsley', updated_at: stamp });
         if (extra?.undo) Object.assign(row, extra.undo);
         else if (restated) row.status_at = stamp;
         return ok({ initiative: { ...row, projects: row.projects.map(f => ({ ...f })) } });
      },
   };
}

/** The dummy board says projectsChanged itself after a write, as the server
 * does, so every view's data comes back with the new filing in it. */
function announcing(inner: Api): Api {
   const said =
      <A extends unknown[]>(call: (...args: A) => Promise<Reply>) =>
      async (...args: A) => {
         const reply = await call(...args);
         if (reply.status < 300) window.dispatchEvent(new Event('pd:projectsChanged'));
         return reply;
      };
   return { ...inner, file: said(inner.file), move: said(inner.move), update: said(inner.update) };
}

const api = isDummy() ? announcing(dummyApi()) : liveApi();

function problemOf(reply: Reply, doing: string): string {
   if (reply.status === 401) return 'Your sign-in expired. Reload the page to sign in again.';
   const error = typeof reply.json.error === 'string' ? reply.json.error : null;
   return error ? `Couldn’t ${doing}: ${error}.` : `Couldn’t ${doing}. Try again in a minute.`;
}

// a load that went out before a write and answers after it mustn't put the
// old filings back on screen
let writes = 0;

export async function loadInitiatives(): Promise<void> {
   const seen = writes;
   try {
      const reply = await api.list();
      // a server from before initiatives: none, so nothing changes
      if (reply.status === 404) {
         if (seen === writes) store.set({ initiatives: [], loadFailed: false });
         return;
      }
      if (reply.status !== 200) throw new Error(String(reply.status));
      if (seen !== writes) return;
      store.set({ initiatives: reply.json.initiatives as Initiative[], loadFailed: false });
   } catch {
      if (seen === writes) store.set({ ...store.get(), loadFailed: true });
   }
}

/** Change the initiatives on screen now; hand back a way to put them back. */
function optimistic(change: (list: Initiative[]) => Initiative[]): () => void {
   writes++;
   const before = store.get().initiatives;
   store.set({ ...store.get(), initiatives: change(before ?? []) });
   return () => store.set({ ...store.get(), initiatives: before });
}

/** The list with one project moved to `to` (a slug, or null for none). */
export function withFiling(
   list: readonly Initiative[],
   project: string,
   to: string | null,
   filing: Omit<Filing, 'project'> = {
      set_by: null,
      set_at: Math.floor(Date.now() / 1000),
      baseline_prs: 0,
   }
): Initiative[] {
   return list.map(i => {
      const rest = i.projects.filter(f => f.project !== project);
      return {
         ...i,
         projects: i.slug === to ? [...rest, { project, ...filing }] : rest,
      };
   });
}

/**
 * File a project in the initiative with slug `to`, or in none. `expect` is
 * the home the person saw; `set_at` and `baseline_prs` put back a home as it
 * was (an Undo). Resolves to the home it replaced, or the problem in words.
 */
export async function fileProject(
   project: string,
   to: string | null,
   {
      expect,
      set_at,
      baseline_prs,
   }: { expect?: string | null; set_at?: number | null; baseline_prs?: number } = {}
): Promise<{ before: Home } | { error: string }> {
   const takeBack = optimistic(list =>
      withFiling(list, project, to, {
         set_by: null,
         set_at: set_at ?? Math.floor(Date.now() / 1000),
         baseline_prs: baseline_prs ?? 0,
      })
   );
   const reply = await api
      .file({
         project,
         initiative: to,
         ...(expect !== undefined ? { expect } : {}),
         ...(set_at != null ? { set_at } : {}),
         ...(baseline_prs != null && set_at != null ? { baseline_prs } : {}),
      })
      .catch((): Reply => ({ status: 0, json: {} }));
   if (reply.status === 409 && reply.json.home !== undefined) {
      // someone filed it since: say where it is now, and show it there
      takeBack();
      const now = (reply.json.home as Home | null)?.initiative ?? null;
      const name = now
         ? store.get().initiatives?.find(i => i.slug === now)?.name ?? now
         : UNSORTED_WORD;
      void loadInitiatives();
      return {
         error: `Couldn’t file the project: someone filed it in ${name} since, so nothing changed.`,
      };
   }
   if (reply.status !== 200) {
      takeBack();
      return { error: problemOf(reply, 'file the project') };
   }
   void loadInitiatives();
   return { before: reply.json.before as Home };
}

/** Put the initiatives in this order, top first, by moving `id` just above
 * `before` (null: the bottom). Resolves to whether it saved. */
export async function moveInitiative(
   id: number,
   before: number | null
): Promise<true | { error: string }> {
   const takeBack = optimistic(list => {
      const sorted = byRank(list);
      const moving = sorted.find(i => i.id === id);
      if (!moving) return list;
      const rest = sorted.filter(i => i.id !== id);
      const at = before == null ? rest.length : rest.findIndex(i => i.id === before);
      rest.splice(at < 0 ? rest.length : at, 0, moving);
      return rest.map((i, k) => ({ ...i, priority: k }));
   });
   const reply = await api.move(id, before).catch((): Reply => ({ status: 0, json: {} }));
   if (reply.status !== 200) {
      takeBack();
      return { error: problemOf(reply, 'save the new order') };
   }
   store.set({ ...store.get(), initiatives: reply.json.initiatives as Initiative[] });
   return true;
}

/** Change an initiative's name, goal, owner or status. `restate` stamps a
 * status kept as it was (Keep open); `undo` puts back the times a change
 * replaced. Resolves to the initiative as it was, or the problem. */
export async function updateInitiative(
   id: number,
   fields: Partial<InitiativeFields>,
   extra: { restate?: boolean; undo?: { updated_at: number; status_at: number | null } } = {}
): Promise<{ was: Initiative } | { error: string; live?: string[] }> {
   const was = store.get().initiatives?.find(i => i.id === id);
   const takeBack = optimistic(list => list.map(i => (i.id === id ? { ...i, ...fields } : i)));
   const reply = await api.update(id, fields, extra).catch((): Reply => ({ status: 0, json: {} }));
   if (reply.status !== 200 || !was) {
      takeBack();
      const live = Array.isArray(reply.json.live) ? (reply.json.live as string[]) : undefined;
      return { error: problemOf(reply, 'save the initiative'), live };
   }
   const saved = reply.json.initiative as Initiative;
   store.set({
      ...store.get(),
      initiatives: (store.get().initiatives ?? []).map(i => (i.id === id ? saved : i)),
   });
   return { was };
}

/** Initiatives in their rank order, the older first on a tie. */
export const byRank = <I extends Pick<Initiative, 'priority' | 'id'>>(list: readonly I[]): I[] =>
   [...list].sort((a, b) => a.priority - b.priority || a.id - b.id);

/** The initiatives as the board has them now, outside React. */
export function readInitiatives(): InitiativesState {
   return store.get();
}

/** The initiatives as loaded so far, without asking for a load: for a part
 * drawn under a view that loads them (Projects.tsx). */
export function useInitiativesValue(): InitiativesState {
   return store.useValue();
}

/** The initiatives, loaded on first use. */
export function useInitiatives(): InitiativesState {
   useEffect(() => {
      if (store.get().initiatives == null) void loadInitiatives();
   }, []);
   return store.useValue();
}

/**
 * Whether a project is Not tracked now: its home says so when it has one,
 * which a filing made on this board changes at once; with none, what the
 * server last said (`serverSays`: a repo default, or the flag it set on a
 * plan). With the initiatives not loaded yet, the server's word stands.
 */
export function isNotTrackedNow(
   slug: string | null,
   serverSays: boolean,
   initiatives: readonly Initiative[] | null = store.get().initiatives
): boolean {
   if (!slug || !initiatives) return serverSays;
   const kind = homeKinds(initiatives).get(slug);
   return kind ? kind === 'untracked' : serverSays;
}

// each list's homes' kinds by slug, read once per list: the roadmap asks
// about every plan in one pass
const kindsByList = new WeakMap<readonly Initiative[], Map<string, Initiative['kind']>>();
function homeKinds(initiatives: readonly Initiative[]): Map<string, Initiative['kind']> {
   let kinds = kindsByList.get(initiatives);
   if (!kinds) {
      kinds = new Map([...homesOf(initiatives)].map(([slug, h]) => [slug, h.initiative.kind]));
      kindsByList.set(initiatives, kinds);
   }
   return kinds;
}
