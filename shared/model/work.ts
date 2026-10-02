import { MAX_ISSUE_NUMBER, REPO_PATTERN, issueKey, parseIssueRef, type IssueRef } from './issueRef';
import { dayStart, type PullLinks } from './projects';
import { isStopped, planEnd, type RoadmapItem } from './roadmap';

export { issueKey, issueText, parseIssueRef, type IssueRef } from './issueRef';

/**
 * A project's work: the issues attached to it and the PRs that do them. An
 * issue joins a project by the project's label, by hand on the board, or on
 * its own when one of the project's PRs links it and no project has it (the
 * server's sync stores it; taken off, it stays off). A PR joins by the
 * label, or with none by linking one of the project's issues ("Parts of
 * #N", "closes #N"): projectOf, the rule every view counts by. A project is
 * one piece of work with an end; a later round of the same thing (the
 * feedback after a launch) is a project of its own, grouped under the first
 * by a parent label.
 *
 * The project page lists each issue with the PRs that link it, then the
 * project's PRs that link none of its issues, then the issues its PRs link
 * that didn't join, to add. A plan on the roadmap gives the dates: the PRs
 * that opened after it ended show on the page and in Decide, and once every
 * issue is closed Decide asks whether the work is done. Done is a person's
 * call. Pure, like the rest of shared/: the server builds it from its tables
 * and the board renders it, so they can't disagree.
 */

const DAY = 86400;

/** A PR opened within this many days of a plan being marked done or
 * dropped is its tail, not a comeback (decide.ts REOPEN_DAYS agrees). */
export const TAIL_DAYS = 7;
/** a PR merged or closed within this many days still lists on the page */
export const RECENT_DAYS = 14;
/** an issue linked by a PR that opened, merged or closed within this many
 * days is suggested; a closed one, for this many days after it closed */
export const SUGGEST_DAYS = 30;

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
   // a body naming one issue twice ("Parts of #1 ... closes #1") links it once
   const refs = new Map<string, IssueRef>();
   for (const m of (body ?? '').matchAll(phrase)) {
      for (const one of m[1].matchAll(new RegExp(ONE_REF, 'gi'))) {
         const ref = parseIssueRef(one[0], repo);
         if (ref && !refs.has(issueKey(ref))) refs.set(issueKey(ref), ref);
      }
   }
   return [...refs.values()];
}

/** Where an issue stands: still to do, done, or dropped (closed as not
 * planned or duplicate). */
export type ItemState = 'open' | 'done' | 'dropped';

/** An issue's state and close reason as one of the three. */
export function itemState(state: string | null, reason: string | null): ItemState {
   if (state?.toLowerCase() !== 'closed') return 'open';
   const why = reason?.toLowerCase();
   return why === 'not_planned' || why === 'duplicate' ? 'dropped' : 'done';
}

/** An issue as a search finds it, or as the board knows it. */
export interface IssueHit {
   repo: string;
   number: number;
   title: string;
   state: ItemState;
   author: string | null;
   /** epoch secs it was opened */
   createdAt: number | null;
   /** epoch secs it closed; null while open or when not known */
   closedAt?: number | null;
   /** a search hit: the projects it's in already, by slug */
   projects?: string[];
}

/** An issue attached to a project. */
export interface AttachedIssue {
   ref: IssueRef;
   title: string;
   state: ItemState;
   /** epoch secs it closed; null while open or when not known */
   closedAt: number | null;
   author: string | null;
   /** epoch secs it was opened */
   createdAt: number | null;
   /** how it's attached: the project's label, by hand on the board, on its
    * own by one of the project's PRs linking it, or more than one */
   via: ('label' | 'hand' | 'link')[];
   /** epoch secs it was first attached; null when not known */
   attachedAt: number | null;
   /** who added it by hand */
   addedBy: string | null;
   /** with 'link': the PR whose link brought it in */
   linkedBy?: IssueRef | null;
}

