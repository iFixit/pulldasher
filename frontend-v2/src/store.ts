import { useSyncExternalStore } from 'react';
import { backend, type ConnectionState } from './backend/socket';
import { derive, type DerivedPull, type Weight } from '../../shared/model/status';
import { getSettings, subscribeSettings } from './settings';
import { epoch } from '../../shared/format';
import { readStorage, writeStorage } from './storage';
import type { PullData, RepoSpec } from '../../shared/types';

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
   /** epoch secs of the last Clear — the "Recently updated" baseline */
   lastSeen: number;
   /** pull key → epoch secs it was snoozed: hidden for a day or until it
    * changes. Persisted per-browser. */
   snoozed: Readonly<Record<string, number>>;
   /** "Refresh all" in progress (or just finished): how many of the pulls
    * queued at kickoff have reported back. Null when no refresh is running. */
   refreshProgress: { done: number; total: number } | null;
}

const LAST_SEEN_KEY = 'pd2.lastSeen';

const raw = new Map<string, PullData>();
let repoSpecs: RepoSpec[] = [];
// label title → weight bucket, from config.json. Set once when config loads;
// a fresh Map reference invalidates the derive cache so weights re-resolve.
let weightLabels: ReadonlyMap<string, Weight> = new Map();
let me = '';
let connection: ConnectionState = 'connecting';
let initialized = false;
let authFailed = false;
let lastPayloadAt = 0;
const listeners = new Set<() => void>();

// "Refresh all" progress: the set of pull keys still awaiting a pullChange
// since the last refreshAll() kickoff. total is fixed at kickoff so the
// header/Settings chip reads "N of TOTAL" even as pending shrinks. Null
// means no refresh is in flight (or its grace window has elapsed).
let refreshTracking: { pending: Set<string>; total: number } | null = null;
let refreshCompleteTimer: ReturnType<typeof setTimeout> | null = null;

/** A reconnect resends everything as one 'initialize' payload, which isn't
 * the per-pull pullChange this tracking is counting — treat it as "the
 * refresh's work is moot", not "N more arrived", or the counter would stall
 * short of total forever. */
function clearRefreshTracking() {
   if (refreshCompleteTimer != null) clearTimeout(refreshCompleteTimer);
   refreshCompleteTimer = null;
   refreshTracking = null;
}

/** Count a pullChange toward the in-flight refresh, if one is running. On
 * the last arrival, hold the finished "N of N" on screen briefly — a fast
 * board would otherwise flash the count and clear it before anyone reads it. */
function noteRefreshArrival(key: string) {
   if (!refreshTracking || !refreshTracking.pending.delete(key)) return;
   if (refreshTracking.pending.size > 0) return;
   refreshCompleteTimer = setTimeout(() => {
      refreshTracking = null;
      refreshCompleteTimer = null;
      schedulePublish();
   }, 4000);
}

// The marker moves ONLY by the user's hand — the "Recently updated" lane's
// Clear button. Earlier versions guessed attention from tab visibility plus a
// glance-guard timer and guessed wrong (a page on a hidden virtual desktop
// still counts as "visible"); an explicit control the user can see beats a
// heuristic they can't predict. New browsers start with a 6-hour window.
let lastSeen = Number(readStorage(LAST_SEEN_KEY)) || Date.now() / 1000 - 6 * 3600;

/** The Clear action: everything on the board right now is old news. */
export function markAllSeen() {
   lastSeen = Date.now() / 1000;
   writeStorage(LAST_SEEN_KEY, String(lastSeen));
   schedulePublish();
}

/** The one fresh predicate: changed since the user last cleared. No per-row
 * acks — opening a PR used to silently remove its row from "Recently
 * updated", which read as the board losing things; one state, one visible
 * control. */
export function isFresh(d: Pick<PullData, 'updated_at'>, lastSeenAt: number) {
   return epoch(d.updated_at) > lastSeenAt;
}

// Snooze: "not today" for one PR. A snooze lasts a day, and any change to
// the pull (a push, a comment — anything that moves updated_at) voids it
// early: punting a PR must never hide what happens to it next.
const SNOOZED_KEY = 'pd2.snoozed';
const SNOOZE_SECS = 24 * 3600;
let snoozed: Record<string, number> = {};
try {
   snoozed = JSON.parse(readStorage(SNOOZED_KEY) ?? '{}') ?? {};
} catch {
   snoozed = {};
}
const saveSnoozed = () => {
   const now = Date.now() / 1000;
   for (const [k, at] of Object.entries(snoozed)) if (now > at + SNOOZE_SECS) delete snoozed[k];
   writeStorage(SNOOZED_KEY, JSON.stringify(snoozed));
};
export function snoozePull(key: string) {
   snoozed[key] = Date.now() / 1000;
   saveSnoozed();
   schedulePublish();
}
export function unsnoozePull(key: string) {
   delete snoozed[key];
   saveSnoozed();
   schedulePublish();
}

