import { REPO_PATTERN, issueKey, type IssueRef } from './issueRef';
import { dayStart } from './projects';
import { planEnd, type RoadmapItem } from './roadmap';

export { issueKey, parseIssueRef, type IssueRef } from './issueRef';

/**
 * A plan's scope: the issues that say what the plan delivers. A plan names
 * one issue that specs it (usually an epic); the scope is that issue's
 * sub-issues and its checklist lines, plus issues carrying the project's
 * label. A project with several plans over time (a launch, then its
 * feedback round) splits its work between them by date: a PR or an issue
 * belongs to the latest plan that had started when it arrived, unless it
 * links an issue in another plan's scope.
 *
 * Done is a person's call. The scope only tells Decide when to ask
 * ("Done?") and the project page what arrived after the plan's end.
 * Pure, like the rest of shared/: the server builds it from its tables and
 * the board renders it, so they can't disagree.
 */

const DAY = 86400;

/** A PR opened within this many days of a plan being marked done or
 * dropped is its tail, not a comeback (decide.ts REOPEN_DAYS agrees). */
export const TAIL_DAYS = 7;

/** The first issue a line of text names: a URL, "owner/repo#123", or
 * "#123" in `repo`. Null when it names none. */
function firstRef(text: string, repo: string): IssueRef | null {
   const found = [
      new RegExp(`https?://github\\.com/(${REPO_PATTERN})/(?:issues|pull)/(\\d+)`, 'i').exec(text),
      new RegExp(`(?:^|[\\s(\\[])(${REPO_PATTERN})#(\\d+)\\b`).exec(text),
      /(?:^|[\s([])#(\d+)\b/.exec(text),
   ]
      .filter((m): m is RegExpExecArray => m != null)
      .sort((a, b) => a.index - b.index)[0];
   if (!found) return null;
   return found.length === 3
      ? { repo: found[1], number: Number(found[2]) }
      : { repo, number: Number(found[1]) };
}

/** One line of a spec issue's checklist. */
export interface ChecklistLine {
   checked: boolean;
   /** the line's words, without its box */
   text: string;
   /** the issue it stands for; null for a plain line */
   ref: IssueRef | null;
}

/**
 * The checklist in an issue's body: every "- [ ]" or "- [x]" line ("*" and
 * "+" too), outside fenced code. A line naming an issue stands for that
 * issue, the first one named: "- [x] #63236 (PR up: #63445)" stands for
 * #63236. Every other line is a plain line, done when checked.
 */
export function parseChecklist(body: string | null, repo: string): ChecklistLine[] {
   const lines: ChecklistLine[] = [];
   let fenced = false;
   for (const raw of (body ?? '').split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(raw)) fenced = !fenced;
      if (fenced) continue;
      const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/.exec(raw);
      if (!m) continue;
      lines.push({ checked: m[1] !== ' ', text: m[2], ref: firstRef(m[2], repo) });
   }
   return lines;
}

/** Where an item stands: still to do, done, or dropped (closed as not
 * planned or duplicate). */
export type ItemState = 'open' | 'done' | 'dropped';

/** An issue's state and close reason as one of the three. */
export function itemState(state: string | null, reason: string | null): ItemState {
   if (state?.toLowerCase() !== 'closed') return 'open';
   const why = reason?.toLowerCase();
   return why === 'not_planned' || why === 'duplicate' ? 'dropped' : 'done';
}

/** One thing in a plan's scope. */
export interface ScopeItem {
   /** how it's in: a sub-issue of the spec, a checklist line, or the project label */
   source: 'sub' | 'check' | 'label';
   /** the issue; null for a plain checklist line */
   ref: IssueRef | null;
   title: string;
   state: ItemState;
   /** epoch secs it closed; null while open or when not known */
   closedAt: number | null;
   /** epoch secs it joined the scope; null when not known (a checklist line) */
   joinedAt: number | null;
   /** the PRs that close or mention it (planScopes fills these in) */
   prs?: LinkedPull[];
}

/** A PR linked to a scope item: its title and state when it's one of the
 * project's PRs, else just its number. */
export interface LinkedPull {
   repo: string;
   number: number;
   title: string | null;
   state: 'open' | 'merged' | 'closed' | null;
}

/** A PR as the scope reads it. */
export interface WorkPull {
   repo: string;
   number: number;
   title: string;
   author: string;
   /** epoch secs */
   createdAt: number;
   mergedAt: number | null;
   state: 'open' | 'closed';
}

/**
 * Which of a project's plans a piece of work belongs to: the one plan whose
 * scope it links, if exactly one; else the latest plan that had started by
 * `at`, or the earliest plan when it came before them all. Null for a
 * project with no plans.
 */
export function planOfWork(
   plans: readonly RoadmapItem[],
   at: number,
   linked: ReadonlySet<number> = new Set()
): RoadmapItem | null {
   const mine = plans.filter(p => linked.has(p.id));
   if (mine.length === 1) return mine[0];
   const pool = mine.length ? mine : plans;
   const sorted = [...pool].sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
   const started = sorted.filter(p => (dayStart(p.start) as number) <= at);
   return started[started.length - 1] ?? sorted[0] ?? null;
}

/** The first moment after a plan's last planned day. */
export function afterEndOf(plan: Pick<RoadmapItem, 'start' | 'weeks'>): number {
   return (dayStart(planEnd(plan)) as number) + DAY;
}

/** A plan's scope and what arrived after it, as the project page and
 * Decide read them. */
export interface PlanScope {
   planId: number;
   /** the issue that specs it, as the plan names it */
   spec: IssueRef | null;
   specTitle: string | null;
   /** whether the spec issue could be read; false when GitHub said no such issue */
   specFound: boolean;
   items: ScopeItem[];
   done: number;
   dropped: number;
   open: number;
   /** items that joined after the plan was made */
   added: number;
   /** its project's PRs that belong to it and opened after its end, oldest first */
   afterEnd: WorkPull[];
   /** of those (or any of its PRs, for a plan marked done or dropped), the
    * ones opened more than TAIL_DAYS after it was marked so */
   afterDone: WorkPull[];
}

/** What every plan's scope is built from: the server reads it out of its tables. */
export interface ScopeInputs {
   plans: readonly RoadmapItem[];
   /** each spec issue's items, by issueKey(spec) */
   specs: ReadonlyMap<string, { title: string | null; found: boolean; items: ScopeItem[] }>;
   /** issues carrying a project's label, by slug, the label's time as joinedAt */
   labeled: ReadonlyMap<string, ScopeItem[]>;
   /** a project's PRs (people's, not bots'), by slug */
   pulls: ReadonlyMap<string, WorkPull[]>;
   /** the scope issues each PR links, by issueKey(pr) */
   links: ReadonlyMap<string, IssueRef[]>;
}

/**
 * Every plan's scope. Labeled issues go to the plan that had started when
 * they were labeled (an issue already in some plan's spec stays there). A
 * PR goes to the plan whose scope it links, else by its opening date.
 */
export function planScopes({ plans, specs, labeled, pulls, links }: ScopeInputs): PlanScope[] {
   const byProject = new Map<string, RoadmapItem[]>();
   for (const plan of plans) {
      if (plan.project) byProject.set(plan.project, [...(byProject.get(plan.project) ?? []), plan]);
   }
   // which plans each issue is in through a spec, for links and for keeping
   // a labeled issue in the spec that already holds it
   const specPlans = new Map<string, Set<number>>();
   const items = new Map<number, ScopeItem[]>();
   for (const plan of plans) {
      const spec = plan.spec ? specs.get(issueKey(plan.spec)) : undefined;
      const list = spec ? [...spec.items] : [];
      items.set(plan.id, list);
      for (const item of list) {
         if (!item.ref) continue;
         const k = issueKey(item.ref);
         specPlans.set(k, new Set([...(specPlans.get(k) ?? []), plan.id]));
      }
   }
   for (const [slug, issues] of labeled) {
      const mine = byProject.get(slug) ?? [];
      for (const issue of issues) {
         const k = issue.ref ? issueKey(issue.ref) : '';
         const inSpec = [...(specPlans.get(k) ?? [])].some(id => mine.some(p => p.id === id));
         if (inSpec) continue;
         const plan = planOfWork(mine, issue.joinedAt ?? 0);
         if (plan) items.get(plan.id)?.push(issue);
      }
   }
   const afterEnd = new Map<number, WorkPull[]>();
   const afterDone = new Map<number, WorkPull[]>();
   for (const [slug, prs] of pulls) {
      const mine = byProject.get(slug) ?? [];
      if (!mine.length) continue;
      for (const pr of prs) {
         const linked = new Set<number>();
         for (const ref of links.get(issueKey(pr)) ?? []) {
            for (const id of specPlans.get(issueKey(ref)) ?? []) linked.add(id);
         }
         const plan = planOfWork(mine, pr.createdAt, linked);
         if (!plan) continue;
         if (pr.createdAt >= afterEndOf(plan)) {
            afterEnd.set(plan.id, [...(afterEnd.get(plan.id) ?? []), pr]);
         }
         const stopped = plan.status === 'done' || plan.status === 'dropped';
         if (
            stopped &&
            plan.updated_at != null &&
            pr.createdAt > plan.updated_at + TAIL_DAYS * DAY
         ) {
            afterDone.set(plan.id, [...(afterDone.get(plan.id) ?? []), pr]);
         }
      }
   }
   const byTime = (a: WorkPull, b: WorkPull) => a.createdAt - b.createdAt || a.number - b.number;
   // each scope issue's PRs, with titles and states for the projects' own
   const known = new Map([...pulls.values()].flat().map(p => [issueKey(p), p]));
   const prsOf = new Map<string, LinkedPull[]>();
   for (const [pr, issues] of links) {
      const p = known.get(pr);
      const at = pr.lastIndexOf('#');
      const linked: LinkedPull = {
         repo: pr.slice(0, at),
         number: Number(pr.slice(at + 1)),
         title: p?.title ?? null,
         state: !p ? null : p.mergedAt != null ? 'merged' : p.state,
      };
      for (const ref of issues)
         prsOf.set(issueKey(ref), [...(prsOf.get(issueKey(ref)) ?? []), linked]);
   }
   return plans.map(plan => {
      const spec = plan.spec ? specs.get(issueKey(plan.spec)) : undefined;
      const list = (items.get(plan.id) ?? []).map(item =>
         item.ref ? { ...item, prs: prsOf.get(issueKey(item.ref)) ?? [] } : item
      );
      const count = (state: ItemState) => list.filter(i => i.state === state).length;
      return {
         planId: plan.id,
         spec: plan.spec ?? null,
         specTitle: spec?.title ?? null,
         specFound: plan.spec ? spec?.found ?? true : true,
         items: list,
         done: count('done'),
         dropped: count('dropped'),
         open: count('open'),
         added: list.filter(
            i => i.joinedAt != null && plan.created_at != null && i.joinedAt > plan.created_at
         ).length,
         afterEnd: (afterEnd.get(plan.id) ?? []).sort(byTime),
         afterDone: (afterDone.get(plan.id) ?? []).sort(byTime),
      };
   });
}

/** What Decide needs from a plan's scope. */
export interface ScopeCounts {
   /** items not dropped */
   total: number;
   done: number;
   dropped: number;
   /** epoch secs the last item closed; null when one closed with no known
    * time (a checked plain line), or none has */
   lastClosedAt: number | null;
   afterEnd: number;
   afterDone: number;
}

export function scopeCounts(scope: PlanScope): ScopeCounts {
   const closed = scope.items.filter(i => i.state !== 'open');
   const times = closed.map(i => i.closedAt);
   return {
      total: scope.done + scope.open,
      done: scope.done,
      dropped: scope.dropped,
      lastClosedAt: !times.length || times.includes(null) ? null : Math.max(...(times as number[])),
      afterEnd: scope.afterEnd.length,
      afterDone: scope.afterDone.length,
   };
}
