import { describe, expect, it } from 'vitest';
import { dayStart } from '../../../../shared/model/projects';
import {
   healthStanding,
   type RoadmapItem,
   type RoadmapUpdate,
} from '../../../../shared/model/roadmap';
import {
   capacityWords,
   clearedBy,
   crossesLine,
   healthWords,
   moveWords,
   planCellWords,
   planWarnings,
   stepWithin,
   waitsWords,
   type PlanCall,
   type PlanWarnings,
   type Said,
} from './roadmapHealth';

const NOW = dayStart('2026-09-30') as number;
const TODAY = '2026-09-30';
const item = (id: number, over: Partial<RoadmapItem> = {}): RoadmapItem => ({
   id,
   name: `Item ${id}`,
   project: null,
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 4,
   priority: id,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   created_at: null,
   update: null,
   ...over,
});
const update = (daysAgo: number, health: RoadmapUpdate['health']): RoadmapUpdate => ({
   id: 1,
   item_id: 1,
   health,
   body: '',
   plan_start: '2026-09-07',
   plan_weeks: 4,
   author: 'dana',
   at: NOW - daysAgo * 86400,
});
/** the pieces said in amber, across all of a plan's words */
const amber = (w: PlanWarnings) =>
   [w.status, w.health, w.over, w.target, w.waits]
      .flatMap((s: Said | null) => s?.pieces ?? [])
      .filter(p => p.amber)
      .map(p => p.text);

describe('amber means someone owes something', () => {
   it('on health: at risk, off track, or an update owed', () => {
      const words = (u: RoadmapUpdate | null) =>
         healthWords(healthStanding(item(1, { update: u }), NOW));
      const owed = (u: RoadmapUpdate | null) =>
         words(u)
            ?.pieces.filter(p => p.owed)
            .map(p => p.text);
      expect(words(update(2, 'on_track'))?.text).toBe('On track');
      expect(owed(update(2, 'on_track'))).toEqual([]);
      expect(owed(update(2, 'at_risk'))).toEqual(['At risk']);
      expect(owed(null)).toEqual(['No update yet']);
   });

   it('on health the plan answered since (it changed after the update), nothing', () => {
      const answered = item(1, { update: update(3, 'off_track'), updated_at: NOW - 3600 });
      expect(
         healthWords(healthStanding(answered, NOW), answered.updated_at)
            ?.pieces.filter(p => p.owed)
            .map(p => p.text)
      ).toEqual([]);
   });

   it('on a stale update, only the update owed, not the health it last gave', () => {
      const words = healthWords(healthStanding(item(1, { update: update(20, 'on_track') }), NOW));
      expect(words?.text).toMatch(/^On track as of .+ · Update due$/);
      expect(words?.pieces.filter(p => p.owed).map(p => p.text)).toEqual(['Update due']);
   });

   it('in the table, a stale on track reads as the update it owes', () => {
      expect(planCellWords(item(1, { update: update(20, 'on_track') })).text).toBe('Update due');
      expect(planCellWords(item(1, { update: update(20, 'off_track') })).text).toBe('Off track');
      expect(planCellWords(item(1, { start: '2026-08-03' })).text).toBe('No update yet');
   });

   it('on what an item waits on: only when the plan clashes', () => {
      const shopify = item(2, { name: 'Shopify sync', start: '2026-09-07', weeks: 4 }); // to Oct 4
      const all = [shopify, item(3, { name: 'Old thing', status: 'dropped' })];
      const after = waitsWords(item(1, { start: '2026-10-05', waits_on: [2] }), all);
      expect(after?.text).toBe('after Shopify sync');
      expect(after?.pieces.some(p => p.owed)).toBe(false);
      const clash = waitsWords(item(1, { start: '2026-09-28', waits_on: [2] }), all);
      expect(clash?.text).toBe('starts before Shopify sync ends');
      expect(clash?.pieces[0].owed).toBe('clash');
      expect(waitsWords(item(1, { waits_on: [3] }), all)?.text).toBe(
         'waits on Old thing, which was dropped'
      );
      expect(waitsWords(item(1, { status: 'done', waits_on: [2] }), all)).toBeNull();
   });

   it('on a lane: once this week has as much being worked on as developers, its reason and not its counts', () => {
      expect(capacityWords(3, 4)?.text).toBe('3 being worked on this week, for 4 developers');
      expect(capacityWords(3, 4)?.pieces.some(p => p.amber)).toBe(false);
      const full = capacityWords(4, 4);
      expect(full?.text).toBe('4 being worked on this week, for 4 developers · no one to spare');
      expect(full?.pieces.filter(p => p.amber).map(p => p.text)).toEqual(['no one to spare']);
      expect(capacityWords(5, 4)?.text).toMatch(/· more than it can staff$/);
      expect(capacityWords(0, 4)).toBeNull();
   });

   it('on the load chart: the developer line, once a week from this one on crosses it', () => {
      const origins = { asked: 0, fire: 0, chosen: 0, unsaid: 0 };
      const weeks = [
         { week: '2026-09-21', onPlan: 5, origins, offPlan: 5, projected: false },
         { week: '2026-09-28', onPlan: 4, origins, offPlan: 4, projected: false },
      ];
      expect(crossesLine(weeks, '2026-09-28', 8)).toBe(false);
      expect(crossesLine(weeks, '2026-09-21', 8)).toBe(true);
      expect(crossesLine(weeks, '2026-09-28', 0)).toBe(false);
   });
});

