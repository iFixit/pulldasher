import { describe, expect, it } from 'vitest';
import type { DerivedPull, Status } from './status';
import { STATUS_ORDER } from './status';
import { actionState, alertMove, rowNote } from './actions';

/** A DerivedPull with only the fields the move functions read. */
function dp(o: {
   author?: string;
   status: Status;
   conflict?: boolean;
   dependent?: boolean;
   qaingLogin?: string | null;
   reqaBy?: string[];
   recrBy?: string[];
   crBy?: string[];
   qaBy?: string[];
   crHave?: number;
   qaHave?: number;
   crReq?: number;
   qaReq?: number;
   changesRequestedBy?: string[];
   engagedNoStamp?: string[];
   unstampedReviewers?: { login: string; state: string; date: number }[];
   ciFailing?: string[];
   starved?: boolean;
   ageDays?: number;
   headPushedAt?: number | null;
   devBlockedBy?: string[];
   deployBlockedBy?: string[];
   externalBlock?: boolean;
}): DerivedPull {
   return {
      data: {
         user: { login: o.author ?? 'author' },
         status: {
            cr_req: o.crReq ?? 1,
            qa_req: o.qaReq ?? 1,
            unstamped_reviewers: o.unstampedReviewers,
         },
      },
      status: o.status,
      conflict: o.conflict ?? false,
      dependent: o.dependent ?? false,
      qaingLogin: o.qaingLogin ?? null,
      reqaBy: o.reqaBy ?? [],
      recrBy: o.recrBy ?? [],
      crBy: o.crBy ?? [],
      qaBy: o.qaBy ?? [],
      crHave: o.crHave ?? 0,
      qaHave: o.qaHave ?? 0,
      changesRequestedBy: o.changesRequestedBy ?? [],
      engagedNoStamp: o.engagedNoStamp ?? [],
      ciFailing: o.ciFailing ?? [],
      starved: o.starved ?? false,
      ageDays: o.ageDays ?? 0,
      headPushedAt: o.headPushedAt ?? null,
      devBlockedBy: o.devBlockedBy ?? [],
      deployBlockedBy: o.deployBlockedBy ?? [],
      externalBlock: o.externalBlock ?? false,
   } as unknown as DerivedPull;
}

describe('alertMove — which transitions earn a desktop nudge', () => {
   it('alerts the author on real transitions to their own PR', () => {
      expect(alertMove(dp({ author: 'me', status: 'ready' }), 'me')).toBe('Merge it');
      expect(alertMove(dp({ author: 'me', status: 'ci_red' }), 'me')).toBe('Fix CI');
      expect(alertMove(dp({ author: 'me', status: 'dev_block' }), 'me')).toBe('Address feedback');
      expect(alertMove(dp({ author: 'me', status: 'unmergeable' }), 'me')).toBe('Rebase');
   });

   it('does not alert on self-initiated / standing states', () => {
      // "Find a QA-er" and "Finish the draft" are conditions, not events
      expect(alertMove(dp({ author: 'me', status: 'needs_qa' }), 'me')).toBeNull();
      expect(alertMove(dp({ author: 'me', status: 'draft' }), 'me')).toBeNull();
   });

   it('alerts a reviewer only for re-CR / re-QA that fell to them', () => {
      expect(alertMove(dp({ author: 'a', status: 'needs_recr', recrBy: ['me'] }), 'me')).toBe(
         'Re-stamp'
      );
      expect(alertMove(dp({ author: 'a', status: 'needs_qa', reqaBy: ['me'] }), 'me')).toBe(
         'Re-QA'
      );
      // claiming QA yourself is not an incoming event
      expect(alertMove(dp({ author: 'a', status: 'needs_qa', qaingLogin: 'me' }), 'me')).toBeNull();
      // a fresh needs-CR isn't owed by anyone in particular
      expect(alertMove(dp({ author: 'a', status: 'needs_cr' }), 'me')).toBeNull();
   });

   it('does not alert on a PR you neither own nor owe a stamp on', () => {
      expect(alertMove(dp({ author: 'other', status: 'ready' }), 'me')).toBeNull();
      expect(
         alertMove(dp({ author: 'other', status: 'needs_recr', recrBy: ['x'] }), 'me')
      ).toBeNull();
   });
});