export function clearSnoozes() {
   snoozed = {};
   writeStorage(SNOOZED_KEY, '{}');
   schedulePublish();
}

/** Snoozed and nothing has happened since: still hidden. */
export function isSnoozed(
   d: Pick<PullData, 'repo' | 'number' | 'updated_at'>,
   snoozedAt: Readonly<Record<string, number>>,
   now: number = Date.now() / 1000
) {
   const at = snoozedAt[`${d.repo}#${d.number}`];
   if (at == null) return false;
   return now < at + SNOOZE_SECS && epoch(d.updated_at) <= at;
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
   snoozed: { ...snoozed },
   refreshProgress: null,
};

// derive() is pure per (pull, spec, warnDays, minute): cache on reference
// identity so a pullChange for one pull doesn't rebuild 180 DerivedPull
// objects (and re-render 180 memoized rows). warnDays is in the key so
// changing the aging threshold in Settings actually re-derives (starved gates
// the aging lane). The minute bucket keeps the 60s heartbeat honest: without
// it, a quiet pull returns the same cached object forever, Row's memo bails,
// and ageDays/starved/"Nm ago" freeze at whenever the pull last changed.
const derived = new WeakMap<
   PullData,
   {
      spec: RepoSpec | undefined;
      warnDays: number;
      weightLabels: ReadonlyMap<string, Weight>;
      minute: number;
      value: DerivedPull;
   }
>();
function deriveCached(pull: PullData, spec: RepoSpec | undefined, warnDays: number): DerivedPull {
   const minute = Math.floor(Date.now() / 60_000);
   const hit = derived.get(pull);
   if (
      hit &&
      hit.spec === spec &&
      hit.warnDays === warnDays &&
      hit.weightLabels === weightLabels &&
      hit.minute === minute
   )
      return hit.value;
   const value = derive(pull, spec, Date.now() / 1000, warnDays, weightLabels);
   derived.set(pull, { spec, warnDays, weightLabels, minute, value });
   return value;
}

/**
 * Install the weight-label config (from config.json) and re-derive. Rebuilding
 * the Map gives a new reference, which misses the derive cache so every pull's
 * weight re-resolves against the labels. Call once after the config loads.
 */
export function setWeightLabels(map: Record<string, Weight>) {
   weightLabels = new Map(Object.entries(map));
   schedulePublish();
}

function publish() {
   const specByName = new Map(repoSpecs.map(s => [s.name, s]));
   const warnDays = getSettings().ageWarnDays;
   const all = [...raw.values()];
   snapshot = {
      pulls: all
         .filter(p => p.state === 'open')
         .map(p => deriveCached(p, specByName.get(p.repo), warnDays)),
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
      snoozed: { ...snoozed },
      refreshProgress: refreshTracking
         ? {
              done: refreshTracking.total - refreshTracking.pending.size,
              total: refreshTracking.total,
           }
         : null,
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
         // a reconnect resends everything; counting it as refresh progress
         // would either double-count or strand the tracker short of total
         clearRefreshTracking();
      } else {
         const key = `${payload.repo}#${payload.number}`;
         raw.set(key, payload);
         noteRefreshArrival(key);
      }
      lastPayloadAt = Date.now() / 1000;
      schedulePublish();
   });
   backend.onConnection(state => {
      connection = state;
      schedulePublish();
   });
   // the aging threshold feeds derive(): re-derive when the user changes it
   subscribeSettings(schedulePublish);
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

/** Claim/release actions: thin wrappers so callers (Row, toasts) go
 * through the store like every other mutation instead of reaching into the
 * backend directly. Claims no longer expire on a timer — they clear when the
 * review is submitted, released, or removed on GitHub — so there's no TTL to
 * send. */
export function claimReview(pull: Pick<PullData, 'repo' | 'number'>): void {
   backend.claimReview(pull.repo, pull.number);
}
export function releaseReview(pull: Pick<PullData, 'repo' | 'number'>): void {
   backend.releaseReview(pull.repo, pull.number);
}

/**
 * Settings action: ask the server to re-fetch every open pull from GitHub.
 * The socket protocol has no bulk refresh, so this fans out one per-pull
 * refresh (the same event a row's refresh button sends) and lets the server's
 * serial refresh queue work through them. Returns how many were queued so the
 * UI can say so. Closed pulls are historical, so they're left out.
 */
export function refreshAll(): number {
   const opens = [...raw.values()].filter(p => p.state === 'open');
   if (opens.length === 0) return 0;
   // a re-click mid-refresh restarts the count from this batch, not a merge
   // with the last one's leftovers
   clearRefreshTracking();
   refreshTracking = {
      pending: new Set(opens.map(p => `${p.repo}#${p.number}`)),
      total: opens.length,
   };
   for (const p of opens) backend.refreshPull(p.repo, p.number);
   schedulePublish();
   return opens.length;
}
