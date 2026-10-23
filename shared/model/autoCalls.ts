import {
   answeredOnItsOwn,
   lastPlan,
   DECIDE_MIN_PRS,
   type ClosedIssue,
   type DecideReason,
   type DecideRow,
} from './decide';
import { slugName } from './projectLabel';
import { utcDay, LIVE_DAYS } from './projects';
import { isUnderWay, mondayOf, planEnd, type RoadmapItem } from './roadmap';

/**
 * The calls Pulldasher makes on the roadmap itself, from what already
 * happened, so a plan follows the work without anyone answering Decide:
 * - picked up again: a parked plan whose project gets a PR opened, or an
 *   open PR a person labeled into it, after that status was set, is in
 *   progress again; a done or dropped one takes RETURN_PRS of them, since
 *   one fix after a finish isn't a return (only the project's latest plan,
 *   only when none of its plans is under way, and never once its issue
 *   closed since). The job's labels never wake a plan by when they went
 *   on, only by when their PR opened
 * - put down: a plan in progress whose project had no PR opened, merged or
 *   pushed to for `idleDays`, with no update posted and no change by a
 *   person in that time, is parked
 * - finished: a plan under way whose issue closed, or all of whose issues
 *   closed, with none of its PRs open, is done (dropped when they were
 *   closed as not planned); one past its hard end with none open, its
 *   status untouched since, is done (model/decide.ts answeredOnItsOwn).
 *   Never an ongoing plan: upkeep has no end, so it parks when idle
 * - new: a project with DECIDE_MIN_PRS or more PRs open or merged in the
 *   last LIVE_DAYS, that never had a plan (not even one since removed),
 *   gets one in progress, with no end; put down parks it once it's idle.
 *   Unlike Decide's `new`, a burst that already merged counts too
 * - lead: a plan under way with no lead, whose status this pass leaves
 *   alone, and that no person changed since its project's latest PR
 *   activity (they may have cleared it), gets its project issue's
 *   assignee, else the author with the most PRs in its project over the
 *   last LEAD_DAYS; a lead someone set is never replaced
 * The job's labels count toward a pick-up or a new plan only once they
 * are `settleDays` old.
 * Pure: the server reads the inputs and writes the calls (lib/auto-calls.js).
 * A person's write always wins, since each rule only reads changes made
 * after the last status change. Decide leaves out only what a call made
 * this pass answers (withoutAnswered).
 */

/** days with no PR activity before a plan in progress is put down: the
 * default for config.js projects.idleDays */
export const IDLE_DAYS = 28;
/** how far back a plan's lead is read from its project's PRs */
export const LEAD_DAYS = 60;
/** the login Pulldasher's own calls are recorded as */
export const AUTO_LOGIN = 'pulldasher';
/** PRs a done or dropped plan takes after its finish to be picked up again */
export const RETURN_PRS = 2;
/** days the labeling job's label on a PR waits before it counts toward a
 * pick-up or a new plan: the default for config.js projects.settleDays.
 * The job re-sorts its own filings at each sweep, so a fresh one is still
 * a guess; a person's label counts at once */
