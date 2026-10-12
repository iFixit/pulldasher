import { describe, expect, it } from 'vitest';
import type { RoadmapItem, RoadmapUpdate } from '../../../../shared/model/roadmap';
import { DUMMY_INITIATIVES, DUMMY_ROADMAP } from '../../backend/dummyProjects';
import { healthWords, leadWords } from './Initiatives';

const NOW = Date.UTC(2026, 9, 11, 12) / 1000;
const update = (health: RoadmapUpdate['health'], daysAgo: number): RoadmapUpdate => ({
   id: 1,
   item_id: 1,
   health,
   body: '',
   plan_start: '2026-09-07',
   plan_weeks: 8,
   author: 'dana',
   at: NOW - daysAgo * 86400,
});
const plan = (over: Partial<RoadmapItem>): RoadmapItem => ({
   id: 1,
   name: 'Plan',
   project: 'p',
   team: null,
   lead: null,
   status: 'active',
   origin: null,
   start: '2026-09-07',
   weeks: 12,
   end_kind: 'soft',
   done_when: '',
   priority: 1,
   notes: '',
   waits_on: [],
   updated_by: null,
   updated_at: NOW - 30 * 86400,
   created_at: NOW - 40 * 86400,
   update: null,
   ...over,
});

describe('an initiative’s page', () => {
   it('says what its plans owe, read off them, or nothing owed', () => {
      expect(healthWords([plan({ update: update('on_track', 2) })], NOW)).toBe('nothing owed');
      expect(
         healthWords(
            [
               plan({ update: update('off_track', 2) }),
               plan({ update: update('at_risk', 3) }),
               // no update since it started: one is owed
               plan({ update: null }),
               // finished plans owe nothing
               plan({ status: 'done', update: null }),
            ],
            NOW
         )
      ).toBe('1 off track, 1 at risk, 1 update owed');
   });

   it('names who leads its live plans, most first', () => {
      expect(
         leadWords([
            plan({ lead: 'brett' }),
            plan({ lead: 'brett' }),
            plan({ lead: 'dan' }),
            plan({ lead: 'zed', status: 'done' }),
         ])
      ).toBe('brett leads 2 of 3 live plans; dan 1');
      expect(leadWords([plan({ lead: null })])).toBe('');
   });
});

describe('the dummy board’s initiatives', () => {
   it('file each project once, and hold every standing a lane can take', () => {
      const slugs = DUMMY_INITIATIVES.flatMap(i => i.projects.map(f => f.project));
      expect(new Set(slugs).size).toBe(slugs.length);
      const kinds = new Set(DUMMY_INITIATIVES.map(i => `${i.kind}:${i.status}`));
      expect(kinds).toEqual(
         new Set(['initiative:open', 'upkeep:open', 'initiative:done', 'untracked:open'])
      );
      // a Not tracked project with a plan, whose row owes nothing
      const untracked = DUMMY_INITIATIVES.find(i => i.kind === 'untracked');
      const planned = DUMMY_ROADMAP.filter(p =>
         untracked?.projects.some(f => f.project === p.project)
      );
      expect(planned.length).toBeGreaterThan(0);
   });
});
