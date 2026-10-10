import { describe, expect, it } from 'vitest';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { savedWords, standingsOf, teamWords } from './Roadmap';

const plan: RoadmapItem = {
   id: 5,
   name: 'MySQL 8 upgrade',
   project: 'mysql-8',
   team: 'Community',
   lead: 'evannoronha',
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 4,
   // a commitment, the end these tests ask about
   end_kind: 'hard',
   done_when: '',
   priority: 4,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: null,
   created_at: null,
   update: null,
};

describe('the receipt an editor save leaves', () => {
   it('says new dates the way a drag says them', () => {
      expect(savedWords(plan, { weeks: 8 })).toBe('Made MySQL 8 upgrade 4 weeks longer');
      expect(savedWords(plan, { start: '2026-09-14' })).toBe('Moved MySQL 8 upgrade 1 week later');
   });

   it('says a new status as the call it is', () => {
      expect(savedWords(plan, { status: 'parked' })).toBe('Marked MySQL 8 upgrade parked');
   });

   it('names anything else it changed, once each, under its new name', () => {
      expect(savedWords(plan, { lead: 'dana', notes: 'Primary next', weeks: 6 })).toBe(
         'Saved MySQL 8 upgrade: changed its lead, its notes and its dates'
      );
      expect(savedWords(plan, { name: 'MySQL 8', start: '2026-09-14', weeks: 6 })).toBe(
         'Saved MySQL 8: changed its name and its dates'
      );
   });
});

describe('who a plan is with, in its details', () => {
   it('names its team before its lead, or says what it lacks', () => {
      expect(teamWords('Store', 'zdmitchell')).toBe('Store, led by ');
      expect(teamWords(null, 'ardelato')).toBe('No team, led by ');
      expect(teamWords('FixBot', null)).toBe('FixBot, no lead yet');
      expect(teamWords(null, null)).toBe('No team or lead yet');
   });
});

describe('standingsOf', () => {
   it('puts a project Decide asks to park in Stalled, never in No plan needed', () => {
      const lanes = standingsOf([
         { slug: 'docs', item: null, reasons: [{ kind: 'new', since: '2026-07-31' }] },
         { slug: 'plp', item: null, reasons: [{ kind: 'stalled', days: 268 }] },
         // before a stalled project stopped being asked for a plan too
         {
            slug: 'idx',
            item: null,
            reasons: [
               { kind: 'new', since: null },
               { kind: 'stalled', days: 40 },
            ],
         },
         // a plan's row is the plan's, not a project's with none
         { slug: 'mysql-8', item: plan, reasons: [{ kind: 'at_risk' }] },
      ]);
      expect(Object.fromEntries(lanes)).toEqual({ docs: 'plan', plp: 'call', idx: 'call' });
   });
});
