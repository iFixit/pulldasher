import { MAX_ISSUE_NUMBER, REPO_PATTERN, issueKey, parseIssueRef, type IssueRef } from './issueRef';
import { dayStart } from './projects';
import { planEnd, type RoadmapItem } from './roadmap';

export { issueKey, issueText, parseIssueRef, type IssueRef } from './issueRef';

/**
 * A plan's scope: the issues that say what the plan delivers. A plan names
 * one issue that specs it (usually an epic); the scope is that issue's
 * sub-issues and its checklist lines, plus issues carrying the project's
 * label. A project with several plans over time (a launch, then its
 * feedback round) splits its work between them by date: a PR or an issue
 * belongs to the latest plan that had started when it arrived, unless it
 * links the scope of one plan that had started by then. An open issue that
 * a later plan's spec lists too has moved there, so it no longer holds the
 * earlier plan open.
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

/** The issue a checklist line stands for: the one its words start with,
 * past any bold or link markup, so "#63236 (PR up: #63445)" stands for
 * #63236. A line that names an issue further in ("keeping the row from
 * #63064") is a plain line: there the issue is context, not the task. */
function leadRef(text: string, repo: string): IssueRef | null {
   const s = text.replace(/^[\s*_`[(]+/, '');
   const m =
      new RegExp(`^https?://github\\.com/(${REPO_PATTERN})/(?:issues|pull)/(\\d+)`, 'i').exec(s) ??
      new RegExp(`^(${REPO_PATTERN})#(\\d+)\\b`).exec(s);
   if (m) return { repo: m[1], number: Number(m[2]) };
   const bare = /^#(\d+)\b/.exec(s);
   return bare ? { repo, number: Number(bare[1]) } : null;
}

// the phrases that make a PR body's mention of an issue a link: iFixit's
// "Parts of #N", and the closing and connecting words GitHub and
// Pulldasher's own body tags read
const LINK_WORDS =
   'parts? of|clos(?:e[sd]?|ing)|fix(?:e[sd]|ing)?|resolv(?:e[sd]?|ing)|connect(?:s|ed)?(?: to)?';
const ONE_REF = `(?:https?://github\\.com/${REPO_PATTERN}/(?:issues|pull)/\\d+|(?:${REPO_PATTERN})?#\\d+)`;

/**
 * The issues a PR's body links on purpose: each one named right after a
 * linking phrase ("Parts of #62502", "fixes iFixit/ops#12", "closes" and
 * an issue link), several after one phrase too ("Parts of #1, #2 and #3").
 * A bare "#N" is in `repo`, the PR's. A passing mention ("unlike #63000")
 * isn't a link.
 */
export function bodyLinks(body: string | null, repo: string): IssueRef[] {
   const phrase = new RegExp(
      `\\b(?:${LINK_WORDS}):?\\s+(${ONE_REF}(?:\\s*(?:,|and|&)\\s*${ONE_REF})*)`,
      'gi'
   );
   const refs: IssueRef[] = [];
   for (const m of (body ?? '').matchAll(phrase)) {
      for (const one of m[1].matchAll(new RegExp(ONE_REF, 'gi'))) {
         const ref = parseIssueRef(one[0], repo);
         if (ref) refs.push(ref);
      }
   }
   return refs;
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
 * "+" too), outside fenced code. A line that starts with an issue stands
 * for that issue (leadRef); every other line is a plain line, done when
 * checked.
 */
export function parseChecklist(body: string | null, repo: string): ChecklistLine[] {
   const lines: ChecklistLine[] = [];
   let fenced = false;
   for (const raw of (body ?? '').split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(raw)) fenced = !fenced;
      if (fenced) continue;
      const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/.exec(raw);
      if (!m) continue;
      lines.push({ checked: m[1] !== ' ', text: m[2], ref: leadRef(m[2], repo) });
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
   /** how it's in: a sub-issue of the spec, a checklist line, the project
    * label, or added by hand on the board */
   source: 'sub' | 'check' | 'label' | 'hand';
   /** the issue; null for a plain checklist line */
   ref: IssueRef | null;
   title: string;
   state: ItemState;
   /** epoch secs it closed; null while open or when not known */
   closedAt: number | null;
   /** epoch secs it joined the scope; null when not known (a checklist line) */
   joinedAt: number | null;
   /** who opened the issue; null when not known */
   author?: string | null;
   /** epoch secs the issue was opened; null when not known */
   createdAt?: number | null;
   /** who added it by hand on the board */
   addedBy?: string | null;
   /** the PRs that link it: close it, or name it after a linking phrase
    * (bodyLinks); planScopes fills these in */
   prs?: LinkedPull[];
   /** still open, and a later plan's spec lists it too: that plan's id */
   movedTo?: number;
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
 * scope it links, if exactly one had started by `at`; else the latest plan
 * that had started by `at`, or the earliest plan when it came before them
 * all. A link into a plan that hadn't started yet doesn't count: work done
 * before a plan began belongs to the one running then. Null for a project
 * with no plans.
 */
export function planOfWork(
   plans: readonly RoadmapItem[],
   at: number,
   linked: ReadonlySet<number> = new Set()
): RoadmapItem | null {
   const sorted = [...plans].sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
   const started = sorted.filter(p => (dayStart(p.start) as number) <= at);
   const mine = started.filter(p => linked.has(p.id));
   const pool = mine.length ? mine : started;
   return pool[pool.length - 1] ?? sorted[0] ?? null;
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
   /** still open, not counting the ones moved to a later plan */
   open: number;
   /** still open, and a later plan's spec lists them too */
   moved: number;
   /** items that joined after the plan's end */
   addedAfterEnd: number;
   /** its PRs still open */
   openPulls: number;
   /** its PRs that opened after its end, oldest first */
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
   /** issues attached to a project, by slug: the ones carrying its label
    * and the ones added by hand on the board, each attached at joinedAt */
   attached: ReadonlyMap<string, ScopeItem[]>;
   /** a project's PRs (people's, not bots'), by slug */
   pulls: ReadonlyMap<string, WorkPull[]>;
   /** the scope issues each PR links, by issueKey(pr) */
   links: ReadonlyMap<string, IssueRef[]>;
   /** people's PRs with no project label: each counts toward the plans
    * whose scope it links, of those that had started when it opened */
   unlabeled?: readonly WorkPull[];
}

/** An issue attached to a project, as its page lists them: a plan's
 * scope item, or an issue attached by label or by hand. */
export interface ProjectIssue extends ScopeItem {
   /** the project's plans whose scope holds it, by id, earliest first */
   plans: number[];
   /** every way it's attached: a plan's spec (a sub-issue or a checklist
    * line), the project label, or by hand */
   via: ScopeItem['source'][];
}

/**
 * Every plan's scope, and every project's issues. An attached issue (by
 * label or by hand) goes to the plan that had started when it was attached;
 * one already in a spec of its project stays there. A PR goes to the plan
 * whose scope it links (a spec issue or an attached issue included), else
 * by its opening date (planOfWork).
 */
function build({
   plans,
   specs: specsIn,
   attached,
   pulls,
   links: linksIn,
   unlabeled = [],
}: ScopeInputs): { plans: PlanScope[]; projects: Map<string, ProjectIssue[]> } {
   // keys ignore case (issueKey), however the caller spelled them
   const specs = new Map([...specsIn].map(([k, v]) => [k.toLowerCase(), v]));
   const links = new Map([...linksIn].map(([k, v]) => [k.toLowerCase(), v]));
   const byId = new Map(plans.map(p => [p.id, p]));
   const byStart = (a: RoadmapItem, b: RoadmapItem) =>
      a.start.localeCompare(b.start) || a.id - b.id;
   const byProject = new Map<string, RoadmapItem[]>();
   for (const plan of plans) {
      if (plan.project) byProject.set(plan.project, [...(byProject.get(plan.project) ?? []), plan]);
   }
   // which plans hold each issue through a spec (the spec issue itself
   // included), for keeping an attached issue where a spec has it, and for
   // what moved to a later plan
   const specPlans = new Map<string, Set<number>>();
   // and through a spec or an attachment, for links
   const heldBy = new Map<string, Set<number>>();
   const hold = (m: Map<string, Set<number>>, k: string, id: number) =>
      m.set(k, new Set([...(m.get(k) ?? []), id]));
   const items = new Map<number, ScopeItem[]>();
   for (const plan of plans) {
      const spec = plan.spec ? specs.get(issueKey(plan.spec)) : undefined;
      const list = spec ? [...spec.items] : [];
      items.set(plan.id, list);
      const keys = [plan.spec, ...list.map(i => i.ref)].filter((r): r is IssueRef => !!r);
      for (const k of keys.map(issueKey)) {
         hold(specPlans, k, plan.id);
         hold(heldBy, k, plan.id);
      }
   }
   for (const [slug, issues] of attached) {
      const mine = byProject.get(slug) ?? [];
      // the same issue labeled and added by hand is one item, in the plan
      // that was running when it was first attached
      const placed = new Set<string>();
      const earliest = [...issues].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
      for (const issue of earliest) {
         const k = issue.ref ? issueKey(issue.ref) : '';
         if (k && placed.has(k)) continue;
         if ([...(specPlans.get(k) ?? [])].some(id => byId.get(id)?.project === slug)) continue;
         const plan = planOfWork(mine, issue.joinedAt ?? 0);
         if (!plan) continue;
         items.get(plan.id)?.push(issue);
         if (k) {
            placed.add(k);
            hold(heldBy, k, plan.id);
         }
      }
   }
   // the plans a PR links: the ones holding an issue it links,
   // and the ones whose spec lists the PR itself
   const linkedPlans = (pr: IssueRef): Set<number> => {
      const ids = new Set(specPlans.get(issueKey(pr)) ?? []);
      for (const ref of links.get(issueKey(pr)) ?? []) {
         for (const id of heldBy.get(issueKey(ref)) ?? []) ids.add(id);
      }
      return ids;
   };
   const prsOfProject = new Map([...pulls].map(([slug, list]) => [slug, [...list]]));
   // a PR with no project label is the project's only through a link, so
   // only a link into a plan that had started brings it in (planOfWork)
   for (const pr of unlabeled) {
      const slugs = new Set(
         [...linkedPlans(pr)]
            .map(id => byId.get(id) as RoadmapItem)
            .filter(p => p.project && (dayStart(p.start) as number) <= pr.createdAt)
            .map(p => p.project as string)
      );
      for (const slug of slugs) prsOfProject.set(slug, [...(prsOfProject.get(slug) ?? []), pr]);
   }
   const afterEnd = new Map<number, WorkPull[]>();
   const afterDone = new Map<number, WorkPull[]>();
   const openPulls = new Map<number, number>();
   const push = (m: Map<number, WorkPull[]>, id: number, pr: WorkPull) =>
      m.set(id, [...(m.get(id) ?? []), pr]);
   for (const [slug, prs] of prsOfProject) {
      const mine = byProject.get(slug) ?? [];
      if (!mine.length) continue;
      for (const pr of prs) {
         const plan = planOfWork(mine, pr.createdAt, linkedPlans(pr));
         if (!plan) continue;
         if (pr.state === 'open') openPulls.set(plan.id, (openPulls.get(plan.id) ?? 0) + 1);
         if (pr.createdAt >= afterEndOf(plan)) push(afterEnd, plan.id, pr);
         const stopped = plan.status === 'done' || plan.status === 'dropped';
         if (
            stopped &&
            plan.updated_at != null &&
            pr.createdAt > plan.updated_at + TAIL_DAYS * DAY
         ) {
            push(afterDone, plan.id, pr);
         }
      }
   }
   const byTime = (a: WorkPull, b: WorkPull) => a.createdAt - b.createdAt || a.number - b.number;
   // each linked issue's PRs, with titles and states for the projects' own
   const known = new Map([...prsOfProject.values()].flat().map(p => [issueKey(p), p]));
   const prsOf = new Map<string, LinkedPull[]>();
   for (const [k, issues] of links) {
      const p = known.get(k);
      const at = k.lastIndexOf('#');
      const linked: LinkedPull = {
         repo: p?.repo ?? k.slice(0, at),
         number: p?.number ?? Number(k.slice(at + 1)),
         title: p?.title ?? null,
         state: !p ? null : p.mergedAt != null ? 'merged' : p.state,
      };
      for (const ref of issues) {
         prsOf.set(issueKey(ref), [...(prsOf.get(issueKey(ref)) ?? []), linked]);
      }
   }
   // the first plan after `plan`, of its project, whose spec lists `k` too
   const movedTo = (plan: RoadmapItem, k: string): number | undefined =>
      [...(specPlans.get(k) ?? [])]
         .map(id => byId.get(id) as RoadmapItem)
         .filter(
            p =>
               p.project === plan.project &&
               (p.start > plan.start || (p.start === plan.start && p.id > plan.id))
         )
         .sort(byStart)[0]?.id;
   const withPrs = (item: ScopeItem): ScopeItem =>
      item.ref ? { ...item, prs: prsOf.get(issueKey(item.ref)) ?? [] } : item;
   const scopes = plans.map((plan): PlanScope => {
      const spec = plan.spec ? specs.get(issueKey(plan.spec)) : undefined;
      const list = (items.get(plan.id) ?? []).map(item => {
         if (!item.ref) return item;
         const later =
            item.state === 'open' && plan.project ? movedTo(plan, issueKey(item.ref)) : undefined;
         return { ...withPrs(item), ...(later != null ? { movedTo: later } : {}) };
      });
      const count = (state: ItemState) =>
         list.filter(i => i.state === state && i.movedTo == null).length;
      return {
         planId: plan.id,
         spec: plan.spec ?? null,
         specTitle: spec?.title ?? null,
         specFound: plan.spec ? spec?.found ?? true : true,
         items: list,
         done: count('done'),
         dropped: count('dropped'),
         open: count('open'),
         moved: list.filter(i => i.movedTo != null).length,
         addedAfterEnd: list.filter(i => i.joinedAt != null && i.joinedAt >= afterEndOf(plan))
            .length,
         openPulls: openPulls.get(plan.id) ?? 0,
         afterEnd: (afterEnd.get(plan.id) ?? []).sort(byTime),
         afterDone: (afterDone.get(plan.id) ?? []).sort(byTime),
      };
   });
   // each project's issues: its plans' items, earliest plan first, then
   // what's attached and in no plan (a project with no plans yet)
   const projects = new Map<string, Map<string, ProjectIssue>>();
   const row = (slug: string, k: string, item: ScopeItem, planId: number | null) => {
      const rows = projects.get(slug) ?? new Map<string, ProjectIssue>();
      projects.set(slug, rows);
      const was = rows.get(k);
      const via = [...new Set([...(was?.via ?? []), item.source])];
      rows.set(k, {
         ...(was ?? {}),
         ...item,
         addedBy: item.addedBy ?? was?.addedBy ?? null,
         plans: [...(was?.plans ?? []), ...(planId != null ? [planId] : [])],
         via,
      });
   };
   const scopeOf = new Map(scopes.map(s => [s.planId, s]));
   for (const plan of [...plans].sort(byStart)) {
      if (!plan.project) continue;
      (scopeOf.get(plan.id)?.items ?? []).forEach((item, i) => {
         row(
            plan.project as string,
            item.ref ? issueKey(item.ref) : `${plan.id}:line:${i}`,
            item,
            plan.id
         );
      });
   }
   for (const [slug, issues] of attached) {
      for (const issue of issues) {
         if (!issue.ref) continue;
         const k = issueKey(issue.ref);
         const was = projects.get(slug)?.get(k);
         if (!was) {
            row(slug, k, withPrs(issue), null);
            continue;
         }
         // already listed through a plan: note how else it's attached
         projects.get(slug)?.set(k, {
            ...was,
            via: [...new Set([...was.via, issue.source])],
            addedBy: was.addedBy ?? issue.addedBy ?? null,
         });
      }
   }
   return {
      plans: scopes,
      projects: new Map([...projects].map(([slug, rows]) => [slug, [...rows.values()]])),
   };
}

/** Every plan's scope (build). */
export function planScopes(inputs: ScopeInputs): PlanScope[] {
   return build(inputs).plans;
}

/** Every issue attached to one project: its plans' scope items and the
 * issues attached to it by label or by hand, each once (build). */
export function projectIssues(inputs: ScopeInputs, slug: string): ProjectIssue[] {
   return build(inputs).projects.get(slug) ?? [];
}

/** An issue as a search finds it, for picking one. */
export interface IssueHit {
   repo: string;
   number: number;
   title: string;
   state: ItemState;
   author: string | null;
   /** epoch secs it was opened */
   createdAt: number | null;
}

/**
 * What a person typed into an issue search: an issue's link or
 * "owner/repo#123", a number ("#123" or "123") that could be in any tracked
 * repo, or words to search titles and bodies for.
 */
export type IssueQuery =
   | { kind: 'ref'; ref: IssueRef }
   | { kind: 'number'; number: number }
   | { kind: 'words'; words: string };

export function issueQuery(text: string): IssueQuery | null {
   const s = text.trim();
   if (!s) return null;
   const ref = parseIssueRef(s);
   if (ref) return { kind: 'ref', ref };
   const n = /^#?(\d+)$/.exec(s);
   if (n) {
      const number = Number(n[1]);
      return number > 0 && number <= MAX_ISSUE_NUMBER ? { kind: 'number', number } : null;
   }
   return s.length >= 2 ? { kind: 'words', words: s } : null;
}

/** What Decide needs from a plan's scope. */
export interface ScopeCounts {
   /** items neither dropped nor moved to a later plan */
   total: number;
   done: number;
   dropped: number;
   /** epoch secs the last item closed, of those whose close time is known;
    * null when none is */
   lastClosedAt: number | null;
   afterEnd: number;
   afterDone: number;
   /** its PRs still open */
   openPulls: number;
}

export function scopeCounts(scope: PlanScope): ScopeCounts {
   const times = scope.items
      .filter(i => i.state !== 'open')
      .map(i => i.closedAt)
      .filter((t): t is number => t != null);
   return {
      total: scope.done + scope.open,
      done: scope.done,
      dropped: scope.dropped,
      lastClosedAt: times.length ? Math.max(...times) : null,
      afterEnd: scope.afterEnd.length,
      afterDone: scope.afterDone.length,
      openPulls: scope.openPulls,
   };
}
