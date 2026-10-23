import { answeredOnItsOwn, DECIDE_MIN_PRS, type DecideRow } from './decide';
import { slugName } from './projectLabel';
import { utcDay } from './projects';
import { isUnderWay, mondayOf, planEnd, type RoadmapItem } from './roadmap';

/**
 * The calls Pulldasher makes on the roadmap itself, from what already
 * happened, so a plan follows the work without anyone answering Decide:
 * - picked up again: a plan parked, done or dropped whose project gets a PR
 *   opened, or an open PR labeled into it, after that status was set, is
 *   in progress again (only the project's latest plan, and only when none
 *   of its plans is under way)
 * - put down: a plan in progress whose project had no PR opened, merged or
 *   pushed to for `idleDays`, and whose status nobody changed in that
 *   time, is parked
 * - finished: a plan under way whose issue closed, or all of whose issues
 *   closed, with none of its PRs open, is done (dropped when they were
 *   closed as not planned); one past its hard end with none open, its
 *   status untouched since, is done (model/decide.ts answeredOnItsOwn)
 * - new: a project Decide would ask a first plan of, that never had one
 *   (not even one since removed), gets one in progress, with no end
 * - lead: a plan with no lead gets its project issue's assignee, else the
 *   author with the most PRs in its project over the last LEAD_DAYS; a lead
 *   someone set is never replaced
 * Pure: the server reads the inputs and writes the calls (lib/auto-calls.js).
 * A person's write always wins, since each rule only reads changes made
 * after the last status change, and Decide stops asking what this answers.
 */

/** days with no PR activity before a plan in progress is put down: the
 * default for config.js projects.idleDays */
export const IDLE_DAYS = 28;
/** how far back a plan's lead is read from its project's PRs */
export const LEAD_DAYS = 60;
/** the login Pulldasher's own calls are recorded as */
export const AUTO_LOGIN = 'pulldasher';
const NAME_MAX = 120;
const DAY = 86400;

/** A project's PR as the calls read it: people's only, drafts left out. */
export interface AutoPull {
   repo: string;
   number: number;
   author: string;
   /** epoch secs it opened, or was marked ready for a former draft */
   opened: number;
   merged: number | null;
   /** epoch secs of its last push; null when not known */
   pushed: number | null;
   open: boolean;
   /** epoch secs its project label was put on; null when it joins by a link */
   labeledAt: number | null;
}

/** A plan's fields a new plan is written with. */
export interface NewPlan {
   name: string;
   project: string;
   status: 'active';
   start: string;
   end_kind: 'ongoing';
   lead: string | null;
}

export type AutoCall =
   /** change a plan's status from `from`: a call, recorded as AUTO_LOGIN's */
   | {
        kind: 'status';
        id: number;
        from: RoadmapItem['status'];
        status: RoadmapItem['status'];
        note: string;
     }
   /** fill a plan's empty lead; not a call, so the plan's other questions stand */
   | { kind: 'lead'; id: number; lead: string; note: string }
   | { kind: 'new'; fields: NewPlan; note: string };

/** When a plan's status was last set, as near as the row knows. */
const statusAt = (item: RoadmapItem) => item.status_at ?? item.created_at ?? item.updated_at ?? 0;

/** The author with the most of these PRs open, or opened or merged since
 * `since`, and how many; ties go to the first login alphabetically. */
export function leadOf(
   pulls: readonly AutoPull[],
   since: number
): { login: string; prs: number } | null {
   const counts = new Map<string, number>();
   for (const p of pulls) {
      if (p.open || p.opened >= since || (p.merged ?? 0) >= since) {
         counts.set(p.author, (counts.get(p.author) ?? 0) + 1);
      }
   }
   const [best] = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
   return best ? { login: best[0], prs: best[1] } : null;
}

/** A project's lead and why: its issue's assignee, someone's choice, else
 * its busiest author lately (leadOf). */
function leadFor(
   assignee: string | undefined,
   pulls: readonly AutoPull[],
   now: number
): { login: string; note: string } | null {
   if (assignee) return { login: assignee, note: `Lead: ${assignee}, its issue's assignee` };
   const lead = leadOf(pulls, now - LEAD_DAYS * DAY);
   return (
      lead && {
         login: lead.login,
         note: `Lead: ${lead.login}, with the most PRs here in the last ${LEAD_DAYS} days (${lead.prs})`,
      }
   );
}

/** The PR that picked a project up after `since`: the first one opened, or
 * open and labeled into it, after then, with when. */
function pickedUpBy(pulls: readonly AutoPull[], since: number) {
   const after = pulls.flatMap(p => {
      if (p.opened > since) return [{ pull: p, at: p.opened }];
      if (p.open && p.labeledAt != null && p.labeledAt > since)
         return [{ pull: p, at: p.labeledAt }];
      return [];
   });
   return after.sort((a, b) => a.at - b.at)[0] ?? null;
}

/** The newest PR opened, merged or pushed to; null with none. */
const lastActivity = (pulls: readonly AutoPull[]) =>
   pulls.reduce<number | null>(
      (last, p) => Math.max(last ?? 0, p.opened, p.merged ?? 0, p.pushed ?? 0),
      null
   );

