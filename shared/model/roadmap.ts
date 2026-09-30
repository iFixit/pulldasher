import { dayStart, utcDay } from './projects';

/**
 * The roadmap: the plan a project manager lays out by hand, kept in
 * Pulldasher's own table (roadmap_items) rather than read off PRs. Each item
 * has a planned first week, a length in weeks, and a place in one shared
 * order (its priority). Linking an item to a project label lets the PRs'
 * real activity draw over the plan; an item with no link is a plan with no
 * code yet. Pure, so the server's checks and the board's are the same code.
 */

export type RoadmapStatus = 'planned' | 'active' | 'done' | 'dropped';
export const ROADMAP_STATUSES: RoadmapStatus[] = ['planned', 'active', 'done', 'dropped'];

/** How the work is going, in the words a lead would use in standup. */
export type RoadmapHealth = 'on_track' | 'at_risk' | 'off_track';
export const ROADMAP_HEALTHS: RoadmapHealth[] = ['on_track', 'at_risk', 'off_track'];

/** the longest plan an item can carry, in weeks: two years */
export const MAX_WEEKS = 104;
/** how long an update on work in progress stays current: after this many
 * days without a new one, the lead owes the next */
export const UPDATE_DUE_DAYS = 14;
const NAME_MAX = 120;
const NOTES_MAX = 2000;
/** the most other items one can wait on */
export const WAITS_ON_MAX = 10;
const TEAM_MAX = 64;
const DAY = 86400;

export interface RoadmapItem {
   id: number;
   name: string;
   /** the project label slug this item tracks; null for a plan with no PRs yet */
   project: string | null;
   /** a developer team, for the roadmap's team lanes; null for none */
   team: string | null;
   /** a GitHub login */
   lead: string | null;
   status: RoadmapStatus;
   /** the Monday of the planned first week, YYYY-MM-DD */
   start: string;
   /** the planned length in whole weeks */
   weeks: number;
   /** its place in the order: lower comes first */
   priority: number;
   notes: string;
   /** the ids of other items that have to finish before this one starts */
   waits_on: number[];
   /** who last changed it and when (epoch secs); null before anyone has */
   updated_by: string | null;
   updated_at: number | null;
   /** the latest update on how it's going; null before the first */
   update: RoadmapUpdate | null;
}

/**
 * One update on an item: how it's going and why, from whoever posted it.
 * Updates are kept as a history. Each keeps the plan as it stood when it was
 * written, so the next can say how far the plan moved in between.
 */
export interface RoadmapUpdate {
   id: number;
   item_id: number;
   health: RoadmapHealth;
   body: string;
   /** the item's start and length when this was posted */
   plan_start: string;
   plan_weeks: number;
   author: string;
   /** epoch secs */
   at: number;
}

/** The fields a person can set; the server owns id, priority and the audit fields. */
export type RoadmapFields = Pick<
   RoadmapItem,
   'name' | 'project' | 'team' | 'lead' | 'status' | 'start' | 'weeks' | 'notes' | 'waits_on'
>;

/** The Monday on or before a YYYY-MM-DD day: plans move in whole weeks. */
export function mondayOf(day: string): string {
   const t = dayStart(day) as number;
   return utcDay(t - ((new Date(t * 1000).getUTCDay() + 6) % 7) * DAY);
}

/** A YYYY-MM-DD day plus some weeks. */
export function addWeeks(day: string, weeks: number): string {
   return utcDay((dayStart(day) as number) + weeks * 7 * DAY);
}

/** The last planned day of an item: its Sunday, `weeks` after it starts. */
export function planEnd(item: Pick<RoadmapItem, 'start' | 'weeks'>): string {
   return utcDay((dayStart(item.start) as number) + (item.weeks * 7 - 1) * DAY);
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,23}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

type Check = { fields: Partial<RoadmapFields> } | { error: string };

/**
 * Check what a person sent for a roadmap item, and clean it: names and notes
 * trimmed, the start moved to its Monday. A new item (`partial: false`) needs
 * a name, and gets defaults for the rest from the caller; an edit
 * (`partial: true`) may send any subset. Returns the clean fields, or the
 * first problem in words fit to show the person.
 */