const note = (o: Parameters<typeof dp>[0], me = 'author') => rowNote(dp(o), me);

describe('rowNote — the author matrix', () => {
   const me = 'author';

   it('draft', () => {
      expect(note({ status: 'draft' }, me)).toEqual({ action: 'Finish the draft', context: null });
   });

   it('ci_red names the failing checks when known', () => {
      expect(note({ status: 'ci_red', ciFailing: ['playwright'] }, me)).toEqual({
         action: 'Fix CI',
         context: 'playwright',
      });
      expect(note({ status: 'ci_red' }, me)).toEqual({ action: 'Fix CI', context: null });
   });

   it('dev_block names the blocker', () => {
      expect(note({ status: 'dev_block', devBlockedBy: ['bob'] }, me)).toEqual({
         action: 'Address feedback',
         context: 'from bob',
      });
   });

   it('changesRequestedBy beats the plain needs_recr wait', () => {
      expect(
         note({ status: 'needs_recr', changesRequestedBy: ['carol'], recrBy: ['dave'] }, me)
      ).toEqual({ action: 'Address feedback', context: 'changes requested by carol' });
   });

   it('a conflict masks the CR-incomplete state (regardless of status)', () => {
      expect(note({ status: 'needs_cr', conflict: true, crHave: 0, crReq: 2 }, me)).toEqual({
         action: 'Rebase',
         context: 'CR still needed',
      });
      // CR already met: no qualifier
      expect(note({ status: 'needs_qa', conflict: true, crHave: 2, crReq: 2 }, me)).toEqual({
         action: 'Rebase',
         context: null,
      });
   });

   it('dependent-only unmergeable (no conflict) waits on the parent', () => {
      expect(note({ status: 'unmergeable', dependent: true, conflict: false }, me)).toEqual({
         action: null,
         context: 'lands with its parent',
      });
   });

   it('ready', () => {
      expect(note({ status: 'ready' }, me)).toEqual({ action: 'Merge it', context: null });
   });

   it('needs_qa: unclaimed, testing, and re-QA-fell-through', () => {
      expect(note({ status: 'needs_qa' }, me)).toEqual({ action: 'Find a QA-er', context: null });
      expect(note({ status: 'needs_qa', qaingLogin: 'eve' }, me)).toEqual({
         action: null,
         context: 'eve is testing it',
      });
      expect(note({ status: 'needs_qa', reqaBy: ['frank'] }, me)).toEqual({
         action: null,
         context: "frank's QA fell to a push",
      });
   });

   it('needs_recr names who owes the re-stamp, with the push detail', () => {
      expect(note({ status: 'needs_recr', recrBy: ['gina'] }, me)).toEqual({
         action: null,
         context: 'waiting on gina to re-stamp',
      });
      const pushedAgo = Date.now() / 1000 - 3600;
      const withPush = note(
         { status: 'needs_recr', recrBy: ['gina'], headPushedAt: pushedAgo },
         me
      );
      expect(withPush).toEqual({
         action: null,
         context: 'waiting on gina to re-stamp · fix pushed 1h ago',
      });
   });

   it('needs_cr: an unstamped reviewer of any verdict outranks a comment-only one', () => {
      expect(
         note(
            {
               status: 'needs_cr',
               unstampedReviewers: [{ login: 'holly', state: 'COMMENTED', date: 1 }],
               engagedNoStamp: ['holly', 'iris'],
            },
            me
         )
      ).toEqual({ action: 'Answer the review', context: 'from holly' });
   });

   it('needs_cr: comment-only engagement (no reviewer) is a discussion wait', () => {
      expect(note({ status: 'needs_cr', engagedNoStamp: ['iris'] }, me)).toEqual({
         action: null,
         context: 'in discussion with iris',
      });
   });

   it('needs_cr: untouched and starved chases a review', () => {
      expect(note({ status: 'needs_cr', starved: true, ageDays: 12 }, me)).toEqual({
         action: 'Chase a review',
         context: 'unreviewed 12d',
      });
   });

   it('needs_cr: fresh and untouched sits in the queue', () => {
      expect(note({ status: 'needs_cr' }, me)).toEqual({
         action: null,
         context: 'in the CR queue',
      });
      expect(note({ status: 'needs_cr', crHave: 1, crReq: 2 }, me)).toEqual({
         action: null,
         context: 'in the CR queue · 1 of 2',
      });
   });

   it('ci_pending', () => {
      expect(note({ status: 'ci_pending' }, me)).toEqual({
         action: null,
         context: 'CI running — then merge',
      });
   });

   it('deploy_block', () => {
      expect(note({ status: 'deploy_block', deployBlockedBy: ['jack'] }, me)).toEqual({
         action: null,
         context: 'ask jack before deploy',
      });
   });

   it('an external block only overrides a wait, never a do', () => {
      expect(note({ status: 'ci_pending', externalBlock: true }, me)).toEqual({
         action: null,
         context: 'on hold — external blocker',
      });
      expect(note({ status: 'ready', externalBlock: true }, me)).toEqual({
         action: 'Merge it',
         context: null,
      });
   });
});

