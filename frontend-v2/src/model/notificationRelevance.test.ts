import { describe, expect, it } from 'vitest';
import { SHIPPED_TOAST_KIND } from './cheers';
import { notificationStale } from './notificationRelevance';
import type { Toast } from './toast';

/** A toast carrying only the fields the relevance check reads. */
function toast(o: Partial<Toast>): Toast {
   return { tone: 'info', icon: '🤝', title: 't', ...o };
}

const ref = (repo: string, number: number) => ({ repo, number });

describe('notificationStale', () => {
   const open = new Set(['fixbot#3116', 'org/repo#7']);

   it('drops a single-pull nudge once its PR leaves the open board', () => {
      // Kyle's report: "return the favor on fixbot#3116" after #3116 merged
      const merged = toast({ kind: 'return-the-favor', pull: ref('fixbot', 3116) });
      expect(notificationStale(merged, new Set(['org/repo#7']))).toBe(true);
      // while the PR is still open, the nudge stays
      expect(notificationStale(merged, open)).toBe(false);
   });

   it('keeps a toast that points at no PR (board-wide rewards)', () => {
      const inboxZero = toast({ kind: 'inbox-zero', pull: undefined });
      expect(notificationStale(inboxZero, new Set())).toBe(false);
   });

   it('never stales the retrospective shipped recap, even though its PRs are merged', () => {
      const shipped = toast({
         kind: SHIPPED_TOAST_KIND,
         pulls: [ref('org/repo', 900), ref('org/repo', 901)],
      });
      expect(notificationStale(shipped, new Set())).toBe(false);
   });

   it('stales a batched toast only once every referenced pull is gone', () => {
      const batch = toast({ pulls: [ref('org/repo', 7), ref('fixbot', 3116)] });
      // one of the two still open -> still relevant
      expect(notificationStale(batch, new Set(['org/repo#7']))).toBe(false);
      // both gone -> stale
      expect(notificationStale(batch, new Set())).toBe(true);
   });

   it('applies to every PR-linked kind, not just return-the-favor', () => {
      for (const kind of ['your-turn', 'review-requested', 'pr-ci-red', 're-stamp-owed']) {
         const t = toast({ kind, pull: ref('gone', 1) });
         expect(notificationStale(t, open)).toBe(true);
      }
   });
});