describe('one owed call, one amber mark', () => {
   // SSO approvals on the dummy board: off track by its lead's word, its
   // plan ended three weeks ago with PRs still open, and its target passed
   const sso = item(1, {
      name: 'SSO approvals',
      project: 'release-gate-sso',
      start: '2026-08-03',
      weeks: 6, // to Sep 13
      update: update(3, 'off_track'),
   });
   const project = { live: true, target: { title: 'Security review', due_on: '2026-09-25' } };

   it('says the worst once, in amber, and the rest in ink', () => {
      const w = planWarnings(sso, [sso], TODAY, project, NOW);
      expect(amber(w)).toEqual(['Off track']);
      expect(w.over?.text).toBe('3 weeks past its end');
      expect(w.over?.mark).toBe('+3 wk over');
      expect(w.target?.text).toBe('Missed its Sep 25 target');
   });

   it('past its end when nothing worse is owed', () => {
      const w = planWarnings(
         { ...sso, update: update(3, 'on_track') },
         [sso],
         TODAY,
         { live: true, target: null },
         NOW
      );
      expect(amber(w)).toEqual(['3 weeks past its end']);
   });

   it('the word of a missed target, never its date', () => {
      const w = planWarnings({ ...sso, update: update(3, 'at_risk') }, [sso], TODAY, project, NOW);
      expect(amber(w)).toEqual(['Missed']);
   });

   it('past its end, when a replan since answered the update and the target', () => {
      // changed an hour ago: after the off-track update and the missed target
      const replanned = { ...sso, updated_at: NOW - 3600 };
      const w = planWarnings(replanned, [replanned], TODAY, project, NOW);
      expect(amber(w)).toEqual(['3 weeks past its end']);
   });

   it('a start gone by while still marked Planned', () => {
      const w = planWarnings(item(1, { status: 'planned', start: '2026-09-21' }), [], TODAY, null);
      expect(w.status?.text).toBe('Was to start Sep 21, still marked Planned');
      expect(amber(w)).toEqual(['still marked Planned']);
   });

   it('nothing, when nothing is owed', () => {
      const w = planWarnings(item(1, { update: update(2, 'on_track') }), [], TODAY, null, NOW);
      expect(amber(w)).toEqual([]);
   });
});