/** A PR as the work model reads it. */
export interface WorkPull {
   repo: string;
   number: number;
   title: string;
   author: string;
   /** epoch secs */
   createdAt: number;
   mergedAt: number | null;
   /** epoch secs it closed, merged or not; null while open */
   closedAt: number | null;
   state: 'open' | 'closed';
   /** the issues its body links on purpose (bodyLinks) */
   links: IssueRef[];
}

/** A PR that links an issue, as the issue's row shows it: its title and
 * state when the board has read it, else just its number. */
export interface IssuePull {
   repo: string;
   number: number;
   title: string | null;
   author: string | null;
   createdAt: number | null;
   state: 'open' | 'merged' | 'closed' | null;
   /** on a PR that does none of the project's issues: the issues it does
    * that other projects have (their slugs), so the page can say where the
    * work may belong. Absent when there are none. */
   elsewhere?: { ref: IssueRef; projects: string[] }[];
   /** on an issue's line, a PR the board knows that counts toward another
    * project or none (projectOf: its own label; a bot's), so the page's
    * counts leave it out as every other view does. Absent for the
    * project's own, and for one the board hasn't read. */
   outside?: true;
}

/** An issue on its project's page: with the PRs that link it, newest first. */
export interface ProjectIssue extends AttachedIssue {
   prs: IssuePull[];
   /** the other projects it's attached to, by slug */
   alsoIn: string[];
}

/** How a project's issues stand, for Decide and the project list. */
export interface IssueCounts {
   total: number;
   open: number;
   done: number;
   dropped: number;
   /** epoch secs the last one closed, of those whose close time is known;
    * null when none is */
   lastClosedAt: number | null;
}

/** An issue a project's PRs link that isn't attached: what the board
 * knows of it (just its number when it has never seen it), and the PRs. */
export interface SuggestedIssue extends IssueHit {
   linkedBy: IssueRef[];
   /** the projects it's attached to already, by slug */
   alsoIn: string[];
   /** it joins on its own at the server's next sync: no project has it, a
    * PR that's here by its label or by one of its issues added by label or
    * by hand links it, and no other project's recent PR does. The rest wait
    * for someone to add them. */
   joins: boolean;
}

/** A project's page: its issues with their PRs, its PRs that link none of
 * them, and the issues its PRs link that aren't attached. */
export interface ProjectWork {
   issues: ProjectIssue[];
   /** its PRs that link none of its issues: the open ones, then the ones
    * merged or closed in the last RECENT_DAYS, each newest first */
   unlinked: IssuePull[];
   /** issues its recent PRs link that aren't attached, never one taken off
    * it: the ones joining on their own, and the ones to add by hand */
   suggested: SuggestedIssue[];
   counts: IssueCounts;
}

/** A plan's PRs, by the dates: what Decide and the page read off a plan. */
export interface PlanWork {
   planId: number;
   /** its PRs still open */
   openPulls: number;
   /** its PRs that opened after its end, oldest first */
   afterEnd: WorkPull[];
   /** of its PRs (for a plan marked done or dropped), the ones opened more
    * than TAIL_DAYS after it was marked so */
   afterDone: WorkPull[];
}

