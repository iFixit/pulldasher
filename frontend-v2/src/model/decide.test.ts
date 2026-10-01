import { describe, expect, it } from 'vitest';
import { dayStart } from '../../../shared/model/projects';
import {
   closedIssues,
   decideQueue,
   type DecideProject,
   type PlanCounts,
} from '../../../shared/model/decide';
import type { IssueCounts } from '../../../shared/model/work';
import type { RoadmapItem, RoadmapUpdate } from '../../../shared/model/roadmap';

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

   it('asks "Done?" when every issue attached is closed, until the plan changes after', () => {
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
