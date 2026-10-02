import { describe, expect, it } from 'vitest';
import { dayStart } from '../../../shared/model/projects';
import type { PlanLately } from '../../../shared/model/roadmap';
import { dayWords } from './projectData';
import { draftUpdate } from './updateDraft';

const DAY = 86400;
const NOW = dayStart('2026-09-30') as number;
// Sep 7 for 8 weeks: it ends Nov 1
const plan = (lately: Partial<PlanLately> | null, weeks = 8) => ({
   start: '2026-09-07',
   weeks,
   lately: lately && {
      merged: 2,
      open: { ready: 1, hold: 0, review: 4, work: 3 },
      activityAt: NOW - DAY,
      issues: null,
      ...lately,
   },
});

describe('draftUpdate', () => {
   it('says what merged, where the open PRs stand, and when its issues finish', () => {
      // 4 open, one fewer a week: done Oct 28, by its Nov 1 end
      expect(draftUpdate(plan({ issues: { open: 4, closed: 5, added: 1 } }), NOW)).toEqual({
         health: 'on_track',
         body:
            '2 PRs merged in the last 14 days, and 8 are open: 1 ready to merge, ' +
            '4 waiting on review and 3 in development. At this pace its 4 open issues are ' +
            `done around ${dayWords('2026-10-28')}, by its ${dayWords('2026-11-01')} end.`,
      });
   });

   it('is at risk when its issues finish after its end, or never at this pace', () => {
      const late = draftUpdate(plan({ issues: { open: 8, closed: 5, added: 1 } }), NOW);
      expect(late?.health).toBe('at_risk');
      expect(late?.body).toMatch(/done around .+, after its .+ end\.$/);
      const never = draftUpdate(plan({ issues: { open: 3, closed: 2, added: 4 } }), NOW);
      expect(never).toMatchObject({ health: 'at_risk' });
      expect(never?.body).toMatch(
         /Its issues arrive faster than they close: 2 closed and 4 added in four weeks\.$/
      );
   });

   it('is at risk when its open PRs stalled, and off track past its end with PRs open', () => {
      const stalled = draftUpdate(plan({ merged: 0, activityAt: NOW - 25 * DAY }), NOW);
      expect(stalled).toEqual({
         health: 'at_risk',
         body:
            'No PRs merged in the last 14 days, and 8 are open: 1 ready to merge, ' +
            '4 waiting on review and 3 in development. No PR activity for 25 days.',
      });
      // Sep 7 for 2 weeks ended Sep 20
      expect(draftUpdate(plan({}, 2), NOW)).toMatchObject({
         health: 'off_track',
         body: expect.stringMatching(/It’s 2 weeks past its end, .+\.$/),
      });
   });

   it('says its end when there’s no pace to tell by, and needs numbers to draft from', () => {
      const quiet = plan({ merged: 1, open: { ready: 0, hold: 0, review: 0, work: 0 } });
      expect(draftUpdate(quiet, NOW)?.body).toBe(
         `1 PR merged in the last 14 days, and none are open. It ends ${dayWords('2026-11-01')}.`
      );
      expect(draftUpdate(plan(null), NOW)).toBeNull();
   });

   it('writes plain words: no dashes', () => {
      const cases = [
         plan({ issues: { open: 4, closed: 5, added: 1 } }),
         plan({ merged: 0, activityAt: NOW - 25 * DAY }),
         plan({}, 2),
      ];
      for (const p of cases) expect(draftUpdate(p, NOW)?.body).not.toMatch(/[–—-]/);
   });
});
