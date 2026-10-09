import { describe, expect, it } from 'vitest';
import { dayStart, type Today } from '../../../shared/model/projects';
import {
   closedIssues,
   decideQueue,
   type DecideProject,
   type DecideReason,
   type DecideRow,
   type PlanCounts,
} from '../../../shared/model/decide';
import type { DerivedPull } from '../../../shared/model/status';
import type { IssueCounts, ProjectIssue } from '../../../shared/model/work';
import type { PullData } from '../../../shared/types';
import type { RoadmapItem, RoadmapUpdate } from '../../../shared/model/roadmap';
import {
   answerOf,
   bulkWords,
   callWords,
   capOwed,
   endsFor,
   filledIn,
   keepCalls,
   planRow,
   reasonWords,
   teamOrder,
   whyNot,
   writeFor,
   type Call,
   type Made,
} from '../views/projects/Decide';
import { teamLoad } from './teamLoad';

const today = '2026-09-30';
const NOW = dayStart(today) as number;
const DAY = 86400;
const ago = (days: number) => NOW - days * DAY;

const item = (id: number, over: Partial<RoadmapItem>): RoadmapItem => ({
   id,
   name: `Plan ${id}`,
   project: null,
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 8,
   // a commitment, the end these tests ask about
   end_kind: 'hard',
   done_when: '',
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: ago(30),
   created_at: null,
   update: null,
   ...over,
});
const project = (slug: string, over: Partial<DecideProject> = {}): DecideProject => ({
   slug,
   firstOpened: '2026-09-21',
   lastActivity: ago(1),
   open: 2,
   prs: 3,
   due: null,
   ...over,
});
const closedOn = (slug: string, reason: string, daysAgo: number) => ({
   slug,
   state: 'closed' as const,
   state_reason: reason,
   closed_at: new Date(ago(daysAgo) * 1000).toISOString(),
});
const update = (health: RoadmapUpdate['health'], daysAgo: number): RoadmapUpdate => ({
   id: 1,
   item_id: 1,
   health,
   body: '',
   plan_start: '2026-09-07',
   plan_weeks: 8,
   author: 'dana',
   at: ago(daysAgo),
});
const kinds = (rows: ReturnType<typeof decideQueue>) =>
   rows.map(r => [r.slug ?? `#${r.item?.id}`, ...r.reasons.map(x => x.kind)]);