/** What a project's work is built from: the server reads it out of its tables. */
export interface WorkInputs {
   plans: readonly RoadmapItem[];
   /** each project's attached issues, by slug, none taken off */
   attached: ReadonlyMap<string, readonly AttachedIssue[]>;
   /** each project's PRs by its label (people's, not bots'), by slug */
   pulls: ReadonlyMap<string, readonly WorkPull[]>;
   /** people's PRs with no project label (or only misc's) that link a
    * project's issue: each joins the first project `linked` names */
   unlabeled?: readonly WorkPull[];
   /** the projects each PR links, by issueKey of the PR (PullLinks) */
   linked?: PullLinks;
   /** the PRs that link each issue, from the issue's side (GitHub's closing
    * references and linking mentions), by issueKey(issue) */
   links: ReadonlyMap<string, readonly IssueRef[]>;
   /** what the board knows of PRs and issues beyond those, by issueKey */
   knownPulls?: ReadonlyMap<string, WorkPull>;
   knownIssues?: ReadonlyMap<string, IssueHit>;
   /** issues never to suggest: every project's own issue */
   notIssues?: ReadonlySet<string>;
   /** each project's own issue, by slug: a PR that links it ("Parts of
    * iFixit/projects#12") is the project's the way one that links its
    * issues is */
   ownIssues?: ReadonlyMap<string, IssueRef>;
   /** the issues taken off each project, by slug then issueKey: never
    * suggested there again, nor joined on their own */
   removed?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** When a plan's status last changed; a plan saved before that was kept
 * goes by its last change of any kind. */
const statusAt = (plan: RoadmapItem) => plan.status_at ?? plan.updated_at;

/**
 * Which of a project's plans a PR belongs to: the latest one that had
 * started when it opened, skipping plans already parked, done or dropped by
 * then while another still runs; or the earliest plan when it came before
 * them all. Null for a project with no plans.
 */
export function planOfWork(plans: readonly RoadmapItem[], at: number): RoadmapItem | null {
   const sorted = [...plans].sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
   const started = sorted.filter(p => (dayStart(p.start) as number) <= at);
   const stopped = (p: RoadmapItem) => {
      const since = statusAt(p);
      return isStopped(p.status) && since != null && since <= at;
   };
   const running = started.filter(p => !stopped(p));
   // with every started plan stopped, the latest still takes it: that's how
   // work after a finished plan shows up (PlanWork.afterDone)
   return running[running.length - 1] ?? started[started.length - 1] ?? sorted[0] ?? null;
}

/** The first moment after a plan's last planned day. */
export function afterEndOf(plan: Pick<RoadmapItem, 'start' | 'weeks'>): number {
   return (dayStart(planEnd(plan)) as number) + DAY;
}

/** How a list of issues stands. */
export function issueCounts(
   issues: readonly Pick<AttachedIssue, 'state' | 'closedAt'>[]
): IssueCounts {
   const count = (state: ItemState) => issues.filter(i => i.state === state).length;
   const times = issues
      .filter(i => i.state !== 'open')
      .map(i => i.closedAt)
      .filter((t): t is number => t != null);
   return {
      total: issues.length,
      open: count('open'),
      done: count('done'),
      dropped: count('dropped'),
      lastClosedAt: times.length ? Math.max(...times) : null,
   };
}

/** Each project's PRs, by projectOf: the ones with its label, and the ones
 * with no project label whose first linked project it is, so a PR counts
 * in one project here as it does on every other view. */
function pullsOf({ pulls, unlabeled = [], linked = {} }: WorkInputs): Map<string, WorkPull[]> {
   const out = new Map([...pulls].map(([slug, list]) => [slug, [...list]]));
   for (const pr of unlabeled) {
      const slug = linked[issueKey(pr)]?.[0];
      if (slug) out.set(slug, [...(out.get(slug) ?? []), pr]);
   }
   return out;
}

/** Every plan's PRs, by the dates: each PR of a project goes to the plan
 * that was running when it opened (planOfWork). */
export function planWork(inputs: WorkInputs): PlanWork[] {
   const byProject = new Map<string, RoadmapItem[]>();
   for (const plan of inputs.plans) {
      if (plan.project) byProject.set(plan.project, [...(byProject.get(plan.project) ?? []), plan]);
   }
   const afterEnd = new Map<number, WorkPull[]>();
   const afterDone = new Map<number, WorkPull[]>();
   const openPulls = new Map<number, number>();
   const push = (m: Map<number, WorkPull[]>, id: number, pr: WorkPull) =>
      m.set(id, [...(m.get(id) ?? []), pr]);
   for (const [slug, prs] of pullsOf(inputs)) {
      const mine = byProject.get(slug) ?? [];
      if (!mine.length) continue;
      for (const pr of prs) {
         const plan = planOfWork(mine, pr.createdAt);
         if (!plan) continue;
         if (pr.state === 'open') openPulls.set(plan.id, (openPulls.get(plan.id) ?? 0) + 1);
         if (pr.createdAt >= afterEndOf(plan)) push(afterEnd, plan.id, pr);
         const stopped = plan.status === 'done' || plan.status === 'dropped';
         const since = statusAt(plan);
         if (stopped && since != null && pr.createdAt > since + TAIL_DAYS * DAY) {
            push(afterDone, plan.id, pr);
         }
      }
   }
   const byTime = (a: WorkPull, b: WorkPull) => a.createdAt - b.createdAt || a.number - b.number;
   return inputs.plans.map(plan => ({
      planId: plan.id,
      openPulls: openPulls.get(plan.id) ?? 0,
      afterEnd: (afterEnd.get(plan.id) ?? []).sort(byTime),
      afterDone: (afterDone.get(plan.id) ?? []).sort(byTime),
   }));
}

/** How every project's issues stand, by slug. */
export function projectCounts(inputs: Pick<WorkInputs, 'attached'>): Map<string, IssueCounts> {
   return new Map([...inputs.attached].map(([slug, issues]) => [slug, issueCounts(issues)]));
}

/** A PR as an issue's row shows it. */
function issuePull(pr: WorkPull): IssuePull {
   return {
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      author: pr.author,
      createdAt: pr.createdAt,
      state: pr.mergedAt != null ? 'merged' : pr.state,
   };
}

/**
 * One project's page (ProjectWork): each attached issue with the PRs that
 * link it, from either side; its PRs that link none of them; and the issues
 * its recent PRs link that aren't attached, saying which join on their own.
 * The server's sync runs it for every project and stores those (lib/work.js).
 */
export function projectWork(
   inputs: WorkInputs,
   slug: string,
   now: number = Date.now() / 1000
): ProjectWork {
   const issues = inputs.attached.get(slug) ?? [];
   const keys = new Set(issues.map(i => issueKey(i.ref)));
   // the other projects that have each issue, by label, by hand or by a
   // link, and what they know of it
   const elsewhere = new Map<string, string[]>();
   const theirIssue = new Map<string, IssueHit>();
   for (const [other, list] of inputs.attached) {
      if (other === slug) continue;
      for (const i of list) {
         elsewhere.set(issueKey(i.ref), [...(elsewhere.get(issueKey(i.ref)) ?? []), other]);
         theirIssue.set(issueKey(i.ref), {
            ...i.ref,
            title: i.title,
            state: i.state,
            author: i.author,
            createdAt: i.createdAt,
            closedAt: i.closedAt,
         });
      }
   }
   const alsoIn = (k: string) => [...(elsewhere.get(k) ?? [])].sort();
   const all = pullsOf(inputs);
   const mine = all.get(slug) ?? [];
   const known = new Map([
      ...(inputs.knownPulls ?? []),
      ...mine.map(pr => [issueKey(pr), pr] as const),
   ]);
   const ours = new Set(mine.map(issueKey));
   const resolve = (ref: IssueRef): IssuePull => {
      const pr = known.get(issueKey(ref));
      if (!pr) return { ...ref, title: null, author: null, createdAt: null, state: null };
      return ours.has(issueKey(ref)) ? issuePull(pr) : { ...issuePull(pr), outside: true };
   };
   const prsOf = new Map<string, Map<string, IssuePull>>();
   const link = (issue: string, pr: IssueRef) => {
      const list = prsOf.get(issue) ?? new Map<string, IssuePull>();
      list.set(issueKey(pr), resolve(pr));
      prsOf.set(issue, list);
   };
   for (const k of keys) for (const pr of inputs.links.get(k) ?? []) link(k, pr);
   for (const pr of mine) {
      for (const ref of pr.links) if (keys.has(issueKey(ref))) link(issueKey(ref), pr);
   }
   const newest = (a: IssuePull, b: IssuePull) => (b.createdAt ?? 0) - (a.createdAt ?? 0);
   const onIssue = new Set([...prsOf.values()].flatMap(list => [...list.keys()]));
   const since = (days: number) => now - days * DAY;
   const recent = (pr: WorkPull, days: number) =>
      pr.state === 'open' ||
      (pr.closedAt ?? pr.mergedAt ?? 0) >= since(days) ||
      pr.createdAt >= since(days);
   // the PRs whose links bring an issue in on their own: the ones with its
   // label, and the ones linking its own issue or one it has by label or by
   // hand. A PR here only through an issue a link brought brings no more,
   // so an epic many PRs link can't pull everything they touch in after it.
   const own = inputs.ownIssues?.get(slug);
   const anchors = [
      ...issues.filter(i => i.via.some(v => v !== 'link')).map(i => issueKey(i.ref)),
      ...(own ? [issueKey(own)] : []),
   ];
   const anchored = new Set([
      ...(inputs.pulls.get(slug) ?? []).map(issueKey),
      ...anchors.flatMap(k => (inputs.links.get(k) ?? []).map(issueKey)),
   ]);
   // the issues other projects' recent PRs link: one that two projects' PRs
   // link joins neither on its own
   const theirs = new Set(
      [...all]
         .filter(([other]) => other !== slug)
         .flatMap(([, prs]) => prs.filter(p => recent(p, SUGGEST_DAYS)))
         .flatMap(pr => pr.links.map(issueKey))
   );
   const gone = inputs.removed?.get(slug);
   // issues the recent PRs link, not attached, not taken off this project,
   // and not a project's own issue
   const suggested = new Map<string, SuggestedIssue>();
   for (const pr of mine.filter(p => recent(p, SUGGEST_DAYS))) {
      for (const ref of pr.links) {
         const k = issueKey(ref);
         const was = suggested.get(k);
         if (was) {
            was.linkedBy.push({ repo: pr.repo, number: pr.number });
            continue;
         }
         if (keys.has(k) || gone?.has(k) || inputs.notIssues?.has(k)) continue;
         // a PR's link to a PR isn't an issue to add
         if (known.has(k)) continue;
         const info = inputs.knownIssues?.get(k) ?? theirIssue.get(k);
         if (info && info.state !== 'open' && (info.closedAt ?? 0) < since(SUGGEST_DAYS)) continue;
         suggested.set(k, {
            ...(info ?? { ...ref, title: '', state: 'open', author: null, createdAt: null }),
            linkedBy: [{ repo: pr.repo, number: pr.number }],
            alsoIn: alsoIn(k),
            joins: false,
         });
      }
   }
   // one another project has stays a suggestion: it may belong there (a
   // phase moved on, V1 to V1.1), and adding it here is someone's call
   for (const [k, s] of suggested) {
      s.joins =
         !elsewhere.has(k) && !theirs.has(k) && s.linkedBy.some(pr => anchored.has(issueKey(pr)));
   }
   return {
      issues: issues.map(issue => ({
         ...issue,
         prs: [...(prsOf.get(issueKey(issue.ref))?.values() ?? [])].sort(newest),
         alsoIn: alsoIn(issueKey(issue.ref)),
      })),
      unlinked: mine
         .filter(pr => !onIssue.has(issueKey(pr)) && recent(pr, RECENT_DAYS))
         .map(pr => {
            const there = new Map(
               pr.links
                  .filter(ref => elsewhere.has(issueKey(ref)))
                  .map(ref => [issueKey(ref), { ref, projects: alsoIn(issueKey(ref)) }])
            );
            return there.size
               ? { ...issuePull(pr), elsewhere: [...there.values()] }
               : issuePull(pr);
         })
         .sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || newest(a, b)),
      suggested: [...suggested.values()],
      counts: issueCounts(issues),
   };
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
