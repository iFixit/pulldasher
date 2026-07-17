import { useSyncExternalStore } from 'react';
import { backend, type ConnectionState } from './backend/socket';
import { derive, type DerivedPull } from './model/status';
import { getSettings } from './settings';
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
   /** pull keys opened this session: their fresh dots are cleared */
   acked: ReadonlySet<string>;
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
// And only after the page has actually been LOOKED AT: a two-second Monday
// glance on the way to Slack must not mark the weekend's forty changes as
// seen. "Looked at" = N cumulative visible seconds since the last stamp,
// where N is the user's glance-guard setting (seenAfterSecs).
let lastSeen = Number(readStorage(LAST_SEEN_KEY)) || Date.now() / 1000 - 6 * 3600;
let attendedSecs = 0;
let visibleSince: number | null = document.visibilityState === 'visible' ? Date.now() / 1000 : null;
const settleAttention = () => {
   if (visibleSince != null) {
      attendedSecs += Date.now() / 1000 - visibleSince;
      visibleSince = null;
   }
};
const stampSeen = () => {
   settleAttention();
   if (attendedSecs < getSettings().seenAfterSecs) return;
   lastSeen = Date.now() / 1000;
   writeStorage(LAST_SEEN_KEY, String(lastSeen));
   attendedSecs = 0;
};
window.addEventListener('pagehide', stampSeen);
document.addEventListener('visibilitychange', () => {
   if (document.visibilityState === 'hidden') stampSeen();
   else visibleSince = Date.now() / 1000;
});

/** Settings action: treat everything on the board as seen, right now. */
export function markAllSeen() {
   lastSeen = Date.now() / 1000;
   writeStorage(LAST_SEEN_KEY, String(lastSeen));
   attendedSecs = 0;
   schedulePublish();
}

// Per-row acknowledgment: opening a PR clears its fresh dot for this session
// without waiting for departure to stamp the whole board.
const acked = new Set<string>();
export function ackPull(key: string) {
   if (acked.has(key)) return;
   acked.add(key);
   schedulePublish();
}

/** The one fresh predicate: changed since your last look and not yet opened. */
export function isFresh(
   d: Pick<PullData, 'repo' | 'number' | 'updated_at'>,
   lastSeenAt: number,
   ackedKeys: ReadonlySet<string>
) {
   return Date.parse(d.updated_at) / 1000 > lastSeenAt && !ackedKeys.has(`${d.repo}#${d.number}`);
}

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
   acked: new Set(acked),
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
      acked: new Set(acked),
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

/**
 * Settings action: ask the server to re-fetch every open pull from GitHub.
 * The socket protocol has no bulk refresh, so this fans out one per-pull
 * refresh (the same event a row's refresh button sends) and lets the server's
 * serial refresh queue work through them. Returns how many were queued so the
 * UI can say so. Closed pulls are historical, so they're left out.
 */
export function refreshAll(): number {
   let n = 0;
   for (const p of raw.values()) {
      if (p.state === 'open') {
         backend.refreshPull(p.repo, p.number);
         n++;
      }
   }
   return n;
}
