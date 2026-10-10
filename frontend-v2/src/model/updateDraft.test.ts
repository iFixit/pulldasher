import { describe, expect, it } from 'vitest';
import type { EndKind, PlanLately } from '../../../shared/model/roadmap';
import { dayWords } from './projectData';
import { draftUpdate } from './updateDraft';

const DAY = 86400;
// local noon, since the draft reads days as the reader's own
const NOW = new Date(2026, 8, 30, 12).getTime() / 1000;
// Sep 7 for 8 weeks: it ends Nov 1
const plan = (lately: Partial<PlanLately> | null, weeks = 8, end_kind: EndKind = 'hard') => ({
   start: '2026-09-07',
   weeks,
   end_kind,
   lately: lately && {
      merged: 2,
      open: { ready: 1, hold: 0, review: 4, work: 3 },
      activityAt: NOW - DAY,
      issues: null,
      grew: 0,
      medianAge: 6,
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
         body: expect.stringMatching(/It’s 2 weeks overdue, .+\.$/),
      });
   });

   it('says a soft end passed without calling it off track, and ongoing work has none', () => {
      expect(draftUpdate(plan({}, 2, 'soft'), NOW)).toMatchObject({
         health: 'on_track',
         body: expect.stringMatching(/It’s 2 weeks past its estimate, .+\.$/),
      });
      // finishing after an estimate isn't at risk
      const late = draftUpdate(plan({ issues: { open: 8, closed: 5, added: 1 } }, 8, 'soft'), NOW);
      expect(late?.health).toBe('on_track');
      expect(late?.body).toMatch(/after its .+ soft end\.$/);
      expect(draftUpdate(plan({}, 2, 'ongoing'), NOW)?.body).toMatch(
         /It’s ongoing, with no end date\.$/
      );
   });

   it('names the pile of open PRs a merge couldn’t vouch for', () => {
      expect(draftUpdate(plan({ grew: 4 }), NOW)?.body).toMatch(
         /3 in development\. That’s 4 more open than 14 days ago\. /
      );
      expect(draftUpdate(plan({ medianAge: 41.5 }), NOW)?.body).toMatch(
         /Half have been open 41 days or more\. /
      );
      expect(draftUpdate(plan({ grew: 3, medianAge: 35 }), NOW)?.body).toMatch(
         /That’s 3 more open than 14 days ago, and half have been open 35 days or more\. /
      );
      // nothing said under 3 open
      const two = { ready: 0, hold: 0, review: 1, work: 1 };
      expect(draftUpdate(plan({ open: two, grew: 2 }), NOW)?.body).not.toMatch(/more open/);
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

describe('draftUpdate days', () => {
   it('judges the finish on the reader’s local day, as the page does', () => {
      // four weeks on from a Sunday night, so the finish lands late on the
      // plan's last day, which is already the next day in UTC out west
      const now = new Date(2026, 9, 4, 23, 30).getTime() / 1000;
      const draft = draftUpdate(plan({ issues: { open: 4, closed: 5, added: 1 } }), now);
      expect(draft?.body).toMatch(/, by its /);
      expect(draft?.health).toBe('on_track');
   });
});
