import { describe, expect, it } from 'vitest';
import type { DerivedPull, Status, Weight } from '../../../shared/model/status';
import { buildReviewLanes, type ReviewLanesInput } from './reviewLanes';

/** A DerivedPull with only the fields buildReviewLanes (and everything it
 * delegates to — rowNote/rowWord, dealRank, crSort, matchesRegion,
 * repoBlocks, claimFor) reads. Defaults describe a plain, fully-open
 * needs_cr pull from someone else, freshly pushed (old enough that
 * isIterating never demotes it by accident) and untouched by the viewer, so
 * a test only needs to override what it's actually exercising. */
function dp(o: {
   repo?: string;
   number?: number;
   author?: string;
   status?: Status;
   ci?: 'success' | 'pending' | 'failing' | 'none';
   crReq?: number;
   qaReq?: number;
   crHave?: number;
   qaHave?: number;
   crBy?: string[];
   qaBy?: string[];
   recrBy?: string[];
   reqaBy?: string[];
   ageDays?: number;
   starved?: boolean;
   starveScore?: number;
   weight?: Weight;
   conflict?: boolean;
   dependent?: boolean;
   cryo?: boolean;
   qaingLogin?: string | null;
   devBlockedBy?: string[];
   deployBlockedBy?: string[];
   changesRequestedBy?: string[];
   engagedNoStamp?: string[];
   externalBlock?: boolean;
   headPushedAt?: number | null;
   draft?: boolean;
   title?: string;
   body?: string;
   labels?: string[];
   branch?: string;
   reviewRequests?: { login: string; at: number | null; self: boolean }[];
   requestedReviewers?: string[];
}): DerivedPull {
   return {
      data: {
         repo: o.repo ?? 'org/repo',
         number: o.number ?? 1,
         user: { login: o.author ?? 'alice' },
         status: {
            cr_req: o.crReq ?? 1,
            qa_req: o.qaReq ?? 1,
            unstamped_reviewers: [],
         },
         additions: 10,
         deletions: 0,
         // old enough that isIterating (< 30 min) never demotes it by accident
         updated_at: '2024-01-01T00:00:00Z',
         title: o.title ?? 'Fix the thing',
         body: o.body ?? '',
         head: { ref: o.branch ?? 'fix-the-thing' },
         labels: (o.labels ?? []).map(title => ({
            title,
            number: 1,
            repo: o.repo ?? 'org/repo',
            user: 'alice',
            created_at: '2024-01-01T00:00:00Z',
         })),
         review_requests: o.reviewRequests ?? [],
         requested_reviewers: o.requestedReviewers ?? [],
         draft: o.draft ?? false,
      },
      status: o.status ?? 'needs_cr',
      ci: o.ci ?? 'success',
      ciFailing: [],
      crBy: o.crBy ?? [],
      qaBy: o.qaBy ?? [],
      crHave: o.crHave ?? 0,
      qaHave: o.qaHave ?? 0,
      recrBy: o.recrBy ?? [],
      reqaBy: o.reqaBy ?? [],
      headPushedAt: o.headPushedAt ?? null,
      ageDays: o.ageDays ?? 1,
      signedOffAt: null,
      starved: o.starved ?? false,
      starveScore: o.starveScore ?? 0,
      weight: o.weight ?? 'M',
      conflict: o.conflict ?? false,
      mergeUnknown: false,
      dependent: o.dependent ?? false,
      devBlockedBy: o.devBlockedBy ?? [],
      deployBlockedBy: o.deployBlockedBy ?? [],
      qaingLogin: o.qaingLogin ?? null,
      externalBlock: o.externalBlock ?? false,
      cryo: o.cryo ?? false,
      changesRequestedBy: o.changesRequestedBy ?? [],
      engagedNoStamp: o.engagedNoStamp ?? [],
   } as unknown as DerivedPull;
}

/** buildReviewLanes' input, defaulted to an empty, unconfigured board so a
 * test only has to name the pulls and settings it's actually exercising. */
function input(o: Partial<ReviewLanesInput> & { pulls?: DerivedPull[] }): ReviewLanesInput {
   return {
      pulls: [],
      bots: [],
      closed: [],
      napping: [],
      changed: [],
      me: 'me',
      selfReview: true,
      teams: [],
      codeRegions: [],
      repoPriority: [],
      ...o,
   };
}

