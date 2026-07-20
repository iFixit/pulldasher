import { describe, expect, it } from 'vitest';
import type { DerivedPull, Status } from './status';
import { STATUS_ORDER } from './status';
import { alertMove, rowNote } from './actions';

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
      expect(note({ status: 'draft' }, me)).toEqual({ text: 'Finish the draft', tone: 'do' });
   });

   it('ci_red names the failing checks when known', () => {
      expect(note({ status: 'ci_red', ciFailing: ['playwright'] }, me)).toEqual({
         text: 'Fix CI · playwright',
         tone: 'do',
      });
      expect(note({ status: 'ci_red' }, me)).toEqual({ text: 'Fix CI', tone: 'do' });
   });

   it('dev_block names the blocker', () => {
      expect(note({ status: 'dev_block', devBlockedBy: ['bob'] }, me)).toEqual({
         text: "Address bob's feedback",
         tone: 'do',
      });
   });

   it('changesRequestedBy beats the plain needs_recr wait', () => {
      expect(
         note({ status: 'needs_recr', changesRequestedBy: ['carol'], recrBy: ['dave'] }, me)
      ).toEqual({ text: "Address carol's feedback", tone: 'do' });
   });

   it('a conflict masks the CR-incomplete state (regardless of status)', () => {
      expect(note({ status: 'needs_cr', conflict: true, crHave: 0, crReq: 2 }, me)).toEqual({
         text: 'Rebase · CR still needed',
         tone: 'do',
      });
      // CR already met: no qualifier
      expect(note({ status: 'needs_qa', conflict: true, crHave: 2, crReq: 2 }, me)).toEqual({
         text: 'Rebase',
         tone: 'do',
      });
   });

   it('dependent-only unmergeable (no conflict) waits on the parent', () => {
      expect(note({ status: 'unmergeable', dependent: true, conflict: false }, me)).toEqual({
         text: 'lands with its parent',
         tone: 'wait',
      });
   });

   it('ready', () => {
      expect(note({ status: 'ready' }, me)).toEqual({ text: 'Merge it', tone: 'do' });
   });

   it('needs_qa: unclaimed, testing, and re-QA-fell-through', () => {
      expect(note({ status: 'needs_qa' }, me)).toEqual({ text: 'Find a QA-er', tone: 'do' });
      expect(note({ status: 'needs_qa', qaingLogin: 'eve' }, me)).toEqual({
         text: 'eve is testing it',
         tone: 'wait',
      });
      expect(note({ status: 'needs_qa', reqaBy: ['frank'] }, me)).toEqual({
         text: "frank's QA fell to a push",
         tone: 'wait',
      });
   });

   it('needs_recr names who owes the re-stamp, with the push detail', () => {
      expect(note({ status: 'needs_recr', recrBy: ['gina'] }, me)).toEqual({
         text: 'waiting on gina to re-stamp',
         tone: 'wait',
      });
      const pushedAgo = Date.now() / 1000 - 3600;
      const withPush = note(
         { status: 'needs_recr', recrBy: ['gina'], headPushedAt: pushedAgo },
         me
      );
      expect(withPush.text).toBe('waiting on gina to re-stamp · fix pushed 1h ago');
      expect(withPush.tone).toBe('wait');
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
      ).toEqual({ text: "Answer holly's review", tone: 'do' });
   });

   it('needs_cr: comment-only engagement (no reviewer) is a discussion wait', () => {
      expect(note({ status: 'needs_cr', engagedNoStamp: ['iris'] }, me)).toEqual({
         text: 'in discussion with iris',
         tone: 'wait',
      });
   });

   it('needs_cr: untouched and starved chases a review', () => {
      expect(note({ status: 'needs_cr', starved: true, ageDays: 12 }, me)).toEqual({
         text: 'Chase a review · unreviewed 12d',
         tone: 'do',
      });
   });

   it('needs_cr: fresh and untouched sits in the queue', () => {
      expect(note({ status: 'needs_cr' }, me)).toEqual({
         text: 'in the CR queue',
         tone: 'wait',
      });
      expect(note({ status: 'needs_cr', crHave: 1, crReq: 2 }, me)).toEqual({
         text: 'in the CR queue · 1 of 2',
         tone: 'wait',
      });
   });

   it('ci_pending', () => {
      expect(note({ status: 'ci_pending' }, me)).toEqual({
         text: 'CI running — then merge',
         tone: 'wait',
      });
   });

   it('deploy_block', () => {
      expect(note({ status: 'deploy_block', deployBlockedBy: ['jack'] }, me)).toEqual({
         text: 'ask jack before deploy',
         tone: 'wait',
      });
   });

   it('an external block only overrides a wait, never a do', () => {
      expect(note({ status: 'ci_pending', externalBlock: true }, me)).toEqual({
         text: 'on hold — external blocker',
         tone: 'wait',
      });
      expect(note({ status: 'ready', externalBlock: true }, me)).toEqual({
         text: 'Merge it',
         tone: 'do',
      });
   });
});