describe('rowNote — the non-author matrix', () => {
   const me = 'me';
   const author = 'auth';

   it('a stale stamp that fell to you is a re-stamp move, with the push detail', () => {
      expect(note({ author, status: 'needs_recr', recrBy: ['me'] }, me)).toEqual({
         action: 'Re-stamp',
         context: null,
      });
      const pushedAgo = Date.now() / 1000 - 7200;
      expect(
         note({ author, status: 'needs_recr', recrBy: ['me'], headPushedAt: pushedAgo }, me)
      ).toEqual({ action: 'Re-stamp', context: 'fix pushed 2h ago' });
   });

   it('claimed QA is a finish move; QA that fell to you is a re-QA move', () => {
      expect(note({ author, status: 'needs_qa', qaingLogin: 'me' }, me)).toEqual({
         action: 'Finish QA',
         context: null,
      });
      expect(note({ author, status: 'needs_qa', reqaBy: ['me'] }, me)).toEqual({
         action: 'Re-QA',
         context: null,
      });
   });

   it('draft', () => {
      expect(note({ author, status: 'draft' }, me)).toEqual({
         action: null,
         context: 'draft — not reviewable yet',
      });
   });

   it('ci_red', () => {
      expect(note({ author, status: 'ci_red' }, me)).toEqual({
         action: null,
         context: 'CI red · author fixes',
      });
   });

   it('dev_block: your own block reads differently than someone else’s', () => {
      expect(note({ author, status: 'dev_block', devBlockedBy: ['me'] }, me)).toEqual({
         action: null,
         context: 'your block stands — lift when happy',
      });
      expect(note({ author, status: 'dev_block', devBlockedBy: ['bob'] }, me)).toEqual({
         action: null,
         context: 'feedback from bob',
      });
   });

   it('changes requested beats a plain "Review it" for a non-author', () => {
      expect(note({ author, status: 'needs_cr', changesRequestedBy: ['carol'] }, me)).toEqual({
         action: null,
         context: 'changes requested by carol',
      });
      expect(
         note({ author, status: 'needs_recr', changesRequestedBy: ['carol'], recrBy: ['dave'] }, me)
      ).toEqual({ action: null, context: 'changes requested by carol' });
   });

   it('adapted: an already-active CR stamp outranks the generic needs_recr wait', () => {
      // the spec's literal order would fall through to the generic "waiting
      // on X to re-stamp" line here too, but that erases the fact that this
      // viewer already stamped — the crBy check runs first (see report)
      expect(
         note(
            {
               author,
               status: 'needs_recr',
               crBy: ['me'],
               recrBy: ['other-reviewer'],
               crHave: 1,
               crReq: 2,
            },
            me
         )
      ).toEqual({ action: null, context: "you've stamped · 1 of 2" });
   });

   it('needs_recr with no stake of your own is a generic wait', () => {
      expect(note({ author, status: 'needs_recr', recrBy: ['gina'] }, me)).toEqual({
         action: null,
         context: 'waiting on gina',
      });
   });

   it('needs_cr: you already stamped', () => {
      expect(note({ author, status: 'needs_cr', crBy: ['me'], crHave: 1, crReq: 2 }, me)).toEqual({
         action: null,
         context: "you've stamped · 1 of 2",
      });
   });

   it('needs_cr: qualifiers are mutually exclusive, in priority order', () => {
      expect(note({ author, status: 'needs_cr', starved: true, ageDays: 9 }, me)).toEqual({
         action: 'Review it',
         context: 'unreviewed 9d',
      });
      expect(note({ author, status: 'needs_cr', crHave: 1, crReq: 2 }, me)).toEqual({
         action: 'Review it',
         context: '1 of 2 in',
      });
      expect(note({ author, status: 'needs_cr', engagedNoStamp: ['kate'] }, me)).toEqual({
         action: 'Review it',
         context: 'kate looking',
      });
      expect(note({ author, status: 'needs_cr' }, me)).toEqual({
         action: 'Review it',
         context: null,
      });
   });

   it('needs_qa: partial QA counts for the viewer, someone else testing, unclaimed', () => {
      expect(note({ author, status: 'needs_qa', qaBy: ['me'], qaHave: 1, qaReq: 2 }, me)).toEqual({
         action: null,
         context: "you've QA'd · 1 of 2",
      });
      expect(note({ author, status: 'needs_qa', qaingLogin: 'leo' }, me)).toEqual({
         action: null,
         context: 'leo is testing it',
      });
      expect(note({ author, status: 'needs_qa' }, me)).toEqual({ action: 'QA it', context: null });
      expect(note({ author, status: 'needs_qa', qaHave: 1, qaReq: 2 }, me)).toEqual({
         action: 'QA it',
         context: '1 of 2 in',
      });
   });

   it('deploy_block', () => {
      expect(note({ author, status: 'deploy_block', deployBlockedBy: ['jack'] }, me)).toEqual({
         action: null,
         context: 'ask jack first',
      });
   });

   it('unmergeable: conflict vs a dependent-only base', () => {
      expect(note({ author, status: 'unmergeable', conflict: true }, me)).toEqual({
         action: null,
         context: 'conflicts · author rebases',
      });
      expect(note({ author, status: 'unmergeable', conflict: false, dependent: true }, me)).toEqual(
         { action: null, context: 'lands with its parent' }
      );
   });

   it('ci_pending', () => {
      expect(note({ author, status: 'ci_pending' }, me)).toEqual({
         action: null,
         context: 'only CI left',
      });
   });

   it('ready nudges the author by name', () => {
      expect(note({ author, status: 'ready' }, me)).toEqual({
         action: null,
         context: 'ready · nudge auth if it sits',
      });
   });

   it('an external block overrides a wait note, same as for the author', () => {
      expect(note({ author, status: 'ready', externalBlock: true }, me)).toEqual({
         action: null,
         context: 'on hold — external blocker',
      });
      // but never a do
      expect(
         note({ author, status: 'needs_qa', qaingLogin: 'me', externalBlock: true }, me)
      ).toEqual({ action: 'Finish QA', context: null });
   });
});