export function checkRoadmapFields(input: unknown, { partial }: { partial: boolean }): Check {
   if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { error: 'send the item as a JSON object' };
   }
   const raw = input as Record<string, unknown>;
   const fields: Partial<RoadmapFields> = {};
   const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
   // null or an empty string clears an optional field
   const optional = (key: string) => raw[key] == null || raw[key] === '';

   if (has('name') || !partial) {
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) return { error: 'a project needs a name' };
      if (name.length > NAME_MAX) return { error: `keep the name to ${NAME_MAX} characters` };
      fields.name = name;
   }
   if (has('project')) {
      if (optional('project')) fields.project = null;
      else if (typeof raw.project !== 'string' || !SLUG.test(raw.project)) {
         return { error: 'the linked project must be a label slug, like ups-access-points' };
      } else fields.project = raw.project;
   }
   if (has('team')) {
      if (optional('team')) fields.team = null;
      else if (typeof raw.team !== 'string' || raw.team.trim().length > TEAM_MAX) {
         return { error: `a team name is at most ${TEAM_MAX} characters` };
      } else fields.team = raw.team.trim();
   }
   if (has('lead')) {
      if (optional('lead')) fields.lead = null;
      else if (typeof raw.lead !== 'string' || !LOGIN.test(raw.lead.trim())) {
         return { error: 'the lead must be a GitHub login' };
      } else fields.lead = raw.lead.trim();
   }
   if (has('status')) {
      if (!ROADMAP_STATUSES.includes(raw.status as RoadmapStatus)) {
         return { error: `status is one of ${ROADMAP_STATUSES.join(', ')}` };
      }
      fields.status = raw.status as RoadmapStatus;
   }
   if (has('start')) {
      if (typeof raw.start !== 'string' || dayStart(raw.start) == null) {
         return { error: 'start must be a YYYY-MM-DD day' };
      }
      fields.start = mondayOf(raw.start);
   }
   if (has('weeks')) {
      const weeks = raw.weeks;
      if (typeof weeks !== 'number' || !Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
         return { error: `the length is a whole number of weeks, 1 to ${MAX_WEEKS}` };
      }
      fields.weeks = weeks;
   }
   if (has('notes')) {
      if (optional('notes')) fields.notes = '';
      else if (typeof raw.notes !== 'string' || raw.notes.length > NOTES_MAX) {
         return { error: `keep the notes to ${NOTES_MAX} characters` };
      } else fields.notes = raw.notes.trim();
   }
   if (has('waits_on')) {
      const ids = raw.waits_on ?? [];
      if (
         !Array.isArray(ids) ||
         !ids.every(id => Number.isInteger(id) && id > 0) ||
         new Set(ids).size !== ids.length
      ) {
         return { error: 'waits_on is a list of other roadmap item ids, each once' };
      }
      if (ids.length > WAITS_ON_MAX) {
         return { error: `an item can wait on at most ${WAITS_ON_MAX} others` };
      }
      fields.waits_on = ids as number[];
   }
   return { fields };
}

/**
 * What's wrong with item `id` (null for a new one) waiting on `waitsOn`,
 * given every item: an id that isn't on the roadmap, the item itself, or a
 * loop (A waits on B, which waits on A), which no plan could satisfy. Null
 * when it's fine.
 */
export function waitsOnProblem(
   id: number | null,
   waitsOn: readonly number[],
   items: readonly Pick<RoadmapItem, 'id' | 'waits_on'>[]
): string | null {
   const byId = new Map(items.map(i => [i.id, i]));
   for (const other of waitsOn) {
      if (other === id) return 'an item can’t wait on itself';
      if (!byId.has(other)) return `there’s no roadmap item ${other}`;
   }
   if (id == null) return null;
   // walk everything the new list waits on, directly or not
   const seen = new Set<number>();
   const next = [...waitsOn];
   while (next.length) {
      const at = next.pop() as number;
      if (at === id) return 'that would make a loop: those items already wait on this one';
      if (seen.has(at)) continue;
      seen.add(at);
      next.push(...(byId.get(at)?.waits_on ?? []));
   }
   return null;
}

/**
 * The items `item` waits on, each with whether the plan clashes: the item
 * starts before the other's planned end while that one isn't done, or the
 * other was dropped. Ids no longer on the roadmap are skipped.
 */
export function blockersOf(
   item: Pick<RoadmapItem, 'start' | 'waits_on'>,
   items: readonly RoadmapItem[]
): { item: RoadmapItem; clash: boolean }[] {
   const byId = new Map(items.map(i => [i.id, i]));
   return item.waits_on.flatMap(id => {
      const other = byId.get(id);
      if (!other) return [];
      const clash =
         other.status === 'dropped' || (other.status !== 'done' && item.start <= planEnd(other));
      return [{ item: other, clash }];
   });
}

/** Check what a person sent as an update: a health, and words up to the
 * notes' limit (none is fine: "on track" can say it all). */
