import { endOf, isUnderWay, PROJECT_SLUG, type RoadmapItem } from './roadmap';

/**
 * Initiatives: one layer above projects, kept in Pulldasher's own tables
 * (initiatives, initiative_projects). Each has a name, a goal, one owner and
 * its own rank, and holds projects by slug; a project has one home at most:
 * an initiative, Keep the lights on (`upkeep`), Not tracked (`untracked`), or
 * no row, which the board calls Unsorted. An initiative has no PRs, updates
 * or dates of its own: its dates are read off its projects' plans
 * (initiativeSpan). Pure, so the server and the board share it.
 */

export type InitiativeKind = 'initiative' | 'upkeep' | 'untracked';
export const INITIATIVE_KINDS: InitiativeKind[] = ['initiative', 'upkeep', 'untracked'];
export type InitiativeStatus = 'open' | 'done' | 'dropped';
export const INITIATIVE_STATUSES: InitiativeStatus[] = ['open', 'done', 'dropped'];
export const INITIATIVE_NAME_MAX = 120;
export const INITIATIVE_GOAL_MAX = 255;
/** PRs a not-tracked project opens since it was set so, at least, before
 * Decide asks whether it's still not tracked (grew) */
export const GROWTH_FLOOR = 30;

/** One project's home: when it was filed there and by whom, and for Not
 * tracked, its PR count then (the growth check's starting point). */
export interface Filing {
   project: string;
   set_by: string | null;
   /** epoch secs */
   set_at: number;
   baseline_prs: number;
}

export interface Initiative {
   id: number;
   slug: string;
   name: string;
   kind: InitiativeKind;
   goal: string;
   owner: string | null;
   /** its rank: lower comes first; never the plans' priority */
   priority: number;
   status: InitiativeStatus;
   /** when its status was last set (epoch secs), Keep open included; null
    * before anyone has */
   status_at: number | null;
   created_by: string | null;
   created_at: number | null;
   updated_by: string | null;
   updated_at: number | null;
   /** the projects filed in it, by slug */
   projects: Filing[];
}

/** An initiative's dates, read off its projects' plans (initiativeSpan). */
export interface InitiativeSpan {
   /** the earliest start of its plans, done ones included; null with none */
   start: string | null;
   /** the latest end among its plans under way that have one */
   end: string | null;
   /** its plans under way with an end */
   with_end: number;
   /** its plans under way with no end */
   ongoing: number;
   /** derived, never stored: soft when a plan under way has an end, ongoing
    * when one runs with none, ended when only finished plans are left (on
    * `ended`), null with no plans */
   end_kind: 'soft' | 'ongoing' | 'ended' | null;
   /** the latest end of its done plans, when end_kind is ended */
   ended: string | null;
}

/**
 * An initiative's span from the plans of the projects in it. Parked and
 * dropped plans don't count; done ones count toward the start and, when
 * nothing is under way, say when it ended. Projects with no plan add
 * nothing.
 */
export function initiativeSpan(
   projects: readonly string[],
   items: readonly Pick<RoadmapItem, 'project' | 'status' | 'start' | 'weeks' | 'end_kind'>[]
): InitiativeSpan {
   const mine = new Set(projects);
   const plans = items.filter(
      i => i.project && mine.has(i.project) && i.status !== 'parked' && i.status !== 'dropped'
   );
   const going = plans.filter(i => isUnderWay(i.status));
   const ends = going.map(endOf).filter((e): e is string => e != null);
   const doneEnds = plans
      .filter(i => i.status === 'done')
      .map(endOf)
      .filter((e): e is string => e != null);
   const latest = (days: string[]) => (days.length ? days.reduce((a, b) => (b > a ? b : a)) : null);
   const starts = plans.map(i => i.start);
   const ongoing = going.length - ends.length;
   const end_kind = ends.length
      ? 'soft'
      : ongoing
      ? 'ongoing'
      : plans.length
      ? 'ended'
      : null;
   return {
      start: starts.length ? starts.reduce((a, b) => (b < a ? b : a)) : null,
      end: latest(ends),
      with_end: ends.length,
      ongoing,
      end_kind,
      ended: end_kind === 'ended' ? latest(doneEnds) : null,
   };
}

