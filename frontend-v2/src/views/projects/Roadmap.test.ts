import { describe, expect, it } from 'vitest';
import type { RoadmapItem } from '../../../../shared/model/roadmap';
import { savedWords } from './Roadmap';

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