describe('rowNote — never blank for an open pull', () => {
   const viewers: Array<{ label: string; author: string; me: string }> = [
      { label: 'as the author', author: 'me', me: 'me' },
      { label: 'as an uninvolved reviewer', author: 'auth', me: 'me' },
   ];

   for (const status of STATUS_ORDER) {
      for (const { label, author, me } of viewers) {
         it(`${status} ${label}`, () => {
            const p = dp({ author, status });
            const result = rowNote(p, me);
            expect(result.action || result.context).toBeTruthy();
            expect(result.action === null || typeof result.action === 'string').toBe(true);
            expect(result.context === null || typeof result.context === 'string').toBe(true);
         });
      }
   }

   it('also holds for a reviewer who already stamped, is testing, or fell into a re-stamp', () => {
      const cases: Array<Parameters<typeof dp>[0]> = [
         { author: 'auth', status: 'needs_recr', recrBy: ['me'] },
         { author: 'auth', status: 'needs_qa', qaingLogin: 'me' },
         { author: 'auth', status: 'needs_qa', reqaBy: ['me'] },
         { author: 'auth', status: 'needs_cr', crBy: ['me'], crHave: 1, crReq: 2 },
      ];
      for (const c of cases) {
         const result = rowNote(dp(c), 'me');
         expect(result.action || result.context).toBeTruthy();
      }
   });
});