describe('buildReviewLanes — review queue', () => {
   it('places a reviewable pull from someone else in the queue', () => {
      const p = dp({ author: 'alice', status: 'needs_cr' });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).toEqual([p]);
   });

   it('includes a needs_recr pull whose re-stamp is owed by someone else', () => {
      const p = dp({ author: 'alice', status: 'needs_recr', recrBy: ['bob'] });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).toEqual([p]);
   });

   it('excludes a pull you already hold a live CR stamp on (it waits on the other reviewer instead)', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', crBy: ['me'], crReq: 2 });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).not.toContain(p);
      expect(lanes.yoursWaiting).toContain(p);
   });

   it('excludes your own pull from the queue', () => {
      const mine = dp({ author: 'me', status: 'needs_cr' });
      const lanes = buildReviewLanes(input({ pulls: [mine] }));
      expect(lanes.queue).not.toContain(mine);
   });

   it('excludes a cryo (parked) pull entirely from the queue', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', cryo: true });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).not.toContain(p);
   });

   it('sinks a reviewable pull outside your primary repos to queueOther', () => {
      // primarySet is inferred from repos you've authored or stamped — with
      // one, every other repo is "other"
      const mine = dp({ repo: 'org/home', number: 1, author: 'me', status: 'needs_cr' });
      const elsewhere = dp({ repo: 'org/away', number: 2, author: 'alice', status: 'needs_cr' });
      const lanes = buildReviewLanes(input({ pulls: [mine, elsewhere] }));
      expect(lanes.queue).not.toContain(elsewhere);
      expect(lanes.queueOther).toEqual([elsewhere]);
   });

   it('keeps every repo primary when the viewer has no authored/stamped repo yet', () => {
      const p = dp({ repo: 'org/anything', author: 'alice', status: 'needs_cr' });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).toEqual([p]);
      expect(lanes.queueOther).toEqual([]);
   });
});

describe('buildReviewLanes — needs QA', () => {
   it('places a QA-incomplete, CI-green pull in needsQa', () => {
      const p = dp({ author: 'alice', status: 'needs_qa', ci: 'success' });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.needsQa).toEqual([p]);
   });

   it('excludes a pull with failing CI', () => {
      const p = dp({ author: 'alice', status: 'needs_qa', ci: 'failing' });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.needsQa).not.toContain(p);
   });

   it('excludes a draft', () => {
      const p = dp({ author: 'alice', status: 'draft', draft: true });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.needsQa).not.toContain(p);
   });

   it('excludes a pull you already QA-stamped (it lands in yoursWaiting instead)', () => {
      const p = dp({ author: 'alice', status: 'needs_qa', qaBy: ['me'], qaReq: 2 });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.needsQa).not.toContain(p);
      expect(lanes.yoursWaiting).toContain(p);
   });

   it('sinks a QA-incomplete pull outside your primary repos to needsQaOther', () => {
      const mine = dp({ repo: 'org/home', number: 1, author: 'me', status: 'needs_cr' });
      const elsewhere = dp({
         repo: 'org/away',
         number: 2,
         author: 'alice',
         status: 'needs_qa',
      });
      const lanes = buildReviewLanes(input({ pulls: [mine, elsewhere] }));
      expect(lanes.needsQa).not.toContain(elsewhere);
      expect(lanes.needsQaOther).toEqual([elsewhere]);
   });
});

describe('buildReviewLanes — waiting on you vs waiting on others', () => {
   it('puts your own ready-to-merge pull in yourMove', () => {
      const mine = dp({ author: 'me', status: 'ready' });
      const lanes = buildReviewLanes(input({ pulls: [mine] }));
      expect(lanes.yourMove).toEqual([mine]);
      expect(lanes.yoursWaiting).not.toContain(mine);
   });

   it('puts an owed re-stamp in yourMove', () => {
      const p = dp({ author: 'alice', status: 'needs_recr', recrBy: ['me'] });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.yourMove).toEqual([p]);
   });

   it('puts a pull GitHub explicitly requested from you in yourMove', () => {
      const p = dp({
         author: 'alice',
         status: 'needs_cr',
         requestedReviewers: ['me'],
      });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.yourMove).toContain(p);
   });

   it('puts your own pull still waiting on review in yoursWaiting, not yourMove', () => {
      const mine = dp({ author: 'me', status: 'needs_cr' });
      const lanes = buildReviewLanes(input({ pulls: [mine] }));
      expect(lanes.yourMove).not.toContain(mine);
      expect(lanes.yoursWaiting).toEqual([mine]);
   });

   it('puts a pull you have CR-stamped, not yet fully signed off, in yoursWaiting', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', crBy: ['me'], crReq: 2 });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.yoursWaiting).toEqual([p]);
   });

   it('dedupes a pull that qualifies for yourMove through two routes at once', () => {
      // claimed by you AND explicitly requested from you — both routes feed
      // yourMove, but the pull must only appear once
      const p = dp({
         author: 'alice',
         status: 'needs_cr',
         requestedReviewers: ['me'],
         reviewRequests: [{ login: 'me', at: 1700000000, self: true }],
      });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.yourMove.filter(x => x === p)).toHaveLength(1);
   });
});

