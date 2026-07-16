import { useSyncExternalStore } from 'react';
import { backend, type ConnectionState } from './backend/socket';
import { derive, type DerivedPull } from './model/status';
import type { PullData, RepoSpec } from './types';

/**
 * The one store: raw pulls keyed by repo#number, re-derived and re-published
 * as a sorted snapshot whenever the socket delivers. Throttled so a burst of
 * pullChange events (bulk refresh on the server) renders once, not N times.
 */

export interface Snapshot {
   pulls: DerivedPull[];
   repoSpecs: RepoSpec[];
   /** merged/closed in the last 14 days (the server's retention window) */
   closed: PullData[];
   me: string;
   connection: ConnectionState;
   /** epoch secs of the last-seen marker captured at page load */
   lastSeen: number;
}

const LAST_SEEN_KEY = 'pd2.lastSeen';

const raw = new Map<string, PullData>();
let repoSpecs: RepoSpec[] = [];
let me = '';
let connection: ConnectionState = 'connecting';
const listeners = new Set<() => void>();

// Captured once per page load: everything updated after this shows as fresh.
const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY)) || Date.now() / 1000 - 6 * 3600;
localStorage.setItem(LAST_SEEN_KEY, String(Date.now() / 1000));

let snapshot: Snapshot = {
   pulls: [],
   repoSpecs,
   closed: [],
   me,
   connection,
   lastSeen,
};

function publish() {
   const specByName = new Map(repoSpecs.map(s => [s.name, s]));
   const all = [...raw.values()];
   snapshot = {
      pulls: all.filter(p => p.state === 'open').map(p => derive(p, specByName.get(p.repo))),
      closed: all
         .filter(p => p.state === 'closed')
         .sort((a, b) => Date.parse(b.closed_at ?? '0') - Date.parse(a.closed_at ?? '0')),
      repoSpecs,
      me,
      connection,
      lastSeen,
   };
   for (const fn of listeners) fn();
}

let scheduled = false;
function schedulePublish() {
   if (scheduled) return;
   scheduled = true;
   setTimeout(() => {
      scheduled = false;
      publish();
   }, 250);
}

let started = false;
function start() {
   if (started) return;
   started = true;
   void backend.whoami().then(user => {
      me = user;
      schedulePublish();
   });
   backend.onPulls(payload => {
      if ('pulls' in payload) {
         repoSpecs = payload.repos;
         for (const p of payload.pulls) raw.set(`${p.repo}#${p.number}`, p);
      } else {
         raw.set(`${payload.repo}#${payload.number}`, payload);
      }
      schedulePublish();
   });
   backend.onConnection(state => {
      connection = state;
      schedulePublish();
   });
}

export function usePulldasher(): Snapshot {
   start();
   return useSyncExternalStore(
      fn => {
         listeners.add(fn);
         return () => listeners.delete(fn);
      },
      () => snapshot
   );
}

export const refreshPull = backend.refreshPull;