describe('actionState — one bucket per (pull, viewer)', () => {
   it('restamp: a re-CR fallen to the viewer', () => {
      expect(actionState(dp({ author: 'auth', status: 'needs_recr', recrBy: ['me'] }), 'me')).toBe(
         'restamp'
      );
   });

   it('restamp: a re-QA fallen to the viewer', () => {
      expect(actionState(dp({ author: 'auth', status: 'needs_qa', reqaBy: ['me'] }), 'me')).toBe(
         'restamp'
      );
   });

   it('review: an unreviewed pull, viewer not the author', () => {
      expect(actionState(dp({ author: 'auth', status: 'needs_cr' }), 'me')).toBe('review');
   });

   it('qa: an unclaimed QA slot, viewer not the author', () => {
      expect(actionState(dp({ author: 'auth', status: 'needs_qa' }), 'me')).toBe('qa');
   });

   it('mine: an action that is neither "Review it" nor "QA it"', () => {
      // the author's own ready-to-merge pull: rowNote gives "Merge it"
      expect(actionState(dp({ author: 'me', status: 'ready' }), 'me')).toBe('mine');
   });

   it("blocked: dev_block or deploy_block with no move of the viewer's own", () => {
      expect(
         actionState(dp({ author: 'auth', status: 'dev_block', devBlockedBy: ['bob'] }), 'me')
      ).toBe('blocked');
      expect(
         actionState(dp({ author: 'auth', status: 'deploy_block', deployBlockedBy: ['bob'] }), 'me')
      ).toBe('blocked');
   });

   it('waiting: no action, not blocked', () => {
      expect(
         actionState(dp({ author: 'auth', status: 'needs_recr', recrBy: ['other'] }), 'me')
      ).toBe('waiting');
   });

   it('dev-block-as-author lands in mine, not blocked — viewer-relative, unlike is:blocked', () => {
      expect(
         actionState(dp({ author: 'me', status: 'dev_block', devBlockedBy: ['bob'] }), 'me')
      ).toBe('mine');
   });

   it('a bystander on the same dev-blocked pull reads blocked', () => {
      expect(
         actionState(dp({ author: 'auth', status: 'dev_block', devBlockedBy: ['bob'] }), 'me')
      ).toBe('blocked');
   });

   it('restamp beats review: an outstanding re-stamp wins even on a pull that would', () => {
      // otherwise read as a plain "Review it" — recrBy is checked before
      // rowNote is ever computed, so it can't be shadowed by the note text
      expect(actionState(dp({ author: 'auth', status: 'needs_cr', recrBy: ['me'] }), 'me')).toBe(
         'restamp'
      );
   });
});
