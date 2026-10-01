import { n } from '../../../shared/format';

/**
 * The Projects tab's words for the facts several views show, kept in one
 * place so one fact reads the same on every view (DESIGN.md: one concept,
 * one word). Use these rather than writing the words again; a new shared
 * fact gets its word here first.
 */

/** a project with no plan on the roadmap */
export const NO_PLAN = 'No plan';
/** the action that gives it one */
export const PLAN_IT = 'Plan it';
/** a plan whose lead owes an update: the last one is older than the update rhythm */
export const UPDATE_DUE = 'Update due';
/** a plan under way that has had no update since it started */
export const NO_UPDATE_YET = 'No update yet';
/** a plan still running after its last planned week, in a sentence */
export const pastEnd = (weeks: number) => `${n(weeks, 'week')} past its end`;
/** the same on a timeline bar, where a sentence won't fit */
export const pastEndMark = (weeks: number) => `+${weeks} wk over`;
/** the board's recent window for merged and closed PRs */
export const LAST_14_DAYS = 'last 14 days';
/** PRs with no project label */
export const NOT_IN_A_PROJECT = 'Not in a project';
/** a length of time in a sentence: "42 days" */
export const days = (count: number) => n(count, 'day');
/** the same in a table cell or a row's meta line, the board's own form: "42d" */
export const daysShort = (count: number) => `${count}d`;

/** a plan's status while it runs (status `active`): only ever a plan's word */
export const IN_PROGRESS = 'In progress';
/** PRs moving on a project in a window (open, or merged or closed in it):
 * Decide's phrase for the fact, so it never borrows a plan's "In progress" */
export const BEING_WORKED_ON = 'being worked on';
/** where a plan's work came from, when nobody has said */
export const NOT_SAID = 'Not said';
/** the board's bucket for small work that isn't worth a project */
export const ONE_OFFS = 'One-offs';
/** someone on more projects than the overload line (model/retro.ts) */
export const OVERLOADED = 'overloaded';
/** a project whose issues are all closed, as a label */
export const ALL_ISSUES_CLOSED = 'All issues closed';
/** every view's export of what it shows, as plain text for a meeting */
export const COPY_AS_TEXT = 'Copy as text';
/** the choice of a plan's end, on Decide and in the roadmap's editor */
export const COMMIT_THROUGH = 'Commit through';
/** the call for upkeep with no finish line */
export const ONGOING = 'It’s ongoing';
/** a project's target, as a fact: "Target Oct 21" */
export const targetOn = (day: string) => `Target ${day}`;
/** a target that passed with work still open, said as what's owed */
export const missedTarget = (day: string) => `Missed its ${day} target`;
/** nobody's PRs moved: "No PR activity for 21 days" */
export const noPrActivity = (count: number) => `No PR activity for ${days(count)}`;
/** names in a sentence, in the order given: "a", "a and b", "a, b and c" */
export const andList = (names: readonly string[]) =>
   names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
