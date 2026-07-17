import { useSyncExternalStore } from 'react';
import { backend, type ConnectionState } from './backend/socket';
import { derive, type DerivedPull } from './model/status';
import { readStorage, writeStorage } from './storage';
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
   /** first initialize payload has arrived: [] means empty, not loading */
   initialized: boolean;
   /** the /token fetch failed: session expired or server down */
   authFailed: boolean;
   /** epoch secs of the last payload from the server; 0 until one arrives */
   lastPayloadAt: number;
   /** epoch secs of the last-seen marker (previous visit's departure) */
   lastSeen: number;
}

const LAST_SEEN_KEY = 'pd2.lastSeen';

const raw = new Map<string, PullData>();
let repoSpecs: RepoSpec[] = [];
let me = '';
let connection: ConnectionState = 'connecting';
let initialized = false;
let authFailed = false;
let lastPayloadAt = 0;
const listeners = new Set<() => void>();

// The marker advances when you LEAVE (pagehide / tab hidden), not when you
// arrive — an accidental reload must not erase "changed since yesterday".
const lastSeen = Number(readStorage(LAST_SEEN_KEY)) || Date.now() / 1000 - 6 * 3600;
const stampSeen = () => writeStorage(LAST_SEEN_KEY, String(Date.now() / 1000));
window.addEventListener('pagehide', stampSeen);
document.addEventListener('visibilitychange', () => {
   if (document.visibilityState === 'hidden') stampSeen();
});

let snapshot: Snapshot = {
   pulls: [],
   repoSpecs,
   closed: [],
   me,
   connection,
   initialized,
   authFailed,
   lastPayloadAt,
   lastSeen,
};

// derive() is pure per (pull, spec): cache on reference identity so a
// pullChange for one pull doesn't rebuild 180 DerivedPull objects (and
// re-render 180 memoized rows).
const derived = new WeakMap<PullData, { spec: RepoSpec | undefined; value: DerivedPull }>();
function deriveCached(pull: PullData, spec: RepoSpec | undefined): DerivedPull {
   const hit = derived.get(pull);
   if (hit && hit.spec === spec) return hit.value;
   const value = derive(pull, spec);
   derived.set(pull, { spec, value });
   return value;
}

function publish() {
   const specByName = new Map(repoSpecs.map(s => [s.name, s]));
   const all = [...raw.values()];
   snapshot = {
      pulls: all.filter(p => p.state === 'open').map(p => deriveCached(p, specByName.get(p.repo))),
      closed: all
         .filter(p => p.state === 'closed')
         .sort(
            (a, b) => (Date.parse(b.closed_at ?? '') || 0) - (Date.parse(a.closed_at ?? '') || 0)
         ),
      repoSpecs,
      me,
      connection,
      initialized,
      authFailed,
      lastPayloadAt,
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
   backend.whoami().then(
      user => {
         me = user;
         authFailed = false;
         schedulePublish();
      },
      () => {
         authFailed = true;
         schedulePublish();
      }
   );
   backend.onPulls(payload => {
      if ('pulls' in payload) {
         // full snapshot: replace, don't merge, or pulls dropped while we
         // were disconnected live on as ghosts
         raw.clear();
         repoSpecs = payload.repos;
         for (const p of payload.pulls) raw.set(`${p.repo}#${p.number}`, p);
         initialized = true;
      } else {
         raw.set(`${payload.repo}#${payload.number}`, payload);
      }
      lastPayloadAt = Date.now() / 1000;
      schedulePublish();
   });
   backend.onConnection(state => {
      connection = state;
      schedulePublish();
   });
   // time-based derivations (iterating, "Nm ago") expire even on a quiet board
   setInterval(schedulePublish, 60_000);
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
