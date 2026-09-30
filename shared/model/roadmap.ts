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

/** the longest plan an item can carry, in weeks: two years */
export const MAX_WEEKS = 104;
const NAME_MAX = 120;
const NOTES_MAX = 2000;
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
   /** who last changed it and when (epoch secs); null before anyone has */
   updated_by: string | null;
   updated_at: number | null;
}

/** The fields a person can set; the server owns id, priority and the audit fields. */
export type RoadmapFields = Pick<
   RoadmapItem,
   'name' | 'project' | 'team' | 'lead' | 'status' | 'start' | 'weeks' | 'notes'
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
   return { fields };
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