export const SETTLE_DAYS = 3;
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
   /** who put its project label on (projectLabel.ts labeledBy); null when
    * it joins by a link */
   by: 'person' | 'job' | null;
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
   /** change a plan's status from `from`, set at `fromAt` (its status_at
    * as read, null when not stored): a call, recorded as AUTO_LOGIN's */
   | {
        kind: 'status';
        id: number;
        from: RoadmapItem['status'];
        fromAt: number | null;
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

/** Whether a PR counts toward a call yet: a person's label, or one that
 * joins by a link, at once; the job's once it's `settleDays` old. */
const settled = (p: AutoPull, now: number, settleDays: number) =>
   p.by !== 'job' || (p.labeledAt != null && now - p.labeledAt >= settleDays * DAY);

/** The PRs that came to a project after `since`, each opened, or open and
 * labeled into it by a person, after then, with when, first first. The
 * job labeling an old PR (a seed run's filing) isn't new work. */
function cameAfter(pulls: readonly AutoPull[], since: number) {
   const after = pulls.flatMap(p => {
      if (p.opened > since) return [{ pull: p, at: p.opened }];
      if (p.by !== 'job' && p.open && p.labeledAt != null && p.labeledAt > since)
         return [{ pull: p, at: p.labeledAt }];
      return [];
   });
   return after.sort((a, b) => a.at - b.at);
}

/** When a plan was last touched by a person or an update, as far as the
 * row says: its latest update, and its last change unless Pulldasher made
 * it. */
const lastTouched = (item: RoadmapItem) =>
   Math.max(
      item.update?.at ?? 0,
      item.updated_by && item.updated_by !== AUTO_LOGIN ? item.updated_at ?? 0 : 0
   );

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
   closed = new Map(),
   untracked = new Set(),
   idleDays = IDLE_DAYS,
   settleDays = SETTLE_DAYS,
   timeZone,
   now,
}: {
   /** Decide's queue: what happened, as it reads it */
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
   /** closed project issues, by slug (decide.ts closedIssues): one closed
    * after a plan stopped is the news, so the plan isn't picked up */
   closed?: ReadonlyMap<string, ClosedIssue>;
   /** Not tracked projects (initiatives.ts), which `pulls` holds too: never
    * given a plan */
   untracked?: ReadonlySet<string>;
   idleDays?: number;
   settleDays?: number;
   /** the team's (projects.timeZone), for the day a plan ends */
   timeZone?: string;
   /** epoch secs */
   now: number;
}): AutoCall[] {
   const counted = (prs: readonly AutoPull[]) => prs.filter(p => settled(p, now, settleDays));
   const calls: AutoCall[] = [];
   const moved = new Set<number>();
   const setStatus = (item: RoadmapItem, status: RoadmapItem['status'], note: string) => {
      if (moved.has(item.id) || item.status === status) return;
      moved.add(item.id);
      calls.push({
         kind: 'status',
         id: item.id,
         from: item.status,
         fromAt: item.status_at ?? null,
         status,
         note,
      });
   };

   // finished, and new: what Decide reads off the issues, the end and the PRs
   for (const row of rows) {
      for (const r of row.reasons) {
         const item = row.item;
         if (!item || !isUnderWay(item.status) || !answeredOnItsOwn(r, item, timeZone)) continue;
         // upkeep has no end: closed issues mean nothing is asked of it right
         // now, not that it's finished; it parks once it's idle instead
         if (item.end_kind === 'ongoing') continue;
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

   // new: enough PRs open or merged lately, and no plan ever; Decide asks
   // its own `new` with every PR, but only while one is open
   for (const [slug, prs] of pulls) {
      if (planned.has(slug) || untracked.has(slug) || ongoing.has(slug) || closed.has(slug))
         continue;
      const live = counted(prs).filter(p => p.open || (p.merged ?? 0) >= now - LIVE_DAYS * DAY);
      if (live.length >= DECIDE_MIN_PRS) calls.push(newPlan(slug, live));
   }

   // in Decide's order, so lastPlan breaks a tie as it does
   const plansOf = new Map<string, RoadmapItem[]>();
   for (const item of [...items].sort((a, b) => a.priority - b.priority || a.id - b.id)) {
      if (item.project) plansOf.set(item.project, [...(plansOf.get(item.project) ?? []), item]);
   }
   for (const [slug, plans] of plansOf) {
      const prs = pulls.get(slug) ?? [];
      // picked up again: only the plan Decide reads for the project, with
      // none under way, and not when its issue closed since: that's asked
      const last = plans.some(p => isUnderWay(p.status)) ? null : lastPlan(plans);
      const issue = closed.get(slug);
      // the issue closed after the plan's last change, as Decide reads it
      if (last && !(issue && issue.at > (last.updated_at ?? 0))) {
         const finished = last.status === 'done' || last.status === 'dropped';
         const after = finished && ongoing.has(slug) ? [] : cameAfter(counted(prs), statusAt(last));
         if (after.length >= (finished ? RETURN_PRS : 1)) {
            const at = (p: { pull: AutoPull; at: number }) =>
               `${p.pull.repo}#${p.pull.number} on ${utcDay(p.at)}`;
            setStatus(
               last,
               'active',
               finished
                  ? `Picked up again: ${after.length} PRs since it was marked ${last.status}, ` +
                       `the latest ${at(after[after.length - 1])}`
                  : `Picked up again by ${at(after[0])}`
            );
         }
      }
      // put down: in progress, and nothing moved, its status included
      for (const item of plans) {
         if (item.status !== 'active') continue;
         const pr = lastActivity(prs);
         const last = Math.max(pr ?? 0, statusAt(item), lastTouched(item));
         if (now - last < idleDays * DAY) continue;
         setStatus(
            item,
            'parked',
            pr == null
               ? `Put down: no PRs in ${idleDays} days`
               : `Put down: no PR opened, merged or pushed to since ${utcDay(pr)}`
         );
      }
   }

   // a lead for each plan under way with none, read off its project's PRs;
   // a plan whose status moved this pass keeps that call's note
   for (const item of items) {
      if (item.lead || !item.project || !isUnderWay(item.status) || moved.has(item.id)) continue;
      const prs = pulls.get(item.project) ?? [];
      // a person changed it since its PRs last moved: an empty lead may be theirs
      const byPerson = item.updated_by != null && item.updated_by !== AUTO_LOGIN;
      if (byPerson && (item.updated_at ?? 0) > (lastActivity(prs) ?? 0)) continue;
      const lead = leadFor(leads.get(item.project), prs, now);
      if (lead) calls.push({ kind: 'lead', id: item.id, lead: lead.login, note: lead.note });
   }
   return calls;

   // starts the week of its first open PR, else of the first that counted
   function newPlan(slug: string, live: readonly AutoPull[]): AutoCall {
      const prs = pulls.get(slug) ?? [];
      const open = live.filter(p => p.open);
      const first = Math.min(...(open.length ? open : live).map(p => p.opened));
      const lead = leadFor(leads.get(slug), prs, now);
      const name = (names.get(slug) ?? slugName(slug)).slice(0, NAME_MAX).trim();
      return {
         kind: 'new',
         fields: {
            name,
            project: slug,
            status: 'active',
            start: mondayOf(utcDay(first)),
            end_kind: 'ongoing',
            lead: lead?.login ?? null,
         },
         note:
            `Planned on its own: ${live.length} PRs open or merged in the last ${LIVE_DAYS} days ` +
            'and no plan' +
            (lead ? `. ${lead.note}` : ''),
      };
   }
}

/** The reasons each kind of status call answers, by the status it sets:
 * a finished plan is asked nothing more ('all'). */
const ANSWERS: Record<RoadmapItem['status'], DecideReason['kind'][] | 'all'> = {
   active: ['reopened', 'moving'],
   done: 'all',
   dropped: 'all',
   parked: [],
   planned: [],
};

/**
 * Decide's rows without what this pass's calls answer: a plan's reasons its
 * status call settles, and `new` on a project a new plan is made for. A
 * row with nothing left goes. Everything no call answers is still asked:
 * work that moved with no new PR, a finish whose PRs are open, a plan
 * someone removed.
 */
export function withoutAnswered(
   rows: readonly DecideRow[],
   calls: readonly AutoCall[]
): DecideRow[] {
   const byItem = new Map<number, DecideReason['kind'][] | 'all'>();
   const planned = new Set<string>();
   for (const c of calls) {
      if (c.kind === 'status') byItem.set(c.id, ANSWERS[c.status]);
      else if (c.kind === 'new') planned.add(c.fields.project);
   }
   return rows.flatMap(row => {
      const answered = row.item
         ? byItem.get(row.item.id) ?? []
         : row.slug && planned.has(row.slug)
         ? ['new']
         : [];
      const reasons = row.reasons.filter(r => answered !== 'all' && !answered.includes(r.kind));
      if (reasons.length === row.reasons.length) return [row];
      return reasons.length ? [{ ...row, reasons }] : [];
   });
}
