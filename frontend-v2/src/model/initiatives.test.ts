import { describe, expect, it } from 'vitest';
import {
   checkInitiativeFields,
   grew,
   homesOf,
   initiativeSpan,
} from '../../../shared/model/initiatives';
import type { RoadmapItem } from '../../../shared/model/roadmap';

const plan = (project: string, over: Partial<RoadmapItem> = {}) => ({
   project,
   status: 'active' as RoadmapItem['status'],
   start: '2026-09-07',
   weeks: 4,
   end_kind: 'soft' as RoadmapItem['end_kind'],
   ...over,
});

describe('initiativeSpan', () => {
   it('runs from the earliest start, done included, to the latest end under way', () => {
      const span = initiativeSpan(
         ['firmware', 'hub', 'bench'],
         [
            plan('firmware', { start: '2026-05-04', weeks: 37 }),
            plan('hub', { status: 'done', start: '2026-03-02', weeks: 2 }),
            plan('bench', { end_kind: 'ongoing' }),
            // parked and dropped plans, and other initiatives' plans, add nothing
            plan('hub', { status: 'parked', start: '2026-01-05', weeks: 90 }),
            plan('firmware', { status: 'dropped', start: '2026-01-05' }),
            plan('elsewhere', { start: '2025-01-06', weeks: 100 }),
         ]
      );
      expect(span).toEqual({
         start: '2026-03-02',
         end: '2027-01-17',
         with_end: 1,
         ongoing: 1,
         end_kind: 'soft',
         ended: null,
      });
   });

   it('says ongoing with no end in sight, ended with only done plans, nothing with no plans', () => {
      expect(initiativeSpan(['a'], [plan('a', { end_kind: 'ongoing' })]).end_kind).toBe('ongoing');
      const ended = initiativeSpan(['a'], [plan('a', { status: 'done', weeks: 2 })]);
      expect([ended.end_kind, ended.ended, ended.end]).toEqual(['ended', '2026-09-20', null]);
      expect(initiativeSpan(['a'], []).end_kind).toBeNull();
   });
});

describe('grew', () => {
   it('asks once it opened as many PRs as it had, and at least 30', () => {
      expect(grew(29, 0)).toBe(false);
      expect(grew(30, 0)).toBe(true);
      expect(grew(31, 32)).toBe(false);
      expect(grew(32, 32)).toBe(true);
   });
});

describe('homesOf', () => {
   it('finds each project’s initiative and filing', () => {
      const filing = { project: 'a', set_by: null, set_at: 5, baseline_prs: 0 };
      const homes = homesOf([{ id: 1, projects: [filing] }, { id: 2, projects: [] }]);
      expect(homes.get('a')?.initiative.id).toBe(1);
      expect(homes.get('a')?.filing).toBe(filing);
      expect(homes.has('b')).toBe(false);
   });
});

describe('checkInitiativeFields', () => {
   it('needs a slug and a name to make one, and cleans the goal to one line', () => {
      expect(
         checkInitiativeFields(
            { slug: 'site-speed', name: ' Site speed ', goal: 'Fast\n pages', owner: 'dana' },
            { partial: false }
         )
      ).toEqual({
         fields: { slug: 'site-speed', name: 'Site speed', goal: 'Fast pages', owner: 'dana' },
      });
      expect(checkInitiativeFields({ name: 'X' }, { partial: false })).toHaveProperty('error');
      expect(checkInitiativeFields({ slug: 'x' }, { partial: false })).toHaveProperty('error');
      expect(
         checkInitiativeFields({ slug: 'x', name: 'X', kind: 'big' }, { partial: false })
      ).toHaveProperty('error');
      expect(
         checkInitiativeFields({ slug: 'x', name: 'X', status: 'done' }, { partial: false })
      ).toHaveProperty('error');
   });

   it('edits keep the slug and kind, and clear the owner with null', () => {
      expect(checkInitiativeFields({ owner: null, status: 'done' }, { partial: true })).toEqual({
         fields: { owner: null, status: 'done' },
      });
      expect(checkInitiativeFields({ slug: 'y' }, { partial: true })).toHaveProperty('error');
      expect(checkInitiativeFields({ goal: 'x'.repeat(256) }, { partial: true })).toHaveProperty(
         'error'
      );
      expect(checkInitiativeFields({ owner: 'not a login' }, { partial: true })).toHaveProperty(
         'error'
      );
   });
});