describe('decideQueue', () => {
   it('asks for a first call on work with no decision, and for stalled work', () => {
      const rows = decideQueue({
         live: [project('fresh'), project('quiet', { lastActivity: ago(30) })],
         items: [],
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([
         ['quiet', 'new', 'stalled'],
         ['fresh', 'new'],
      ]);
   });

   it('flags plans past their end, open or not, and updates the plan hasn’t answered', () => {
      const rows = decideQueue({
         live: [project('late'), project('shaky')],
         items: [
            item(1, { project: 'late', start: '2026-08-03', weeks: 4 }),
            item(2, { project: 'shaky', update: update('off_track', 2) }),
            item(3, { project: 'gone', start: '2026-08-03', weeks: 2 }),
            // replanned after its at-risk update: already answered
            item(4, { project: 'answered', update: update('at_risk', 10), updated_at: ago(3) }),
         ],
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([
         ['shaky', 'off_track'],
         ['late', 'over'],
         ['gone', 'ended'],
      ]);
   });

   it('asks about a hard end once it passes, never a soft end or ongoing work', () => {
      const late = { start: '2026-08-03', weeks: 4 };
      const rows = decideQueue({
         live: [project('hard'), project('soft'), project('ongoing')],
         items: [
            item(1, { project: 'hard', ...late }),
            item(2, { project: 'soft', ...late, end_kind: 'soft' }),
            item(3, { project: 'ongoing', ...late, end_kind: 'ongoing' }),
            // nothing open: a hard one would be asked "Is it done?"
            item(4, { project: 'gone', ...late, end_kind: 'soft' }),
         ],
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([['hard', 'over']]);
   });

   it('takes decided work out, and brings it back when the PRs disagree', () => {
      const rows = decideQueue({
         live: [
            project('parked'),
            project('still-parked', { lastActivity: ago(20) }),
            project('finished', { open: 2 }),
            project('just-finished'),
            project('committed', { lastActivity: ago(30) }),
         ],
         items: [
            item(1, { project: 'parked', status: 'parked', updated_at: ago(5) }),
            item(2, { project: 'still-parked', status: 'parked', updated_at: ago(5) }),
            item(3, { project: 'finished', status: 'done', updated_at: ago(10) }),
            item(4, { project: 'just-finished', status: 'done', updated_at: ago(2) }),
            // decided a week ago: its stall stays quiet for three weeks
            item(5, { project: 'committed', updated_at: ago(7) }),
         ],
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([
         ['finished', 'reopened'],
         ['parked', 'moving'],
      ]);
   });

   it('judges each plan under way, so a finished first phase can’t hide a late second', () => {
      const rows = decideQueue({
         live: [project('two-phase')],
         items: [
            item(1, { project: 'two-phase', status: 'done', updated_at: ago(40) }),
            item(2, { project: 'two-phase', start: '2026-08-03', weeks: 4 }),
         ],
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([['two-phase', 'over']]);
      expect(rows[0].item?.id).toBe(2);
   });

   it('says in flight only with PRs open, and asks a first call only of work big enough', () => {
      const rows = decideQueue({
         live: [
            project('merged-only', { open: 0, prs: 2 }),
            project('small', { open: 1, prs: 2 }),
            project('small-stuck', { open: 1, prs: 1, lastActivity: ago(30) }),
            project('merged-no-plan', { open: 0, prs: 4 }),
         ],
         items: [item(1, { project: 'merged-only', start: '2026-08-03', weeks: 4 })],
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([
         ['merged-only', 'ended'],
         ['small-stuck', 'stalled'],
      ]);
   });

   it('counts a closed issue as a decision', () => {
      const rows = decideQueue({
         live: [project('closed-plan'), project('closed-open'), project('closed-fresh')],
         items: [item(1, { project: 'closed-plan' })],
         closed: closedIssues([
            closedOn('closed-plan', 'completed', 3),
            closedOn('closed-open', 'not_planned', 10),
            closedOn('closed-fresh', 'completed', 2),
         ]),
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([
         ['closed-open', 'reopened'],
         ['closed-plan', 'issue_closed'],
      ]);
      expect(rows[0].reasons[0]).toEqual({
         kind: 'reopened',
         open: 2,
         late: 0,
         as: 'dropped',
         by: 'issue',
      });
      expect(rows[1].reasons[0]).toEqual({ kind: 'issue_closed', as: 'done', on: '2026-09-27' });
   });

   it('flags a missed target until someone replans', () => {
      const rows = decideQueue({
         live: [
            project('missed', { due: '2026-09-25' }),
            project('replanned', { due: '2026-09-25' }),
         ],
         items: [
            item(1, { project: 'missed' }),
            item(2, { project: 'replanned', updated_at: ago(2) }),
         ],
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([['missed', 'missed']]);
      expect(rows[0].reasons[0]).toEqual({ kind: 'missed', due: '2026-09-25', open: 2 });
   });

   it('asks "Is it done?" when every issue attached is closed, until the plan changes after', () => {
      const counts = (over: Partial<IssueCounts> = {}): IssueCounts => ({
         total: 5,
         open: 0,
         done: 4,
         dropped: 1,
         lastClosedAt: ago(2),
         ...over,
      });
      const rows = decideQueue({
         live: ['shipped', 'busy', 'answered', 'unknown', 'none'].map(slug => project(slug)),
         items: [
            item(1, { project: 'shipped' }),
            item(2, { project: 'busy' }),
            // the plan changed after its last issue closed: already answered
            item(3, { project: 'answered', updated_at: ago(1) }),
            item(4, { project: 'unknown' }),
            item(5, { project: 'none' }),
         ],
         issues: new Map([
            ['shipped', counts()],
            ['busy', counts({ open: 1, done: 3 })],
            ['answered', counts()],
            // no close time known: it asks
            ['unknown', counts({ lastClosedAt: null })],
            // nothing attached: nothing to be done with
            ['none', counts({ total: 0, done: 0, dropped: 0, lastClosedAt: null })],
         ]),
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([
         ['shipped', 'issues_done'],
         ['unknown', 'issues_done'],
      ]);
      // the plan's PRs still open come along, so the ask can say so
      expect(rows[0].reasons[0]).toEqual({ kind: 'issues_done', done: 4, dropped: 1, open: 2 });
   });

   it('asks only the plan running today, not one that hasn’t started', () => {
      const rows = decideQueue({
         live: [project('phases')],
         items: [
            item(1, { project: 'phases', start: '2026-09-07' }),
            item(2, { project: 'phases', start: '2026-09-21' }),
            item(3, { project: 'phases', status: 'planned', start: '2026-11-02' }),
         ],
         issues: new Map([
            ['phases', { total: 2, open: 0, done: 2, dropped: 0, lastClosedAt: ago(2) }],
         ]),
         today,
         now: NOW,
      });
      expect(
         rows.filter(r => r.reasons.some(x => x.kind === 'issues_done')).map(r => r.item?.id)
      ).toEqual([2]);
   });

   const noPulls: PlanCounts = { openPulls: 0, afterEnd: 0, afterDone: 0 };

   it('says how many PRs opened after a plan’s end, and puts the busiest first', () => {
      const end = { start: '2026-08-03', weeks: 4 };
      const rows = decideQueue({
         live: [project('quiet-tail'), project('running-on')],
         items: [
            item(1, { project: 'quiet-tail', ...end }),
            item(2, { project: 'running-on', ...end }),
         ],
         planCounts: new Map([
            [1, { ...noPulls, afterEnd: 1, openPulls: 2 }],
            [2, { ...noPulls, afterEnd: 9, openPulls: 2 }],
         ]),
         today,
         now: NOW,
      });
      expect(rows.map(r => [r.slug, r.reasons[0]])).toEqual([
         ['running-on', { kind: 'over', weeks: 5, since: 9 }],
         ['quiet-tail', { kind: 'over', weeks: 5, since: 1 }],
      ]);
   });

   it('reopens a finished plan when new work arrives more than a week after it', () => {
      const rows = decideQueue({
         // its PRs merged fast, so none is open now
         live: [project('comeback', { open: 0 })],
         items: [item(1, { project: 'comeback', status: 'done', updated_at: ago(100) })],
         planCounts: new Map([[1, { ...noPulls, afterEnd: 2, afterDone: 2 }]]),
         today,
         now: NOW,
      });
      expect(rows[0].reasons).toEqual([
         { kind: 'reopened', open: 0, late: 2, as: 'done', by: 'roadmap' },
      ]);
   });

   it('judges a finished launch by its own PRs, not its follow-on’s', () => {
      const rows = decideQueue({
         live: [project('workbench', { open: 3 })],
         items: [
            item(1, { project: 'workbench', start: '2026-05-18', weeks: 15 }),
            item(2, { project: 'workbench', start: '2026-09-21', weeks: 12 }),
         ],
         planCounts: new Map([
            // the three open PRs are the feedback round's
            [1, { ...noPulls, afterEnd: 2 }],
            [2, { ...noPulls, openPulls: 3 }],
         ]),
         today,
         now: NOW,
      });
      expect(rows.map(r => [r.item?.id, r.reasons[0].kind])).toEqual([[1, 'ended']]);
   });

   it('lets an ongoing project’s work go on after a finished plan', () => {
      const rows = decideQueue({
         live: [project('upkeep', { open: 2 }), project('feature', { open: 2 })],
         items: [
            item(1, { project: 'upkeep', status: 'done', updated_at: ago(100) }),
            item(2, { project: 'feature', status: 'done', updated_at: ago(100) }),
         ],
         ongoing: new Set(['upkeep']),
         today,
         now: NOW,
      });
      expect(rows.map(r => [r.slug, r.reasons[0].kind])).toEqual([['feature', 'reopened']]);
   });

   it('never asks an ongoing project for a first plan', () => {
      const rows = decideQueue({
         live: [project('upkeep'), project('feature')],
         items: [],
         ongoing: new Set(['upkeep']),
         today,
         now: NOW,
      });
      expect(kinds(rows)).toEqual([['feature', 'new']]);
   });
});

describe('Decide’s calls', () => {
   const done = item(7, { project: 'sso', status: 'done', start: '2026-08-03' });
   const reopened: DecideRow = {
      slug: 'sso',
      item: done,
      reasons: [{ kind: 'reopened', open: 2, late: 0, as: 'done', by: 'roadmap' }],
   };

   it('says done or dropped again on a plan already marked so, to accept the PRs after it', () => {
      expect(writeFor({ kind: 'done' }, reopened, undefined, today)).toEqual({
         id: 7,
         fields: { status: 'done' },
         restate: true,
      });
      expect(writeFor({ kind: 'drop' }, reopened, undefined, today)).toMatchObject({
         restate: true,
      });
      // a commit keeps the plan's start and runs through the end it names,
      // which it commits to: a hard end, asked about once it passes
      expect(
         writeFor(
            { kind: 'commit', label: 'End of Oct', end: '2026-10-31', through: 'the end of Oct' },
            reopened,
            undefined,
            today
         )
      ).toEqual({
         id: 7,
         fields: { status: 'active', start: '2026-08-03', weeks: 13, end_kind: 'hard' },
         restate: false,
      });
   });

   it('records work with no plan as a new one, from its week through this one', () => {
      const fresh: DecideRow = {
         slug: 'fresh',
         item: null,
         reasons: [{ kind: 'new', since: null }],
      };
      expect(writeFor({ kind: 'park' }, fresh, undefined, today)).toEqual({
         id: null,
         fields: {
            name: 'fresh',
            project: 'fresh',
            team: null,
            lead: null,
            start: '2026-09-28',
            weeks: 1,
            status: 'parked',
         },
      });
   });

   it('says what was decided and when Decide asks again', () => {
      const quiet = { open: 0, ongoing: false };
      expect(callWords({ kind: 'done' }, reopened, quiet, today)).toBe(
         'Marked done. Decide asks again if a PR opens after Oct 7.'
      );
      expect(callWords({ kind: 'drop' }, reopened, { ...quiet, open: 2 }, today)).toBe(
         'Dropped. Decide asks again if a PR is still open on Oct 7, or a new one opens after.'
      );
      // work with no end goes on after its plans, so nothing comes back
      expect(callWords({ kind: 'done' }, reopened, { open: 2, ongoing: true }, today)).toBe(
         'Marked done.'
      );
      expect(
         callWords(
            {
               kind: 'commit',
               label: 'End of Q1 2027',
               end: '2027-03-31',
               through: 'the end of Q1 2027',
            },
            reopened,
            quiet,
            today
         )
      ).toBe('Promised to finish by the end of Q1 2027. Decide asks again if it runs past that.');
   });

   it('gives a plan that hasn’t started a new end without starting it', () => {
      const promo = (start: string): DecideRow => ({
         slug: 'promo',
         item: item(9, { project: 'promo', status: 'planned', start, weeks: 4 }),
         reasons: [],
      });
      const oct: Call = {
         kind: 'commit',
         label: 'End of Oct',
         end: '2026-10-31',
         through: 'the end of Oct',
      };
      expect(writeFor(oct, promo('2026-10-12'), undefined, today).fields).toEqual({
         status: 'planned',
         start: '2026-10-12',
         weeks: 3,
         end_kind: 'hard',
      });
      // one already under way is committed to, as ever
      expect(writeFor(oct, promo('2026-09-07'), undefined, today).fields.status).toBe('active');
   });

   it('answers each row the way its suggested answer does: its target first while ahead', () => {
      const row = (reasons: DecideReason[], over: Partial<RoadmapItem> | null = null) => ({
         slug: 'p',
         item: over && item(3, { project: 'p', ...over }),
         reasons,
      });
      const target = (due_on: string) => ({ target: { title: null, due_on } });
      const fresh: DecideReason = { kind: 'new', since: null };
      expect(answerOf(row([fresh]), target('2026-10-21'), today)).toMatchObject({
         kind: 'commit',
         end: '2026-10-21',
         label: 'Its target date, Oct 21',
      });
      // a milestone's due date is a timestamp; its day is what counts
      expect(answerOf(row([fresh]), target('2026-10-21T07:00:00Z'), today)).toMatchObject({
         end: '2026-10-21',
      });
      // a target passed is a miss, not an answer
      expect(answerOf(row([fresh]), target('2026-09-26'), today)).toMatchObject({
         label: 'End of Oct',
      });
      expect(answerOf(row([fresh]), undefined, today)).toMatchObject({ label: 'End of Oct' });
      // a plan that starts after its target can't run through it, and a
      // new end comes after the one it has (Dec 20)
      expect(
         answerOf(row([{ kind: 'at_risk' }], { start: '2026-10-26' }), target('2026-10-21'), today)
      ).toMatchObject({ label: 'End of Q4' });
      expect(answerOf(row([{ kind: 'stalled', days: 30 }], {}), undefined, today)).toEqual({
         kind: 'park',
      });
      expect(answerOf(row([{ kind: 'ended', weeks: 2, since: 0 }], {}), undefined, today)).toEqual({
         kind: 'done',
      });
      expect(
         callWords(
            answerOf(row([fresh]), target('2026-10-21'), today) as Call,
            reopened,
            { open: 0, ongoing: false },
            today
         )
      ).toBe(
         'Promised to finish by its target date, Oct 21. Decide asks again if it runs past that.'
      );
   });

   it('outlines only an answer safe to take blind: never an end that cuts a plan short', () => {
      // Type and spacing refresh: Sep 7 to Nov 1, 8 weeks
      const row = (reasons: DecideReason[], over: Partial<RoadmapItem> = {}): DecideRow => ({
         slug: 'p',
         item: item(3, { project: 'p', ...over }),
         reasons,
      });
      const labels = (r: DecideRow, due?: string) =>
         endsFor(r, due ? { target: { title: null, due_on: due } } : undefined, today).map(
            c => c.label
         );
      // "Move the end date?" offers only the ends after Nov 1: "End of Oct" left it
      // as it was and cleared the call
      const later = ['End of Nov', 'End of Q4', 'End of Q1 2027'];
      expect(labels(row([{ kind: 'at_risk' }]))).toEqual(later);
      expect(answerOf(row([{ kind: 'at_risk' }]), undefined, today)).toMatchObject({
         label: 'End of Nov',
      });
      // nor is a target before its end a new end
      expect(labels(row([{ kind: 'missed', due: '2026-09-26', open: 2 }]), '2026-10-21')).toEqual(
         later
      );
      // past every end offered: nothing outlined, so a person picks
      expect(answerOf(row([{ kind: 'off_track' }], { weeks: 40 }), undefined, today)).toBeNull();
      // back on, for a parked plan that ran to Jan 24: no end before that
      expect(
         answerOf(row([{ kind: 'moving' }], { status: 'parked', weeks: 20 }), undefined, today)
      ).toMatchObject({ label: 'End of Q1 2027' });
      // nobody asked (a plan under its page): nothing outlined, and its
      // strip leaves out the end it has already; a parked plan can resume on it
      expect(answerOf(row([]), undefined, today)).toBeNull();
      expect(labels(row([]))).toEqual(later);
      expect(labels(row([], { status: 'parked' }))[0]).toBe('End of Oct');
      // work with no plan: every end
      expect(labels({ slug: 'p', item: null, reasons: [] })[0]).toBe('End of Oct');
   });

   it('commits to a soft end on its own date, and gives ongoing work any end', () => {
      const row = (reasons: DecideReason[], over: Partial<RoadmapItem>): DecideRow => ({
         slug: 'p',
         item: item(3, { project: 'p', ...over }),
         reasons,
      });
      const labels = (r: DecideRow) => endsFor(r, undefined, today).map(c => c.label);
      // Sep 7 to Nov 1: committing through the end of Oct makes the estimate a promise
      expect(labels(row([], { end_kind: 'soft' }))[0]).toBe('End of Oct');
      // "Move the end date?" on work with no end: every end is new
      const endless = row([{ kind: 'at_risk' }], { end_kind: 'ongoing', weeks: 40 });
      expect(labels(endless)[0]).toBe('End of Oct');
      expect(answerOf(endless, undefined, today)).toMatchObject({ label: 'End of Oct' });
      // "It’s ongoing" on a plan under way gives the plan no end; on new work
      // it marks the project
      const quiet = { open: 0, ongoing: false };
      expect(callWords({ kind: 'ongoing' }, row([], {}), quiet, today)).toBe(
         'Marked ongoing, with no end, so Decide never asks about one.'
      );
      expect(
         callWords({ kind: 'ongoing' }, { slug: 'p', item: null, reasons: [] }, quiet, today)
      ).toBe('Marked ongoing, so Decide stops asking it for a plan or an end.');
   });

   it('says a section’s one click in a few words, each answer with how many', () => {
      const oct: Call = {
         kind: 'commit',
         label: 'End of Oct',
         end: '2026-10-31',
         through: 'the end of Oct',
      };
      const own = (day: number): Call => ({
         kind: 'commit',
         label: `Its target date, Oct ${day}`,
         end: `2026-10-${day}`,
         through: `its target date, Oct ${day}`,
         target: true,
      });
      const times = (call: Call, count: number) => Array<Call>(count).fill(call);
      expect(bulkWords(times(oct, 52), 'do')).toBe('Promise all 52 by the end of Oct');
      expect(bulkWords(times(oct, 52), 'did')).toBe('Promised 52 by the end of Oct');
      expect(bulkWords([...times(oct, 40), own(21), own(23)], 'do')).toBe(
         'Promise 40 by the end of Oct and 2 by their target dates'
      );
      expect(bulkWords([oct, own(21)], 'did')).toBe(
         'Promised 1 by the end of Oct and 1 by its target date, Oct 21'
      );
      expect(bulkWords([oct, { kind: 'done' }, oct, { kind: 'done' }], 'do')).toBe(
         'Promise 2 by the end of Oct and mark 2 done'
      );
      expect(bulkWords(times({ kind: 'done' }, 3), 'do')).toBe('Mark all 3 done');
      expect(bulkWords([{ kind: 'park' }, { kind: 'drop' }], 'did')).toBe('Parked 1 and dropped 1');
   });

   it('keeps a call made under a plan in its place, even once it has made the plan', () => {
      const plan = item(4, { project: 'p' });
      const asked: DecideRow = { slug: 'p', item: plan, reasons: [{ kind: 'at_risk' }] };
      // nothing made here: the plan, or nothing yet to plan
      expect(planRow('p', plan, [asked])).toEqual({ slug: 'p', item: plan, reasons: [] });
      expect(planRow('p', null, [])).toEqual({ slug: 'p', item: null, reasons: [] });
      // the call that made its plan keeps its receipt where it was clicked
      const started: DecideRow = { slug: 'p', item: null, reasons: [] };
      expect(planRow('p', plan, [started])).toBe(started);
      // a call on another of its plans stays with that one
      const other: DecideRow = { slug: 'p', item: item(5, { project: 'p' }), reasons: [] };
      expect(planRow('p', plan, [other])).toEqual({ slug: 'p', item: plan, reasons: [] });
   });

   it('says why a call didn’t save, in the row, without repeating “couldn’t save”', () => {
      expect(whyNot('Couldn’t save the plan: no such roadmap item.')).toBe(
         ' No such roadmap item.'
      );
      expect(whyNot('Your sign-in expired. Reload the page to sign in again.')).toBe(
         ' Your sign-in expired. Reload the page to sign in again.'
      );
      // a plain failure: the receipt's "Didn’t save. Try again" says it all
      expect(whyNot('Couldn’t save the plan. Try again in a minute.')).toBe('');
   });

   it('keeps a call in its row’s place until the row comes back for a new reason', () => {
      const row = (slug: string, reason: DecideReason): DecideRow => ({
         slug,
         item: null,
         reasons: [reason],
      });
      const fresh: DecideReason = { kind: 'new', since: null };
      const made = (slug: string, state: Made['state']): [string, Made] => [
         `${slug}:`,
         {
            row: row(slug, fresh),
            call: { kind: 'park' },
            words: 'Parked.',
            state,
            origin: null,
            token: 1,
         },
      ];
      const { owed, all } = keepCalls(
         [row('back', { kind: 'stalled', days: 30 }), row('other', fresh)],
         new Map([
            // its row left the queue: decided, still in its place
            made('gone', 'made'),
            // back for a new reason: owed again
            made('back', 'made'),
            // taken back, though the queue dropped it: owed again
            made('undone', 'undone'),
         ])
      );
      expect(owed.map(r => r.slug)).toEqual(['back', 'other', 'undone']);
      expect(all.map(r => r.slug)).toEqual(['back', 'gone', 'other', 'undone']);
   });

   it('never asks again about work parked from a team’s load and taken back', () => {
      // parked from the team's load: a row Decide never asked about
      const parked: DecideRow = { slug: 'side', item: null, reasons: [] };
      const made = (state: Made['state']) =>
         new Map<string, Made>([
            [
               'side:',
               {
                  row: parked,
                  call: { kind: 'park' },
                  words: 'Parked.',
                  state,
                  origin: null,
                  token: 1,
               },
            ],
         ]);
      expect(keepCalls([], made('made')).all.map(r => r.slug)).toEqual(['side']);
      expect(keepCalls([], made('undone')).owed).toEqual([]);
      expect(keepCalls([], made('failed')).owed).toEqual([]);
   });

   it('draws a section’s rows until ten are owed, so decided rows never take a slot', () => {
      const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map(
         (slug): DecideRow => ({ slug, item: null, reasons: [{ kind: 'new', since: null }] })
      );
      const decided = (row: DecideRow) => row.slug === 'a' || row.slug === 'd';
      // two owed wanted: a (decided), b, c, d (decided), then e would be the third
      expect(capOwed(rows, decided, 2)).toBe(4);
      // fewer owed than the cap: every row is drawn
      expect(capOwed(rows, decided, 10)).toBe(6);
      expect(capOwed(rows, () => true, 2)).toBe(6);
   });

   it('offers the teams in their configured order, then any other by name', () => {
      expect(
         teamOrder(['Store', 'FixBot', 'Community'], ['Old', null, 'Community', 'Ads', 'Old'])
      ).toEqual(['Store', 'FixBot', 'Community', 'Ads', 'Old']);
   });

   it('counts a team’s work in flight in priority order: plans, then work with no plan', () => {
      const project = (slug: string, open: number, openSince = '2026-09-01', team = 'Store') => ({
         slug,
         name: slug,
         team,
         open,
         openSince,
      });
      const plans = [
         item(1, { name: 'Second', team: 'Store', project: 'b', priority: 2 }),
         item(2, { name: 'First', team: 'Store', project: 'a', priority: 1 }),
         // no PRs open: nothing in flight
         item(3, { name: 'Quiet', team: 'Store', project: 'q', priority: 0 }),
         item(4, { name: 'Parked', team: 'Store', project: 'p', status: 'parked' }),
         item(5, { name: 'Theirs', team: 'Other', project: 'o' }),
         // a second plan of a project already counted
         item(6, { name: 'Again', team: 'Store', project: 'a', priority: 3 }),
      ];
      const items = [
         project('a', 2),
         project('b', 1),
         project('q', 0),
         project('p', 3),
         project('o', 1, '2026-09-01', 'Other'),
         project('newer', 1, '2026-09-20'),
         project('older', 2, '2026-08-01'),
      ];
      expect(teamLoad('Store', plans, items, today).map(w => w.name)).toEqual([
         'First',
         'Second',
         'older',
         'newer',
      ]);
   });
});

describe('reasonWords', () => {
   it('ends a sentence once when the update it quotes already ends', () => {
      const said = (body: string) =>
         reasonWords(
            { kind: 'at_risk' },
            item(1, { project: 'p', update: { ...update('at_risk', 2), body } })
         );
      expect(said('Not sure the import can land.')).toMatch(/can land\. Move the end date\?$/);
      expect(said('Can the import land?')).toMatch(/land\? Move the end date\?$/);
      expect(said('Waiting on the vendor')).toMatch(/vendor\. Move the end date\?$/);
   });

   it('asks new work in the verb its answer uses', () => {
      expect(reasonWords({ kind: 'new', since: '2026-08-30' }, null)).toBe(
         'PRs open since Aug 30, and no plan yet. When will it finish?'
      );
   });
});

describe('filledIn', () => {
   const iso = (days: number) => new Date(ago(days) * 1000).toISOString();
   const label = (slug: string) => ({ title: `project:${slug}` });
   const pr = (number: number, opened: number, labels: { title: string }[] = []) =>
      ({ repo: 'iFixit/ifixit', number, created_at: iso(opened), labels } as unknown as PullData);
   const open = (data: PullData) => ({ data } as unknown as DerivedPull);
   const ref = (number: number) => ({ repo: 'iFixit/ifixit', number });
   const issue = (number: number, via: ProjectIssue['via'], joined: number, prs: number[] = []) =>
      ({
         ref: ref(number),
         title: `Issue ${number}`,
         via,
         attachedAt: ago(joined),
         linkedBy: ref(900),
         prs: prs.map(ref),
      } as unknown as ProjectIssue);
   const group = (slug: string, openPrs: PullData[], merged: PullData[] = []) =>
      ({ slug, open: openPrs.map(open), merged } as unknown as Today['live'][number]);

   it('lists each guess the board made this week, and none a person made', () => {
      const today = {
         live: [
            group(
               'sso',
               [
                  pr(1, 1, [label('sso')]), // by its label
                  pr(2, 2), // by a link, this week
                  pr(3, 10), // by a link, but before this week
                  pr(4, 3, [label('misc')]), // misc counts where it links
               ],
               [pr(5, 4)] // merged this week, by a link
            ),
         ],
         quiet: [],
      };
      const pages = new Map([
         [
            'sso',
            {
               issues: [
                  issue(10, ['link'], 2), // joined this week
                  issue(11, ['link', 'hand'], 2), // someone added it too
                  issue(12, ['link'], 10), // joined before this week
                  issue(13, ['label'], 30, [2]), // the issue PR 2 links
               ],
            },
         ],
      ]);
      const lately = {
         merged: 2,
         open: { ready: 0, hold: 0, review: 1, work: 0 },
         activityAt: ago(1),
         issues: null,
         grew: 0,
         medianAge: 4,
      };
      const plans = [
         // marked Planned, read In progress, from this week
         {
            ...item(1, { project: 'sso', status: 'active', start: '2026-09-28' }),
            marked: 'planned' as const,
         },
         // the same, but it started weeks ago: an earlier week's
         {
            ...item(2, { project: 'a', status: 'active', start: '2026-09-07' }),
            marked: 'planned' as const,
         },
         // marked In progress by a person, its PRs merging: no update owed
         item(3, { project: 'b', start: '2026-08-31', weeks: 12, updated_at: null, lately }),
      ];
      const found = filledIn({ today, prefix: 'project:', plans, pages, now: NOW });
      expect(found.joined.map(j => j.issue.ref.number)).toEqual([10]);
      expect(found.linked.map(l => [dataOfNumber(l.pull), l.issue?.number ?? null])).toEqual([
         [2, 13],
         [4, null],
         [5, null],
      ]);
      expect(found.started.map(p => p.id)).toEqual([1]);
      expect(found.vouched.map(v => [v.plan.id, v.vouch.merged])).toEqual([[3, 2]]);
   });
});

const dataOfNumber = (p: unknown) => ((p as { data?: PullData }).data ?? (p as PullData)).number;