describe('rowNote — the non-author matrix', () => {
   const me = 'me';
   const author = 'auth';

   it('a stale stamp that fell to you is a re-stamp move, with the push detail', () => {
      expect(note({ author, status: 'needs_recr', recrBy: ['me'] }, me)).toEqual({
         text: 'Re-stamp',
         tone: 'do',
      });
      const pushedAgo = Date.now() / 1000 - 7200;
      expect(
         note({ author, status: 'needs_recr', recrBy: ['me'], headPushedAt: pushedAgo }, me)
      ).toEqual({ text: 'Re-stamp · fix pushed 2h ago', tone: 'do' });
   });

   it('claimed QA is a finish move; QA that fell to you is a re-QA move', () => {
      expect(note({ author, status: 'needs_qa', qaingLogin: 'me' }, me)).toEqual({
         text: 'Finish QA',
         tone: 'do',
      });
      expect(note({ author, status: 'needs_qa', reqaBy: ['me'] }, me)).toEqual({
         text: 'Re-QA',
         tone: 'do',
      });
   });

   it('draft', () => {
      expect(note({ author, status: 'draft' }, me)).toEqual({
         text: 'draft — not reviewable yet',
         tone: 'wait',
      });
   });

   it('ci_red', () => {
      expect(note({ author, status: 'ci_red' }, me)).toEqual({
         text: 'CI red · author fixes',
         tone: 'wait',
      });
   });

   it('dev_block: your own block reads differently than someone else’s', () => {
      expect(note({ author, status: 'dev_block', devBlockedBy: ['me'] }, me)).toEqual({
         text: 'your block stands — lift when happy',
         tone: 'wait',
      });
      expect(note({ author, status: 'dev_block', devBlockedBy: ['bob'] }, me)).toEqual({
         text: 'feedback from bob',
         tone: 'wait',
      });
   });

   it('changes requested beats a plain "Review it" for a non-author', () => {
      expect(note({ author, status: 'needs_cr', changesRequestedBy: ['carol'] }, me)).toEqual({
         text: 'changes requested by carol',
         tone: 'wait',
      });
      expect(
         note({ author, status: 'needs_recr', changesRequestedBy: ['carol'], recrBy: ['dave'] }, me)
      ).toEqual({ text: 'changes requested by carol', tone: 'wait' });
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
      ).toEqual({ text: "you've stamped · 1 of 2", tone: 'wait' });
   });

   it('needs_recr with no stake of your own is a generic wait', () => {
      expect(note({ author, status: 'needs_recr', recrBy: ['gina'] }, me)).toEqual({
         text: 'waiting on gina',
         tone: 'wait',
      });
   });

   it('needs_cr: you already stamped', () => {
      expect(note({ author, status: 'needs_cr', crBy: ['me'], crHave: 1, crReq: 2 }, me)).toEqual({
         text: "you've stamped · 1 of 2",
         tone: 'wait',
      });
   });

   it('needs_cr: qualifiers are mutually exclusive, in priority order', () => {
      expect(note({ author, status: 'needs_cr', starved: true, ageDays: 9 }, me)).toEqual({
         text: 'Review it · unreviewed 9d',
         tone: 'do',
      });
      expect(note({ author, status: 'needs_cr', crHave: 1, crReq: 2 }, me)).toEqual({
         text: 'Review it · 1 of 2 in',
         tone: 'do',
      });
      expect(note({ author, status: 'needs_cr', engagedNoStamp: ['kate'] }, me)).toEqual({
         text: 'Review it · kate looking',
         tone: 'do',
      });
      expect(note({ author, status: 'needs_cr' }, me)).toEqual({
         text: 'Review it',
         tone: 'do',
      });
   });

   it('needs_qa: partial QA counts for the viewer, someone else testing, unclaimed', () => {
      expect(note({ author, status: 'needs_qa', qaBy: ['me'], qaHave: 1, qaReq: 2 }, me)).toEqual({
         text: "you've QA'd · 1 of 2",
         tone: 'wait',
      });
      expect(note({ author, status: 'needs_qa', qaingLogin: 'leo' }, me)).toEqual({
         text: 'leo is testing it',
         tone: 'wait',
      });
      expect(note({ author, status: 'needs_qa' }, me)).toEqual({ text: 'QA it', tone: 'do' });
      expect(note({ author, status: 'needs_qa', qaHave: 1, qaReq: 2 }, me)).toEqual({
         text: 'QA it · 1 of 2 in',
         tone: 'do',
      });
   });

   it('deploy_block', () => {
      expect(note({ author, status: 'deploy_block', deployBlockedBy: ['jack'] }, me)).toEqual({
         text: 'ask jack first',
         tone: 'wait',
      });
   });

   it('unmergeable: conflict vs a dependent-only base', () => {
      expect(note({ author, status: 'unmergeable', conflict: true }, me)).toEqual({
         text: 'conflicts · author rebases',
         tone: 'wait',
      });
      expect(note({ author, status: 'unmergeable', conflict: false, dependent: true }, me)).toEqual(
         { text: 'lands with its parent', tone: 'wait' }
      );
   });

   it('ci_pending', () => {
      expect(note({ author, status: 'ci_pending' }, me)).toEqual({
         text: 'only CI left',
         tone: 'wait',
      });
   });

   it('ready nudges the author by name', () => {
      expect(note({ author, status: 'ready' }, me)).toEqual({
         text: 'ready · nudge auth if it sits',
         tone: 'wait',
      });
   });

   it('an external block overrides a wait note, same as for the author', () => {
      expect(note({ author, status: 'ready', externalBlock: true }, me)).toEqual({
         text: 'on hold — external blocker',
         tone: 'wait',
      });
      // but never a do
      expect(
         note({ author, status: 'needs_qa', qaingLogin: 'me', externalBlock: true }, me)
      ).toEqual({ text: 'Finish QA', tone: 'do' });
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
            expect(typeof result.text).toBe('string');
            expect(result.text.length).toBeGreaterThan(0);
            expect(['do', 'wait']).toContain(result.tone);
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
         expect(result.text.length).toBeGreaterThan(0);
      }
   });
});
