/**
 * Decide's question model, with no components: the sections a row sits in,
 * what each reason asks and its answers, the words for a call, and the call
 * types. Decide.tsx, the home answers (HomeCalls.tsx) and every view that
 * shows a Decide row read it, so none of them imports another's components
 * to get at it.
 */
import { createContext, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { n } from '../../../shared/format';
import {
   DECIDE_MIN_PRS,
   STALL_DAYS,
   type DecideReason,
   type DecideRow,
} from '../../../shared/model/decide';
import { firstOpenDay } from '../../../shared/model/projects';
import {
   addWeeks,
   HEALTH_WORD,
   isUnderWay,
   mondayOf,
   planEnd,
   weeksThrough,
   type RoadmapFields,
   type RoadmapItem,
} from '../../../shared/model/roadmap';
import { slugName, type PortfolioItem } from './portfolio';
import { dayWords } from './projectData';
import { commitEnds, type CommitEnd } from './roadmapTime';
import { readInitiatives } from './initiativesData';
import { homesOf } from '../../../shared/model/initiatives';
import {
   ALL_ISSUES_CLOSED,
   andList,
   LAST_14_DAYS,
   missedTarget,
   NEEDS_A_PLAN,
   noPrActivity,
   ONGOING,
   pastEnd,
   targetOn,
   NO_PROJECT_YET,
   UNSORTED_WORD,
} from './words';
import { PLAN_STATUS_WORD, when } from '../views/projects/roadmapHealth';

export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What "Mark ongoing" is for, said where each section that offers it
 * explains itself, since a title on the button is missed by touch and
 * screen readers. */
export const ONGOING_HELP = `${ONGOING} is for upkeep with no finish line. For work that ends but can’t be sized, promise a month, and Decide checks in when it ends.`;

/** The queue's sections, worst first, as decide.ts ranks them: the reasons
 * each holds, its title, and what lands there and in what order, for the
 * title's hover. A row sits in the first section any of its reasons names. */
export const SECTIONS: {
   kinds: DecideReason['kind'][];
   title: string;
   more: string[];
}[] = [
   {
      kinds: ['reopened_in_closed'],
      title: 'Its initiative is closed, still worked on',
      more: [
         'Its initiative was closed as done or dropped, and the project has open PRs or a plan under way again. Reopen the initiative, or file the project in another. A plan of its own marked done but still worked on is asked about once this is answered.',
      ],
   },
   {
      kinds: ['reopened'],
      title: 'Done or dropped, still worked on',
      more: [
         'Marked done or dropped, on the roadmap or by closing its issue, but a week after that a PR is still open, or a new PR opened more than a week after it was marked.',
         ONGOING_HELP,
      ],
   },
   {
      kinds: ['issue_closed'],
      title: 'Issue closed, plan still going',
      more: [
         'Its issue was closed after the plan last changed, and the plan still says it’s going.',
      ],
   },
   {
      kinds: ['moving'],
      title: 'Parked, still worked on',
      more: [
         'Its PRs had activity after it was parked: a push, a person’s comment, stamp or review, opening or merging.',
      ],
   },
   {
      kinds: ['off_track'],
      title: 'Off track',
      more: ['Its latest update says off track, and the plan hasn’t changed since.'],
   },
   {
      kinds: ['missed'],
      title: 'Missed its target date',
      more: [
         'The target date on its issue passed with PRs still open, and the plan hasn’t changed since.',
      ],
   },
   {
      kinds: ['over', 'ended'],
      title: 'Overdue',
      more: [
         'Its promised end date has passed. An estimated end date is never asked about, and ongoing work has none. The ones still getting new PRs come first, then the longest overdue.',
      ],
   },
   {
      kinds: ['issues_done'],
      title: ALL_ISSUES_CLOSED,
      more: [
         'Every issue in the project is closed, and the plan hasn’t changed since the last one closed.',
      ],
   },
   {
      kinds: ['goal_reached'],
      title: 'Goal maybe reached',
      more: [
         'Every project in the initiative is done, dropped, parked, or quiet with no plan, and has been for two weeks. Close it, or keep it open; kept open, it’s asked again only once something in it changes.',
      ],
   },
   {
      kinds: ['stalled'],
      title: 'Stalled',
      more: [
         `PRs still open, ${lowerFirst(
            noPrActivity(STALL_DAYS)
         )} or more, and no decision in that time. Activity is real work: a push, a person’s comment, stamp or review, opening or merging. The oldest activity comes first.`,
      ],
   },
   {
      kinds: ['at_risk'],
      title: 'At risk',
      more: ['Its latest update says at risk, and the plan hasn’t changed since.'],
   },
   {
      kinds: ['new'],
      title: NEEDS_A_PLAN,
      more: [
         `${DECIDE_MIN_PRS} or more PRs open or merged in the ${LAST_14_DAYS}, some still open, and no plan yet. Smaller work ships without one unless it stalls. The ones open longest come first.`,
         ONGOING_HELP,
      ],
   },
   {
      kinds: ['unfiled'],
      title: UNSORTED_WORD,
      more: [
         `Filed nowhere yet, with ${DECIDE_MIN_PRS} or more PRs open or merged in the ${LAST_14_DAYS} or a plan under way. File it in an initiative, in Keep the lights on, or in Not tracked.`,
      ],
   },
   {
      kinds: ['no_project'],
      title: NO_PROJECT_YET,
      more: [
         'An active plan with no project label, so it can’t be filed in an initiative. Link it to its project, and it goes where that project is filed.',
      ],
   },
   {
      kinds: ['untracked_grew'],
      title: 'Not tracked, but growing',
      more: [
         'Set Not tracked, and since then it has opened as many PRs as it had before, and 30 or more. Keep it not tracked and the count starts again, or track it in an initiative.',
      ],
   },
];

export const sectionOf = (row: DecideRow) =>
   SECTIONS.findIndex(s => row.reasons.some(r => s.kinds.includes(r.kind)));

/** The reason that put a row in its section: the one its question asks.
 * Every view that asks a row's question asks this one. */
export const primaryOf = (row: DecideRow) =>
   row.reasons.find(r => SECTIONS[sectionOf(row)].kinds.includes(r.kind)) ?? row.reasons[0];

/** A section's question asked of all its rows at once: "Park them for
 * now?", "When will each finish?". */
export const askAll = (question: string) =>
   question
      .replace(/^(Is|When will) it\b/, '$1 each')
      .replace(/ it\b/, ' them')
      .replace(/the (plan|end date)\b/, 'the $1s');

/** The words that tell one answer from another, as the section's one click
 * counts them: every target date is the same answer. */
export const answerKey = (call: Call | null) =>
   !call ? '' : call.kind !== 'commit' ? call.kind : call.target ? 'target' : call.end;

/**
 * The question a section asks once, in its header, when two or more rows
 * ask it with the same suggested answer and have nothing else to say: each
 * row is then one line, its name, lead and the one fact. Null keeps the
 * cards.
 */
export function sharedAsk(
   rows: readonly DecideRow[],
   projectOf: (row: DecideRow) => Pick<PortfolioItem, 'target'> | undefined,
   today: string
): string | null {
   if (rows.length < 2) return null;
   const keys = new Set<string>();
   const questions = new Set<string>();
   for (const row of rows) {
      if (row.reasons.length !== 1) return null;
      const [reason] = row.reasons;
      const { question, call } = askOf(reason);
      // a done_when or an issues link is a second line the card keeps
      if (call === 'done' && row.item?.done_when) return null;
      if (reason.kind === 'issues_done' && reason.open > 0 && row.slug) return null;
      const answer = answerOf(row, projectOf(row), today);
      if (!answer) return null;
      keys.add(answerKey(answer));
      questions.add(question);
   }
   return keys.size === 1 && questions.size === 1 ? [...questions][0] : null;
}

/** The initiative a row asks about itself (whether it reached its goal, or
 * reopening it), by id; null for a project's own questions. */
export const askedInitiative = (row: DecideRow): number | null => {
   for (const r of row.reasons) {
      if (r.kind === 'goal_reached' || r.kind === 'reopened_in_closed') return r.initiative;
   }
   return null;
};
export const rowKey = (row: DecideRow) =>
   !row.slug && !row.item && askedInitiative(row) != null
      ? `initiative:${askedInitiative(row)}`
      : `${row.slug ?? ''}:${row.item?.id ?? ''}`;
export const kindsOf = (row: DecideRow) => row.reasons.map(r => r.kind).join(',');
export const nameOf = (
   row: DecideRow,
   project?: Pick<PortfolioItem, 'name'> & Partial<Pick<PortfolioItem, 'project'>>
) =>
   // a row asking where a project goes is named by the project, never its
   // plan: its issue's name, or its label's words (a project with no issue
   // otherwise takes its plan's name)
   (row.slug && primaryOf(row)?.kind === 'unfiled'
      ? project?.project?.name ?? slugName(row.slug)
      : null) ??
   row.item?.name ??
   project?.name ??
   row.slug ??
   initiativeById(askedInitiative(row))?.name ??
   'A plan';
/** An initiative by id, as the board has them now. */
export const initiativeById = (id: number | null) =>
   id == null ? undefined : readInitiatives().initiatives?.find(i => i.id === id);
/** The reasons that ask where a project belongs, or about an initiative,
 * and are answered by a filing or the initiative's status, not a plan. */
export const HOME_KINDS: readonly DecideReason['kind'][] = [
   'unfiled',
   'no_project',
   'untracked_grew',
   'goal_reached',
   'reopened_in_closed',
];
export const isHomeReason = (r: DecideReason) => HOME_KINDS.includes(r.kind);

/** Every project, Not tracked ones too, for a row's one-slug lookups (a grown
 * project's name and team) and the chooser's guess. Projects.tsx gives it. */
export const AllItemsContext = createContext<readonly PortfolioItem[]>([]);

export const closedAs = (as: 'done' | 'dropped') => (as === 'done' ? 'completed' : 'not planned');
export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A fact mid-line: "no PR activity for 268 days", but "PRs open since". */
export const midLine = (s: string) => (/^[A-Z][a-z]/.test(s) ? lowerFirst(s) : s);

/** The calls a row can get. */
export type Call =
   | ({ kind: 'commit' } & CommitEnd)
   | { kind: 'park' }
   | { kind: 'done' }
   | { kind: 'drop' }
   | { kind: 'ongoing' }
   /** file the project in the initiative with slug `to`, named `name`;
    * `untracked` when that's Not tracked */
   | { kind: 'file'; to: string; name: string; untracked?: boolean }
   /** keep it Not tracked (the initiative with slug `to`), starting its
    * count again */
   | { kind: 'keep_untracked'; to: string }
   /** give a plan with no project its project, by slug */
   | { kind: 'link'; project: string; name: string }
   /** close the initiative asked about */
   | { kind: 'close'; as: 'done' | 'dropped' }
   /** keep it open, asked again only once something in it changes */
   | { kind: 'keep_open' }
   /** reopen the closed initiative a project is in */
   | { kind: 'reopen' };

/** The calls that write a plan. */
export type PlanCallKind = Extract<Call, { kind: 'commit' | 'park' | 'done' | 'drop' }>;
/** The calls that write a filing or an initiative's status. */
export type HomeCall = Extract<
   Call,
   { kind: 'file' | 'keep_untracked' | 'link' | 'close' | 'keep_open' | 'reopen' }
>;
export const isHomeCall = (call: Call): call is HomeCall =>
   ['file', 'keep_untracked', 'link', 'close', 'keep_open', 'reopen'].includes(call.kind);

/** A filing that rides along with a plan call: the home picked in the row's
 * Initiative chooser, when it differs from the one it has. */
export interface Filed {
   to: string;
   name: string;
   /** the home it had, which `expect` checks and Undo puts back */
   from: string | null;
   /** it's Not tracked */
   untracked?: boolean;
}

/** Where a filing puts a project, mid-sentence: "Not tracked", "in X". */
export const filedWhere = (filed: Pick<Filed, 'name' | 'untracked'>) =>
   filed.untracked ? 'Not tracked' : `in ${filed.name}`;

/** The question that asks a plan to end later: its answers are only ends
 * after the one it has. */
export const NEW_END = 'Move the end date?';

/** The question a reason asks, and the call that answers yes. */
export function askOf(reason: DecideReason): {
   question: string;
   call: Call['kind'];
} {
   switch (reason.kind) {
      case 'new':
         // answered under "Promise to finish by": "End of Oct"
         return { question: 'When will it finish?', call: 'commit' };
      case 'stalled':
         return { question: 'Park it for now?', call: 'park' };
      case 'over':
      case 'missed':
      case 'off_track':
      case 'at_risk':
         return { question: NEW_END, call: 'commit' };
      case 'moving':
         return { question: 'Restart it?', call: 'commit' };
      case 'ended':
         return { question: 'Is it done?', call: 'done' };
      case 'issue_closed':
         return reason.as === 'done'
            ? { question: 'Mark the plan done too?', call: 'done' }
            : { question: 'Drop the plan too?', call: 'drop' };
      case 'reopened':
         return reason.as === 'done'
            ? { question: 'Is it still done?', call: 'done' }
            : { question: 'Is it still dropped?', call: 'drop' };
      case 'issues_done':
         return reason.done
            ? { question: 'Is it done?', call: 'done' }
            : { question: 'Drop it?', call: 'drop' };
      // where it belongs: answered with a filing or the initiative's status
      case 'unfiled':
         return { question: 'Which initiative is it in?', call: 'file' };
      case 'no_project':
         return { question: 'Which project is it?', call: 'link' };
      case 'untracked_grew':
         return { question: 'Still not tracked?', call: 'keep_untracked' };
      case 'goal_reached':
         return { question: 'Did it reach its goal?', call: 'close' };
      case 'reopened_in_closed':
         return { question: 'Reopen its initiative?', call: 'reopen' };
   }
}

/** The ends a row's plan can commit to: its project's target first while
 * that's ahead, then the coming months and quarters, none before the plan
 * starts. An end that leaves a plan under way with the hard end it has
 * would only stamp it changed, so it isn't one, while the same end on a
 * soft one commits to its estimate; a row asking "Move the end date?" offers only the
 * ends that move it later, and ongoing work, with no end, any of them. */
export function endsFor(
   row: DecideRow,
   project: Pick<PortfolioItem, 'target'> | undefined,
   today: string
): CommitEnd[] {
   const target = project?.target?.due_on?.slice(0, 10) ?? null;
   const plan = row.item;
   if (!plan) return commitEnds(today, target);
   const later = row.reasons.length > 0 && askOf(primaryOf(row)).question === NEW_END;
   const endless = plan.end_kind === 'ongoing';
   return commitEnds(today, target).filter(c => {
      if (c.end < plan.start) return false;
      const weeks = weeksThrough(plan.start, c.end);
      if (later) return endless || weeks > plan.weeks;
      return weeks !== plan.weeks || !isUnderWay(plan.status) || plan.end_kind !== 'hard';
   });
}

/**
 * The call a row's suggested answer makes, safe to take without reading the
 * rest: the one its question asks, a commit going through its target while
 * that's ahead, else through the nearest end, never one that ends its plan
 * sooner. Null when there's none to outline: a row nobody asked about (a
 * plan under its project's page), or a plan already running past every end
 * offered.
 */
export function answerOf(
   row: DecideRow,
   project: Pick<PortfolioItem, 'target'> | undefined,
   today: string
): Call | null {
   if (!row.reasons.length) return null;
   // a filing or an initiative's status: its own strip suggests it (HomeStrip)
   if (isHomeReason(primaryOf(row))) return null;
   const asked = restarted(row)
      ? 'commit'
      : (askOf(primaryOf(row)).call as Exclude<Call['kind'], HomeCall['kind']>);
   if (asked !== 'commit') return { kind: asked };
   const plan = row.item;
   const end = endsFor(row, project, today).find(
      c => !plan || plan.end_kind === 'ongoing' || weeksThrough(plan.start, c.end) >= plan.weeks
   );
   return end ? { kind: 'commit', ...end } : null;
}

/** A finished plan still worked on whose initiative was reopened after it
 * finished: the work started again, so its answer restarts it rather than
 * keeping it done. */
export function restarted(row: DecideRow): boolean {
   const plan = row.item;
   if (!plan || !row.slug || primaryOf(row).kind !== 'reopened') return false;
   const home = homesOf(readInitiatives().initiatives ?? []).get(row.slug)?.initiative;
   return (
      home?.kind === 'initiative' &&
      home.status === 'open' &&
      (home.status_at ?? 0) > (plan.status_at ?? plan.updated_at ?? 0)
   );
}

export const VERBS: Record<Call['kind'], [string, string]> = {
   commit: ['Promise', 'Promised'],
   park: ['Park', 'Parked'],
   done: ['Mark', 'Marked'],
   drop: ['Drop', 'Dropped'],
   ongoing: ['Mark', 'Marked'],
   file: ['File', 'Filed'],
   keep_untracked: ['Keep', 'Kept'],
   link: ['Link', 'Linked'],
   close: ['Close', 'Closed'],
   keep_open: ['Keep', 'Kept'],
   reopen: ['Reopen', 'Reopened'],
};

/**
 * What one click on a section does to its rows, or did, in the words each
 * row's own button says: "Promise all 52 by the end of Oct", "Promised 52
 * by the end of Oct". Rows whose answers differ say each one and how many
 * ("Promise 5 by the end of Oct and mark 3 done"), and rows going through
 * their own target dates count together.
 */
export function bulkWords(
   made: readonly Call[],
   tense: 'do' | 'did',
   /** false when the section leaves some row for its own answer: no "all" */
   every = true
): string {
   const groups = new Map<string, { call: Call; count: number }>();
   for (const call of made) {
      const key = call.kind === 'commit' ? (call.target ? 'target' : call.end) : call.kind;
      const group = groups.get(key) ?? { call, count: 0 };
      group.count++;
      groups.set(key, group);
   }
   const all = every && groups.size === 1 && tense === 'do' ? 'all ' : '';
   let said = '';
   const parts = [...groups.values()].map(({ call, count }, i) => {
      const verb = VERBS[call.kind][tense === 'do' ? 0 : 1];
      const tail =
         call.kind === 'commit'
            ? ` by ${call.target && count > 1 ? 'their target dates' : call.through}`
            : call.kind === 'done' || call.kind === 'ongoing'
            ? ` ${call.kind}`
            : '';
      // "Promise 40 by the end of Oct and 12 by their target dates"
      const head = verb === said ? '' : `${i ? verb.toLowerCase() : verb} `;
      said = verb;
      return `${head}${all}${count}${tail}`;
   });
   return andList(parts);
}

/** The suggested answer in a verb that says what it does, given where the
 * plan already stands: "Keep it done" on a plan that's done. */
export function answerWords(call: Call, plan: RoadmapItem | null): string {
   const now = plan?.status;
   switch (call.kind) {
      case 'commit': {
         // the receipt's words and the end buttons' ("End of Oct"): one
         // date said one way
         const day = call.through;
         return !plan
            ? `Promise to finish by ${day}`
            : now === 'parked' || now === 'done' || now === 'dropped'
            ? `Restart, finishing by ${day}`
            : `Move the end date to ${day}`;
      }
      case 'park':
         return now === 'parked' ? 'Keep it parked' : 'Park';
      case 'done':
         return now === 'done' ? 'Keep it done' : 'Mark done';
      case 'drop':
         return now === 'dropped' ? 'Keep it dropped' : 'Drop';
      case 'ongoing':
         return 'Mark ongoing';
      case 'file':
         return call.untracked ? 'Set not tracked' : `File in ${call.name}`;
      case 'keep_untracked':
         return 'Keep not tracked';
      case 'link':
         return `Link to ${call.name}`;
      case 'close':
         return call.as === 'done' ? 'Close as done' : 'Close as dropped';
      case 'keep_open':
         return 'Keep open';
      case 'reopen':
         return 'Reopen it';
   }
}

/**
 * The facts behind a reason, in words. `bare` leaves out what the reason's
 * section title already says, for a row under that title.
 */
export function reasonFacts(reason: DecideReason, item: RoadmapItem | null, bare = false): string {
   switch (reason.kind) {
      case 'new': {
         const since = reason.since ? `PRs open since ${dayWords(reason.since)}` : 'PRs open';
         return bare ? since : `${since}, and no plan yet`;
      }
      case 'stalled':
         return noPrActivity(reason.days);
      case 'over':
         // short form everywhere: the PRs still open go without saying
         return `${upperFirst(pastEnd(reason.weeks))}${
            reason.since ? `, ${n(reason.since, 'new PR')} since` : ''
         }`;
      case 'ended': {
         // under its title the PRs are said already: "though 4 opened since"
         const after = reason.since
            ? `, though ${bare && item ? reason.since : n(reason.since, 'PR')} opened since`
            : '';
         return bare && item
            ? `Was due ${dayWords(planEnd(item))}. No PRs are open${after}`
            : `${upperFirst(pastEnd(reason.weeks))}, and no PRs are open${after}`;
      }
      case 'missed':
         // under "Missed its target date", the target is the fact; elsewhere the
         // miss is what's owed
         return bare
            ? `${targetOn(dayWords(reason.due))}, with ${n(reason.open, 'PR')} still open`
            : `${missedTarget(dayWords(reason.due))}, with ${n(reason.open, 'PR')} open`;
      case 'off_track':
      case 'at_risk': {
         const u = item?.update;
         const said = u?.body ? `: ${u.body.split('\n')[0]}` : '';
         if (!bare) return `${HEALTH_WORD[reason.kind]}, says ${u?.author ?? 'its lead'}${said}`;
         return u ? `Update from ${u.author}, ${when(u.at)}${said}` : 'Its latest update says so';
      }
      case 'issue_closed': {
         const plan = item ? PLAN_STATUS_WORD[item.status].toLowerCase() : 'going';
         const closed = `closed as ${closedAs(reason.as)} on ${dayWords(reason.on)}`;
         return bare
            ? `${upperFirst(closed)}, and the plan says ${plan}`
            : `Its issue was ${closed}, but the plan still says ${plan}`;
      }
      case 'reopened': {
         const still = [
            reason.open ? `${n(reason.open, 'PR is', 'PRs are')} still open` : null,
            reason.late ? `${n(reason.late, 'PR')} opened more than a week later` : null,
         ]
            .filter(Boolean)
            .join(' and ');
         if (reason.by === 'issue')
            return `Its issue was closed as ${closedAs(reason.as)}, but ${still}`;
         const on = item?.status_at ? ` ${when(item.status_at)}` : '';
         return `Marked ${reason.as} on the roadmap${on}, but ${still}`;
      }
      case 'moving': {
         const at = item?.status_at ?? item?.updated_at;
         return bare && at ? `Parked ${when(at)}` : 'Parked, but its PRs have had activity since';
      }
      case 'issues_done': {
         const tally = reason.done
            ? `${reason.done} done${reason.dropped ? `, ${reason.dropped} dropped` : ''}`
            : `all ${reason.dropped} dropped`;
         const open = reason.open ? `, but ${n(reason.open, 'PR is', 'PRs are')} still open` : '';
         return bare
            ? `${upperFirst(tally)}${open}`
            : `All its issues are closed (${tally})${open}`;
      }
      case 'unfiled':
         return bare ? 'Filed nowhere yet' : `It’s ${UNSORTED_WORD}, filed nowhere yet`;
      case 'no_project':
         return bare
            ? 'Under way with no project label'
            : 'It has no project, so it can’t be filed in an initiative';
      case 'untracked_grew':
         return `${n(reason.baseline + reason.since, 'PR')}, ${
            reason.since
         } since it was marked Not tracked`;
      case 'goal_reached':
         return 'Every project in it is done, dropped, parked or quiet, for two weeks or more';
      case 'reopened_in_closed': {
         const name = initiativeById(reason.initiative)?.name ?? 'Its initiative';
         return `${name} was closed as ${reason.as}, and this is being worked on again`;
      }
   }
}

/** A sentence ended once: a reason that quotes an update ending in its own
 * stop keeps that one ("can land. Move the end date?", never "land.. Move
 * the end date?"). */
export const stop = (words: string) => (/[.!?…]$/.test(words) ? words : `${words}.`);

/** Why a row is here and the question it asks, as two pieces, for a page
 * that sets them apart (the question in amber, after every reason's facts). */
export function reasonParts(
   reason: DecideReason,
   item: RoadmapItem | null,
   bare = false
): { facts: string; question: string } {
   return {
      facts: stop(reasonFacts(reason, item, bare)),
      question: askOf(reason).question,
   };
}

/** Why a row is here and the question it asks, in a sentence that stands
 * alone (a project's page, where there's no section title). */
export function reasonWords(reason: DecideReason, item: RoadmapItem | null): string {
   const { facts, question } = reasonParts(reason, item);
   return `${facts} ${question}`;
}

/** A row under its section title, as plain text: the question its reason
 * asks, then the other reasons in full. */
export function rowWords(row: DecideRow): string {
   const primary = primaryOf(row);
   return [
      `${stop(reasonFacts(primary, row.item, true))} ${askOf(primary).question}`,
      ...row.reasons.filter(r => r !== primary).map(r => stop(reasonFacts(r, row.item))),
   ].join(' ');
}

/** Where a plan the row makes starts: its item's start, or else the week
 * its first open PR opened. */
export function startOf(row: DecideRow, project: PortfolioItem | undefined, today: string): string {
   if (row.item) return row.item.start;
   // a Start date a person set on the project's issue wins, as everywhere
   // a person's value does; else the work started when its first PR did
   return mondayOf(
      project?.project?.fields.start || (project?.group && firstOpenDay(project.group)) || today
   );
}

export const STATUS = { park: 'parked', done: 'done', drop: 'dropped' } as const;

/**
 * What a call writes to the roadmap: a change to the row's plan, or, for
 * work with none, a new plan from its first open PR's week through this one,
 * unless it commits further. A commit is the commitment that makes an end
 * hard, so Decide asks about it once it passes.
 */
export function writeFor(
   call: PlanCallKind,
   row: DecideRow,
   project: PortfolioItem | undefined,
   today: string
):
   | { id: number; fields: Partial<RoadmapFields>; restate: boolean }
   | { id: null; fields: Partial<RoadmapFields> } {
   const start = startOf(row, project, today);
   // a new end for a plan that hasn't started yet leaves it planned
   const waiting = row.item?.status === 'planned' && start > today;
   const fields: Partial<RoadmapFields> =
      call.kind === 'commit'
         ? {
              status: waiting ? 'planned' : 'active',
              start,
              weeks: weeksThrough(start, call.end),
              end_kind: 'hard',
           }
         : { status: STATUS[call.kind] };
   if (row.item) {
      // done or dropped on a plan already marked so says it again, which
      // accepts the PRs that came after it, until a new one comes
      const restate = fields.status === 'done' || fields.status === 'dropped';
      return { id: row.item.id, fields, restate };
   }
   return {
      id: null,
      fields: {
         name: nameOf(row, project),
         project: row.slug,
         // with no plan yet, its team is the one most of its developers are on
         team: project?.team ?? null,
         lead: project?.lead ?? null,
         start,
         weeks: weeksThrough(start, today),
         ...fields,
      },
   };
}

/** Whether "Mark ongoing" on a row gives its plan under way no end, rather
 * than marking the project ongoing: new work has no plan, and work whose
 * plan finished goes on without one. */
export const ongoingPlan = (row: DecideRow) => !!row.item && isUnderWay(row.item.status);

/**
 * What a call decided and what happens next, by decide.ts's rules: a plan
 * comes back when it runs past its end, parked work when its PRs move, and
 * finished or dropped work a week on (REOPEN_DAYS) if PRs are still open or
 * new ones open, unless the work never ends.
 */
export function callWords(
   call: Call,
   row: DecideRow,
   project: Pick<PortfolioItem, 'open' | 'ongoing'> | undefined,
   today: string,
   filed?: Pick<Filed, 'name' | 'untracked'>
): string {
   // a plan call that files the project too says where, once
   const home = filed && filedWhere(filed);
   if (home && call.kind !== 'commit' && !isHomeCall(call)) {
      return `${callWords(call, row, project, today)} It’s ${home} now.`;
   }
   const initiative = initiativeById(askedInitiative(row));
   switch (call.kind) {
      case 'commit': {
         // a stopped plan's answer was Restart: the receipt says it's under way again
         const was = row.item?.status;
         const restarted = was === 'parked' || was === 'done' || was === 'dropped';
         return `${restarted ? 'Restarted, promised' : 'Promised'} to finish by ${call.through}${
            home ? `, ${home}` : ''
         }. Decide asks again if it runs past that.`;
      }
      case 'file':
         return call.untracked
            ? 'Set not tracked, so it counts nowhere. Decide asks again if it grows.'
            : `Filed in ${call.name}.`;
      case 'link': {
         // what the link did, by where that project is filed now
         const home = homesOf(readInitiatives().initiatives ?? []).get(call.project)?.initiative;
         return !home
            ? `Linked to ${call.name}. It’s ${UNSORTED_WORD}, so Decide asks where it goes.`
            : home.kind === 'untracked'
            ? `Linked to ${call.name}, so it’s Not tracked.`
            : `Linked to ${call.name}, so it’s in ${home.name}.`;
      }
      case 'keep_untracked':
         return 'Kept not tracked. Its count starts again, so Decide asks only if it doubles again.';
      case 'close':
         return `Closed ${initiative?.name ?? 'it'} as ${call.as}.`;
      case 'keep_open':
         return 'Kept open. Decide asks again once something in it changes.';
      case 'reopen':
         return `Reopened ${initiative?.name ?? 'its initiative'}.`;
      case 'park':
         return 'Parked, so it stops counting in the weeks ahead. Decide asks again if its PRs move.';
      case 'ongoing':
         return ongoingPlan(row)
            ? 'Marked ongoing, with no end, so Decide never asks about one.'
            : 'Marked ongoing, so Decide stops asking it for a plan or an end.';
      case 'done':
      case 'drop': {
         const did = call.kind === 'done' ? 'Marked done' : 'Dropped';
         if (!row.slug || project?.ongoing) return `${did}.`;
         const week = dayWords(addWeeks(today, 1));
         return project && project.open > 0
            ? `${did}. Decide asks again if a PR is still open on ${week}, or a new one opens after.`
            : `${did}. Decide asks again if a PR opens after ${week}.`;
      }
   }
}

/** Left and right, Home and End move the focus among a group's buttons, so
 * the group is one Tab stop: the button with tabIndex 0. */
export function arrowsAmong(e: ReactKeyboardEvent<HTMLElement>): void {
   const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
   if (!step && e.key !== 'Home' && e.key !== 'End') return;
   const buttons = [...e.currentTarget.querySelectorAll<HTMLElement>('button')];
   const at = buttons.indexOf(document.activeElement as HTMLElement);
   const to =
      e.key === 'Home'
         ? 0
         : e.key === 'End'
         ? buttons.length - 1
         : (at + step + buttons.length) % buttons.length;
   e.preventDefault();
   buttons[to]?.focus();
}