describe('Decide’s call on a plan’s row', () => {
   const call = (kind: PlanCall['kind'], text: string, question: string): PlanCall => ({
      kind,
      text,
      question,
      title: `${text}. ${question}`,
   });
   const sso = item(1, {
      project: 'release-gate-sso',
      start: '2026-08-03',
      weeks: 6,
      update: update(3, 'off_track'),
   });
   const project = { live: true, target: { title: 'Security review', due_on: '2026-09-25' } };

   it('asks its question after the words that hold its reason, the row’s one amber mark', () => {
      const w = planWarnings(
         sso,
         [sso],
         TODAY,
         project,
         NOW,
         call('off_track', 'Off track', 'New end?')
      );
      expect(w.health?.text).toBe('Off track · New end?');
      expect(amber(w)).toEqual(['New end?']);
      // the facts it would have warned of stay, in ink
      expect(w.target?.text).toBe('Missed its Sep 25 target');
      const missed = planWarnings(
         { ...sso, update: null },
         [sso],
         TODAY,
         project,
         NOW,
         call('missed', 'Missed Sep 25 target', 'New end?')
      );
      expect(missed.target?.text).toBe('Missed its Sep 25 target · New end?');
      expect(amber(missed)).toEqual(['New end?']);
   });

   it('says a call no other word holds where the status goes', () => {
      const parked = item(1, { project: 'store-picker', status: 'parked' });
      const w = planWarnings(
         parked,
         [parked],
         TODAY,
         { live: true, target: null },
         NOW,
         call('moving', 'Parked, still worked on', 'Back on?')
      );
      expect(w.status?.text).toBe('Parked, still worked on · Back on?');
      expect(amber(w)).toEqual(['Back on?']);
      // past its end: the call says it, and the bar's piece stays ink
      const over = planWarnings(
         { ...sso, update: null },
         [sso],
         TODAY,
         { live: true, target: null },
         NOW,
         call('over', '3 weeks past its end', 'New end?')
      );
      expect(over.status?.text).toBe('3 weeks past its end · New end?');
      expect(amber(over)).toEqual(['New end?']);
   });
});

describe('moving plans', () => {
   it('moves past the neighbor on screen, leaving the hidden ones in place', () => {
      // 2 and 4 are hidden by the find box
      expect(stepWithin([1, 2, 3, 4], [1, 3], 1, 1)).toEqual([2, 3, 1, 4]);
      expect(stepWithin([1, 2, 3, 4], [1, 3], 3, -1)).toEqual([3, 1, 2, 4]);
      expect(stepWithin([1, 2, 3, 4], [1, 3], 3, 1)).toBeNull();
      expect(stepWithin([1, 2, 3, 4], [1, 3], 1, -1)).toBeNull();
   });

   it('says what owed word a move clears, so a week’s nudge can’t hide one', () => {
      // in progress since Sep 14 with no update: one owes after 14 days
      const mysql = item(1, { start: '2026-09-14', weeks: 12 });
      const warnings = (start: string) =>
         planWarnings({ ...mysql, start }, [mysql], TODAY, null, NOW);
      expect(amber(warnings('2026-09-14'))).toEqual(['No update yet']);
      expect(clearedBy(warnings('2026-09-14'), warnings('2026-09-21'))).toBe('No update yet');
      expect(clearedBy(warnings('2026-09-14'), warnings('2026-09-07'))).toBeNull();
   });

   it('says a move or a resize, and nothing when it ended where it began', () => {
      const from = { start: '2026-09-07', weeks: 4 };
      expect(moveWords('MySQL 8', from, { start: '2026-10-05', weeks: 4 })).toBe(
         'Moved MySQL 8 4 weeks later'
      );
      expect(moveWords('MySQL 8', from, { start: '2026-09-07', weeks: 3 })).toBe(
         'Made MySQL 8 1 week shorter'
      );
      expect(moveWords('MySQL 8', from, from)).toBeNull();
   });
});
