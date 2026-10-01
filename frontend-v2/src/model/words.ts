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