/** Each filed project's home, by slug. */
export function homesOf<I extends Pick<Initiative, 'projects'>>(
   initiatives: readonly I[]
): Map<string, { initiative: I; filing: Filing }> {
   const out = new Map<string, { initiative: I; filing: Filing }>();
   for (const initiative of initiatives) {
      for (const filing of initiative.projects) out.set(filing.project, { initiative, filing });
   }
   return out;
}

/** Whether a not-tracked project has grown enough to ask about again: as
 * many PRs since it was set not tracked as it had then, and GROWTH_FLOOR. */
export function grew(since: number, baseline: number): boolean {
   return since >= Math.max(baseline, GROWTH_FLOOR);
}

/**
 * The projects among `slugs` still going: a plan under way, or PRs open
 * (`open`, by slug). The one rule for an initiative's work: it closes only
 * once none is left, Decide asks whether it reached its goal only then, and
 * a closed one with any is asked to reopen.
 */
export function goingProjects(
   slugs: readonly string[],
   items: readonly Pick<RoadmapItem, 'project' | 'status'>[],
   open: (slug: string) => number
): string[] {
   const planned = new Set(
      items.filter(i => i.project && isUnderWay(i.status)).map(i => i.project as string)
   );
   return slugs.filter(slug => planned.has(slug) || open(slug) > 0);
}

export type InitiativeFields = Pick<Initiative, 'slug' | 'name' | 'kind' | 'goal' | 'owner' | 'status'>;

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * Check what a person sent for an initiative, and clean it: the name and
 * goal trimmed to one line. A new one (`partial: false`) needs a slug and a
 * name; an edit may send any of name, goal, owner and status (the slug and
 * kind stay as made). Returns the clean fields, or the first problem in
 * words fit to show the person.
 */
export function checkInitiativeFields(
   input: unknown,
   { partial }: { partial: boolean }
): { fields: Partial<InitiativeFields> } | { error: string } {
   if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { error: 'send the initiative as a JSON object' };
   }
   const raw = input as Record<string, unknown>;
   const fields: Partial<InitiativeFields> = {};
   const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
   const line = (v: string) => v.replace(/\s+/g, ' ').trim();
   if (!partial) {
      if (typeof raw.slug !== 'string' || !PROJECT_SLUG.test(raw.slug)) {
         return { error: 'an initiative needs a slug, like site-speed' };
      }
      fields.slug = raw.slug;
      if (has('kind')) {
         if (!INITIATIVE_KINDS.includes(raw.kind as InitiativeKind)) {
            return { error: `kind is one of ${INITIATIVE_KINDS.join(', ')}` };
         }
         fields.kind = raw.kind as InitiativeKind;
      }
   } else if (has('slug') || has('kind')) {
      return { error: 'an initiative keeps the slug and kind it was made with' };
   }
   if (has('name') || !partial) {
      const name = typeof raw.name === 'string' ? line(raw.name) : '';
      if (!name) return { error: 'an initiative needs a name' };
      if (name.length > INITIATIVE_NAME_MAX) {
         return { error: `keep the name to ${INITIATIVE_NAME_MAX} characters` };
      }
      fields.name = name;
   }
   if (has('goal')) {
      if (raw.goal == null || raw.goal === '') fields.goal = '';
      else if (typeof raw.goal !== 'string') return { error: 'the goal is a line of text' };
      else if (line(raw.goal).length > INITIATIVE_GOAL_MAX) {
         return { error: `keep the goal to ${INITIATIVE_GOAL_MAX} characters` };
      } else fields.goal = line(raw.goal);
   }
   if (has('owner')) {
      if (raw.owner == null || raw.owner === '') fields.owner = null;
      else if (typeof raw.owner !== 'string' || !LOGIN.test(raw.owner.trim())) {
         return { error: 'the owner must be a GitHub login' };
      } else fields.owner = raw.owner.trim();
   }
   if (has('status')) {
      if (!partial) return { error: 'a new initiative starts open' };
      if (!INITIATIVE_STATUSES.includes(raw.status as InitiativeStatus)) {
         return { error: `status is one of ${INITIATIVE_STATUSES.join(', ')}` };
      }
      fields.status = raw.status as InitiativeStatus;
   }
   return { fields };
}