export function autoCalls({
   rows,
   items,
   pulls,
   planned,
   names = new Map(),
   leads = new Map(),
   ongoing = new Set(),
   idleDays = IDLE_DAYS,
   now,
}: {
   /** Decide's queue asked without `auto`: what happened, as it reads it */
   rows: readonly DecideRow[];
   /** the plans, tracked projects' only, as Decide was given them */
   items: readonly RoadmapItem[];
   /** each project's PRs, by slug */
   pulls: ReadonlyMap<string, readonly AutoPull[]>;
   /** every project that has, or ever had, a plan (removed ones too), so a
    * plan someone removed isn't made again */
   planned: ReadonlySet<string>;
   /** the name its issue gives a project, by slug */
   names?: ReadonlyMap<string, string>;
   /** its issue's assignee, by slug */
   leads?: ReadonlyMap<string, string>;
   /** projects that run with no end: a finished plan of theirs isn't
    * picked up again by the work that follows (as Decide's `reopened`) */
   ongoing?: ReadonlySet<string>;
   idleDays?: number;
   /** epoch secs */
   now: number;
}): AutoCall[] {
   const calls: AutoCall[] = [];
   const moved = new Set<number>();
   const setStatus = (item: RoadmapItem, status: RoadmapItem['status'], note: string) => {
      if (moved.has(item.id) || item.status === status) return;
      moved.add(item.id);
      calls.push({ kind: 'status', id: item.id, from: item.status, status, note });
   };

   // finished, and new: what Decide reads off the issues, the end and the PRs
   for (const row of rows) {
      for (const r of row.reasons) {
         const item = row.item;
         if (r.kind === 'new' && row.slug && !item && !planned.has(row.slug)) {
            calls.push(newPlan(row.slug, r.since));
            continue;
         }
         if (!item || !isUnderWay(item.status) || !answeredOnItsOwn(r, item)) continue;
         if (r.kind === 'issue_closed') {
            const as = r.as === 'dropped' ? 'not planned' : 'completed';
            setStatus(item, r.as, `Finished: its issue was closed as ${as} on ${r.on}`);
         } else if (r.kind === 'issues_done') {
            const all = r.done + r.dropped;
            const status = r.done === 0 ? 'dropped' : 'done';
            setStatus(item, status, `Finished: all ${all} of its issues are closed, no PRs open`);
         } else if (r.kind === 'ended') {
            setStatus(item, 'done', `Finished: its end, ${planEnd(item)}, passed with no PRs open`);
         }
      }
   }

   const plansOf = new Map<string, RoadmapItem[]>();
   for (const item of items) {
      if (item.project) plansOf.set(item.project, [...(plansOf.get(item.project) ?? []), item]);
   }
   for (const [slug, plans] of plansOf) {
      const prs = pulls.get(slug) ?? [];
      // picked up again: only the project's latest plan, with none under way
      if (!plans.some(p => isUnderWay(p.status))) {
         const last = [...plans].sort((a, b) => statusAt(b) - statusAt(a) || b.id - a.id)[0];
         const finished = last.status === 'done' || last.status === 'dropped';
         const by = finished && ongoing.has(slug) ? null : pickedUpBy(prs, statusAt(last));
         if (by) {
            setStatus(
               last,
               'active',
               `Picked up again by ${by.pull.repo}#${by.pull.number} on ${utcDay(by.at)}`
            );
         }
      }
      // put down: in progress, and nothing moved, its status included
      for (const item of plans) {
         if (item.status !== 'active') continue;
         const pr = lastActivity(prs);
         if (now - Math.max(pr ?? 0, statusAt(item)) < idleDays * DAY) continue;
         setStatus(
            item,
            'parked',
            pr == null
               ? `Put down: no PRs in ${idleDays} days`
               : `Put down: no PR opened, merged or pushed to since ${utcDay(pr)}`
         );
      }
   }

   // a lead for each plan with none, read off its project's PRs
   for (const item of items) {
      if (item.lead || !item.project) continue;
      const lead = leadFor(leads.get(item.project), pulls.get(item.project) ?? [], now);
      if (lead) calls.push({ kind: 'lead', id: item.id, lead: lead.login, note: lead.note });
   }
   return calls;

   function newPlan(slug: string, since: string | null): AutoCall {
      const prs = pulls.get(slug) ?? [];
      const first = prs.reduce<number | null>((a, p) => Math.min(a ?? p.opened, p.opened), null);
      const lead = leadFor(leads.get(slug), prs, now);
      const name = (names.get(slug) ?? slugName(slug)).slice(0, NAME_MAX).trim();
      return {
         kind: 'new',
         fields: {
            name,
            project: slug,
            status: 'active',
            start: mondayOf(first != null ? utcDay(first) : since ?? utcDay(now)),
            end_kind: 'ongoing',
            lead: lead?.login ?? null,
         },
         note:
            `Planned on its own: ${DECIDE_MIN_PRS} or more PRs and no plan` +
            (lead ? `. ${lead.note}` : ''),
      };
   }
}