describe('buildReviewLanes — region matches', () => {
   it('surfaces a pull matching a configured code region and pulls it out of the queue', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', title: 'Rework the Shopify sync' });
      const lanes = buildReviewLanes(input({ pulls: [p], codeRegions: ['Shopify'] }));
      expect(lanes.regionMatches).toEqual([p]);
      expect(lanes.queue).not.toContain(p);
   });

   it('leaves regionMatches empty when no regions are configured', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', title: 'Rework the Shopify sync' });
      const lanes = buildReviewLanes(input({ pulls: [p], codeRegions: [] }));
      expect(lanes.regionMatches).toEqual([]);
      expect(lanes.queue).toEqual([p]);
   });

   it('pulls a QA-pool match out of needsQa into regionMatches too', () => {
      const p = dp({
         author: 'alice',
         status: 'needs_qa',
         title: 'Rework the Shopify sync',
      });
      const lanes = buildReviewLanes(input({ pulls: [p], codeRegions: ['Shopify'] }));
      expect(lanes.regionMatches).toEqual([p]);
      expect(lanes.needsQa).not.toContain(p);
   });
});

describe('buildReviewLanes — stamped and ready lanes', () => {
   it('places a fully signed-off human pull in ready', () => {
      const p = dp({ author: 'alice', status: 'ready' });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.ready).toEqual([p]);
   });

   it('includes a ready bot PR in ready alongside human ones, oldest first', () => {
      const human = dp({ author: 'alice', status: 'ready', ageDays: 1 });
      const bot = dp({ author: 'dependabot[bot]', number: 2, status: 'ready', ageDays: 5 });
      const lanes = buildReviewLanes(input({ pulls: [human], bots: [bot] }));
      expect(lanes.ready).toEqual([bot, human]);
   });

   it('keeps a stamped (CR-incomplete, your stamp live) pull out of the queue and in yoursWaiting', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', crBy: ['me'], crReq: 2 });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).toEqual([]);
      expect(lanes.yoursWaiting).toEqual([p]);
   });
});

describe('buildReviewLanes — board summary', () => {
   it('flags empty when there are no open pulls, bots, or closed pulls', () => {
      const lanes = buildReviewLanes(input({}));
      expect(lanes.empty).toBe(true);
   });

   it('is not empty when a closed pull exists even with no open work', () => {
      const lanes = buildReviewLanes(input({ closed: [{ repo: 'org/repo', number: 9 } as never] }));
      expect(lanes.empty).toBe(false);
   });

   it('boardIsQuiet is false once the queue has something in it', () => {
      const p = dp({ author: 'alice', status: 'needs_cr' });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.boardIsQuiet).toBe(false);
   });

   it('boardIsQuiet is true when every primary lane is empty', () => {
      const lanes = buildReviewLanes(input({}));
      expect(lanes.boardIsQuiet).toBe(true);
   });

   it('counts everything folded in "the rest of the board", closed pulls included', () => {
      // qaReq: 0 keeps `other` out of needsQaOther too, so only one lane (plus
      // the closed pull) is under test here — QA running in parallel with CR
      // is covered by its own describe block above.
      const other = dp({
         repo: 'org/away',
         number: 2,
         author: 'alice',
         status: 'needs_cr',
         qaReq: 0,
      });
      const mine = dp({ repo: 'org/home', number: 1, author: 'me', status: 'ready' });
      const lanes = buildReviewLanes(
         input({
            pulls: [mine, other],
            closed: [{ repo: 'org/repo', number: 9 } as never],
         })
      );
      // `other` sinks to queueOther (outside the one primary repo); +1 closed
      expect(lanes.restTotal).toBe(2);
   });
});