export function checkRoadmapUpdate(
   input: unknown
): { fields: { health: RoadmapHealth; body: string } } | { error: string } {
   if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { error: 'send the update as a JSON object' };
   }
   const raw = input as Record<string, unknown>;
   if (!ROADMAP_HEALTHS.includes(raw.health as RoadmapHealth)) {
      return { error: `health is one of ${ROADMAP_HEALTHS.join(', ')}` };
   }
   const body = raw.body ?? '';
   if (typeof body !== 'string' || body.length > NOTES_MAX) {
      return { error: `keep the update to ${NOTES_MAX} characters` };
   }
   return { fields: { health: raw.health as RoadmapHealth, body: body.trim() } };
}

/** How many weeks a plan's end moved from one version to the next: positive
 * is later. */
export function endShift(
   from: Pick<RoadmapItem, 'start' | 'weeks'>,
   to: Pick<RoadmapItem, 'start' | 'weeks'>
): number {
   const diff = (dayStart(planEnd(to)) as number) - (dayStart(planEnd(from)) as number);
   return Math.round(diff / (7 * DAY));
}

/**
 * Where an item's updates stand, for the roadmap row and the overview:
 * - `quiet`: nothing owed. Done or dropped, planned, or in progress for less
 *   than UPDATE_DUE_DAYS by its plan without an update yet.
 * - `missing`: in progress past UPDATE_DUE_DAYS by its plan, and never an update.
 * - `current`: the latest update is recent enough, or the work hasn't started.
 * - `stale`: in progress, and the latest update is older than UPDATE_DUE_DAYS.
 */
export type HealthStanding =
   | { kind: 'quiet' }
   | { kind: 'missing' }
   | { kind: 'current'; update: RoadmapUpdate }
   | { kind: 'stale'; update: RoadmapUpdate; days: number };

export function healthStanding(
   item: Pick<RoadmapItem, 'status' | 'start' | 'update'>,
   now: number = Date.now() / 1000
): HealthStanding {
   if (item.status === 'done' || item.status === 'dropped') return { kind: 'quiet' };
   const active = item.status === 'active';
   const u = item.update;
   if (!u) {
      const started = (now - (dayStart(item.start) as number)) / DAY;
      return active && started > UPDATE_DUE_DAYS ? { kind: 'missing' } : { kind: 'quiet' };
   }
   const days = Math.floor((now - u.at) / DAY);
   return active && days > UPDATE_DUE_DAYS
      ? { kind: 'stale', update: u, days }
      : { kind: 'current', update: u };
}

/**
 * The most items planned or in progress in any one week from `from` up to
 * `to`, and the first week that happens: how many things a team would be
 * juggling at once if the plan holds. Weeks start on Mondays.
 */
export function peakLoad(
   items: readonly Pick<RoadmapItem, 'status' | 'start' | 'weeks'>[],
   from: string,
   to: string
): { count: number; week: string | null } {
   const live = items.filter(i => i.status === 'planned' || i.status === 'active');
   let peak: { count: number; week: string | null } = { count: 0, week: null };
   for (let week = mondayOf(from); week < to; week = addWeeks(week, 1)) {
      const count = live.filter(i => i.start <= week && planEnd(i) >= week).length;
      if (count > peak.count) peak = { count, week };
   }
   return peak;
}

/** how far ahead the roadmap's "next" reaches, in weeks: one quarter */
export const NEXT_WEEKS = 13;

/**
 * Which of now, next and later an item belongs in, for the roadmap's dateless
 * layout: now is work in progress and plans whose start has come, next starts
 * within NEXT_WEEKS, later is further out. Done and dropped work is in none.
 */
export function bucketOf(
   item: Pick<RoadmapItem, 'status' | 'start'>,
   today: string
): 'now' | 'next' | 'later' | null {
   if (item.status === 'done' || item.status === 'dropped') return null;
   if (item.status === 'active' || item.start <= today) return 'now';
   return item.start <= addWeeks(today, NEXT_WEEKS) ? 'next' : 'later';
}

/**
 * Move `id` to just before `beforeId` in an order of ids (to the end with
 * null), for a drag that drops one row onto another. Unknown ids leave the
 * order as it was.
 */
export function moveBefore(order: readonly number[], id: number, beforeId: number | null): number[] {
   if (!order.includes(id) || id === beforeId) return [...order];
   const rest = order.filter(x => x !== id);
   const at = beforeId == null ? -1 : rest.indexOf(beforeId);
   if (at < 0) return [...rest, id];
   return [...rest.slice(0, at), id, ...rest.slice(at)];
}
