import { describe, expect, it } from 'vitest';
import type { DerivedPull, Status, Weight } from '../../../shared/model/status';
import { buildReviewLanes, type ReviewLanesInput } from './reviewLanes';

/** A DerivedPull with only the fields buildReviewLanes (and everything it
 * delegates to — rowNote/rowWord, dealRank, crSort, matchesRegion,
 * repoBlocks, claimFor) reads. Defaults describe a plain, fully-open
 * needs_cr pull from someone else, freshly pushed (old enough that
 * isIterating never demotes it by accident) and untouched by the viewer, so
 * a test only needs to override what it's actually exercising. That someone
 * is outside the dev team (ownReview false), so their review is anyone's;
 * `ownReview: true` is a developer's own unrequested pull. askedOf follows
 * requestedReviewers minus claims, as derive() builds it. */
function dp(o: {
   ownReview?: boolean;
   askedOf?: string[];
   askedAt?: number | null;
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
   requestedTeams?: string[];
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
         requested_teams: o.requestedTeams ?? [],
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
      ownReview: o.ownReview ?? false,
      askedOf:
         o.askedOf ??
         (o.requestedReviewers ?? []).filter(
            l => !(o.reviewRequests ?? []).some(r => r.self && r.login === l)
         ),
      askedAt: o.askedAt ?? null,
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

   it('excludes a pull you already hold a live CR stamp on (the rest is its author’s)', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', crBy: ['me'], crReq: 2 });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).not.toContain(p);
      expect(lanes.yoursWaiting).not.toContain(p);
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

   it('excludes a pull you already QA-stamped', () => {
      const p = dp({ author: 'alice', status: 'needs_qa', qaBy: ['me'], qaReq: 2 });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.needsQa).not.toContain(p);
      expect(lanes.yoursWaiting).not.toContain(p);
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
   it('leaves your own ready-to-merge pull to the Ready to merge lane, not Waiting on you', () => {
      // the lane leads the tab; listing it in both places only duplicated the Merge row
      const mine = dp({ author: 'me', status: 'ready' });
      const lanes = buildReviewLanes(input({ pulls: [mine] }));
      expect(lanes.ready).toEqual([mine]);
      expect(lanes.yourMove).toEqual([]);
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

   it('puts your own pull waiting on the people you asked in yoursWaiting, not yourMove', () => {
      const mine = dp({ author: 'me', status: 'needs_cr', askedOf: ['bob'] });
      const lanes = buildReviewLanes(input({ pulls: [mine] }));
      expect(lanes.yourMove).not.toContain(mine);
      expect(lanes.yoursWaiting).toEqual([mine]);
   });

   it('keeps a stamp you gave on someone else’s PR out of yoursWaiting: only your PRs wait there', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', crBy: ['me'], crReq: 2 });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.yoursWaiting).toEqual([]);
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

describe('buildReviewLanes — self-review: nobody else is assigned a developer’s own PR', () => {
   it('keeps a developer’s unrequested PR out of everyone else’s queue, QA, and Waiting on you', () => {
      const own = dp({
         author: 'alice',
         status: 'needs_cr',
         ownReview: true,
         starved: true,
         ageDays: 30,
      });
      const ownQa = dp({ number: 2, author: 'alice', status: 'needs_qa', ownReview: true });
      const lanes = buildReviewLanes(input({ pulls: [own, ownQa] }));
      expect(lanes.queue).toEqual([]);
      expect(lanes.queueOther).toEqual([]);
      expect(lanes.needsQa).toEqual([]);
      expect(lanes.needsQaOther).toEqual([]);
      expect(lanes.yourMove).toEqual([]);
   });

   it('puts the author’s own stamps in their Waiting on you', () => {
      const cr = dp({ author: 'me', status: 'needs_cr', ownReview: true });
      const restamp = dp({
         number: 2,
         author: 'me',
         status: 'needs_recr',
         recrBy: ['me'],
         ownReview: true,
      });
      const lanes = buildReviewLanes(input({ pulls: [cr, restamp] }));
      expect(lanes.yourMove).toEqual([restamp, cr]);
      expect(lanes.yoursWaiting).toEqual([]);
   });

   it('a review asked of someone else is theirs, not in my queue', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', askedOf: ['bob'] });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).toEqual([]);
      expect(lanes.yourMove).toEqual([]);
   });

   it('a review someone said they’d do is theirs, not in my queue', () => {
      const p = dp({
         author: 'alice',
         status: 'needs_cr',
         requestedReviewers: ['bob'],
         reviewRequests: [{ login: 'bob', at: null, self: true }],
      });
      expect(buildReviewLanes(input({ pulls: [p] })).queue).toEqual([]);
   });

   it('requested-of-you leads Waiting on you, oldest request first', () => {
      const now = Date.now() / 1000;
      const restamp = dp({ number: 1, author: 'alice', status: 'needs_recr', recrBy: ['me'] });
      const newer = dp({ number: 2, author: 'bob', askedOf: ['me'], askedAt: now - 3600 });
      const older = dp({ number: 3, author: 'cy', askedOf: ['me'], askedAt: now - 5 * 3600 });
      const lanes = buildReviewLanes(input({ pulls: [restamp, newer, older] }));
      expect(lanes.yourMove).toEqual([older, newer, restamp]);
   });
});

describe('buildReviewLanes — could use your input', () => {
   it('offers someone’s self-review in your code region, without queueing it', () => {
      const p = dp({ author: 'alice', ownReview: true, title: 'Rework the Shopify sync' });
      const lanes = buildReviewLanes(input({ pulls: [p], codeRegions: ['Shopify'] }));
      expect(lanes.couldUseInput).toEqual([p]);
      expect(lanes.queue).toEqual([]);
      expect(lanes.yourMove).toEqual([]);
      // an offer, not work: the board still reads as quiet
      expect(lanes.boardIsQuiet).toBe(true);
   });

   it('offers a self-review in a repo you’ve reviewed someone else’s PR in, regions first', () => {
      const reviewed = dp({
         repo: 'org/web',
         number: 1,
         author: 'bob',
         status: 'ready',
         crBy: ['me'],
      });
      const inRepo = dp({
         repo: 'org/web',
         number: 2,
         author: 'alice',
         ownReview: true,
         ageDays: 9,
      });
      const inRegion = dp({
         repo: 'org/other',
         number: 3,
         author: 'cy',
         ownReview: true,
         title: 'Shopify webhooks',
      });
      const elsewhere = dp({ repo: 'org/other', number: 4, author: 'dee', ownReview: true });
      const lanes = buildReviewLanes(
         input({ pulls: [reviewed, inRepo, inRegion, elsewhere], codeRegions: ['Shopify'] })
      );
      expect(lanes.couldUseInput).toEqual([inRegion, inRepo]);
   });

   it('leaves out your own, ones you stamped, requested or outside ones, and drafts', () => {
      const pulls = [
         dp({ number: 1, author: 'me', ownReview: true, title: 'Shopify' }),
         dp({
            number: 2,
            author: 'alice',
            ownReview: true,
            crBy: ['me'],
            crReq: 2,
            title: 'Shopify',
         }),
         dp({ number: 3, author: 'alice', askedOf: ['bob'], title: 'Shopify' }),
         dp({ number: 4, author: 'alice', title: 'Shopify' }),
         dp({ number: 5, author: 'alice', ownReview: true, status: 'draft', title: 'Shopify' }),
      ];
      expect(buildReviewLanes(input({ pulls, codeRegions: ['Shopify'] })).couldUseInput).toEqual(
         []
      );
   });
});

describe('buildReviewLanes — stamped and ready lanes', () => {
   it('places your own fully signed-off pull in ready', () => {
      const p = dp({ author: 'me', status: 'ready' });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.ready).toEqual([p]);
   });

   it('shows another person’s ready pull only when you were asked to review it or claimed it', () => {
      const plain = dp({ number: 1, author: 'alice', status: 'ready' });
      const asked = dp({ number: 2, author: 'alice', status: 'ready', requestedReviewers: ['me'] });
      const claimed = dp({
         number: 3,
         author: 'alice',
         status: 'ready',
         requestedReviewers: ['me'],
         reviewRequests: [{ login: 'me', at: 1, self: true }],
      });
      const askedOther = dp({
         number: 4,
         author: 'alice',
         status: 'ready',
         requestedReviewers: ['bob'],
      });
      const lanes = buildReviewLanes(input({ pulls: [plain, asked, claimed, askedOther] }));
      expect(lanes.ready.map(p => p.data.number).sort()).toEqual([2, 3]);
   });

   it('orders ready oldest first, and leaves an unclaimed ready bot PR in the bot fold', () => {
      const newer = dp({ number: 1, author: 'me', status: 'ready', ageDays: 1 });
      const older = dp({ number: 2, author: 'me', status: 'ready', ageDays: 5 });
      const bot = dp({ author: 'dependabot[bot]', number: 3, status: 'ready', ageDays: 9 });
      const lanes = buildReviewLanes(input({ pulls: [newer, older], bots: [bot] }));
      expect(lanes.ready).toEqual([older, newer]);
      expect(lanes.botRest).toEqual([bot]);
   });

   it('draws ready’s bot portion from botsForReady, not bots, when the two differ', () => {
      // "Ignore bot PRs" empties `bots` (the queue-tail/fold pool) but
      // botsForReady bypasses that setting, so a bot PR you claimed still
      // shows in Ready-to-merge even though it's absent from `bots`.
      const bot = dp({
         author: 'dependabot[bot]',
         status: 'ready',
         requestedReviewers: ['me'],
         reviewRequests: [{ login: 'me', at: 1, self: true }],
      });
      const lanes = buildReviewLanes(input({ pulls: [], bots: [], botsForReady: [bot] }));
      expect(lanes.ready).toEqual([bot]);
   });

   it('keeps a stamped (CR-incomplete, your stamp live) pull out of the queue', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', crBy: ['me'], crReq: 2 });
      const lanes = buildReviewLanes(input({ pulls: [p] }));
      expect(lanes.queue).toEqual([]);
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

   it('is not empty when botsForReady holds a ready bot, even with pulls/bots/closed all empty', () => {
      // the bug: "Ignore bot PRs" empties `bots`, and empty only checked
      // pulls/bots/closed — a merge-ready bot reachable through botsForReady
      // (and showing in lanes.ready) still read as "All clear"
      const bot = dp({ author: 'dependabot[bot]', status: 'ready' });
      const lanes = buildReviewLanes(input({ botsForReady: [bot] }));
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

describe('buildReviewLanes — why-line display names', () => {
   it("whyUpNext resolves a teammate's display name instead of their login", () => {
      const p = dp({ author: 'alice', status: 'needs_cr' });
      const lanes = buildReviewLanes(
         input({
            pulls: [p],
            teams: [{ name: 'My team', members: ['alice'] }],
            names: { alice: 'Alice A' },
         })
      );
      expect(lanes.whyUpNext(p)).toBe('From Alice A, on your team: teammates’ PRs lead your queue');
   });

   it('whyUpNext falls back to the login when no display name is known', () => {
      const p = dp({ author: 'alice', status: 'needs_cr' });
      const lanes = buildReviewLanes(
         input({ pulls: [p], teams: [{ name: 'My team', members: ['alice'] }] })
      );
      expect(lanes.whyUpNext(p)).toBe('From alice, on your team: teammates’ PRs lead your queue');
   });

   it('whyUpNext threads names into startHereReason for a non-teammate', () => {
      const target = dp({
         author: 'alice',
         status: 'needs_cr',
         askedOf: ['me'],
         askedAt: Date.now() / 1000 - 2.5 * 3600,
      });
      const lanes = buildReviewLanes(input({ pulls: [target], names: { alice: 'Alice A' } }));
      expect(lanes.whyUpNext(target)).toBe('Alice A asked you 2h ago');
   });

   it("whyQaNext resolves the tester's display name", () => {
      const p = dp({ author: 'bob', status: 'needs_qa', qaingLogin: 'alice' });
      const lanes = buildReviewLanes(input({ pulls: [p], names: { alice: 'Alice A' } }));
      expect(lanes.whyQaNext(p)).toBe('Alice A is already testing it; it sinks below unclaimed QA');
   });
});

describe('buildReviewLanes — projects', () => {
   /** pull keys to the project standing the lanes read (model/standing.ts) */
   const standing = (
      parked: Record<string, string>,
      finishing: Record<string, { slug: string; left: number }> = {}
   ) => ({
      parked: new Map(Object.entries(parked)),
      finishing: new Map(Object.entries(finishing)),
   });

   it("sinks a parked project's PR below everyone's in the queue, above the bots, and says why", () => {
      // a quick win waiting 3 days would lead, but its project is parked
      const parked = dp({ number: 1, author: 'alice', weight: 'XS', ageDays: 3 });
      const fresh = dp({ number: 2, author: 'bob', weight: 'L', ageDays: 0 });
      const bot = dp({ number: 3, author: 'dependabot[bot]', ageDays: 1 });
      const lanes = buildReviewLanes(
         input({
            pulls: [parked, fresh],
            bots: [bot],
            standing: standing({ 'org/repo#1': 'picker' }),
         })
      );
      expect(lanes.queue).toEqual([fresh, parked, bot]);
      expect(lanes.whyUpNext(parked)).toBe('Parked project: picker');
   });

   it("sinks a teammate's parked PR below someone else's", () => {
      const teammates = dp({ number: 1, author: 'alice' });
      const stranger = dp({ number: 2, author: 'bob' });
      const lanes = buildReviewLanes(
         input({
            pulls: [teammates, stranger],
            teams: [{ name: 'My team', members: ['alice'] }],
            standing: standing({ 'org/repo#1': 'picker' }),
         })
      );
      expect(lanes.queue).toEqual([stranger, teammates]);
   });

   it("sinks a parked project's PR in Needs QA and Ready to merge", () => {
      const parked = standing({ 'org/repo#1': 'picker' });
      const qaParked = dp({ number: 1, author: 'alice', status: 'needs_qa', weight: 'XS' });
      const qaOther = dp({ number: 2, author: 'bob', status: 'needs_qa', weight: 'XL' });
      expect(
         buildReviewLanes(input({ pulls: [qaParked, qaOther], standing: parked })).needsQa
      ).toEqual([qaOther, qaParked]);
      const readyParked = dp({ number: 1, author: 'me', status: 'ready', ageDays: 9 });
      const readyOther = dp({ number: 2, author: 'me', status: 'ready', ageDays: 1 });
      const lanes = buildReviewLanes(input({ pulls: [readyParked, readyOther], standing: parked }));
      expect(lanes.ready).toEqual([readyOther, readyParked]);
      expect(lanes.whyProject(readyParked, null)).toBe('Parked project: picker');
   });

   it("sinks a parked project's PR within its word in Waiting on you, never out of it", () => {
      const restampParked = dp({
         number: 1,
         author: 'alice',
         status: 'needs_recr',
         recrBy: ['me'],
         ageDays: 9,
      });
      const restamp = dp({ number: 2, author: 'bob', status: 'needs_recr', recrBy: ['me'] });
      const requested = dp({ number: 3, author: 'carol', requestedReviewers: ['me'], ageDays: 20 });
      const lanes = buildReviewLanes(
         input({
            pulls: [restampParked, restamp, requested],
            standing: standing({ 'org/repo#1': 'picker' }),
         })
      );
      // the review request leads; the parked re-stamp sinks below the other
      expect(lanes.yourMove).toEqual([requested, restamp, restampParked]);
   });

   it('puts the PR that helps finish a plan first on a tie, and says so', () => {
      // the same score to the day: the older one leads, unless the younger
      // one is among the last open PRs of a plan in progress
      const older = dp({ number: 1, author: 'alice', ageDays: 2.4 });
      const finisher = dp({ number: 2, author: 'bob', ageDays: 2.2 });
      const plain = buildReviewLanes(input({ pulls: [older, finisher] }));
      expect(plain.queue).toEqual([older, finisher]);
      const lanes = buildReviewLanes(
         input({
            pulls: [older, finisher],
            standing: standing({}, { 'org/repo#2': { slug: 'sync', left: 1 } }),
         })
      );
      expect(lanes.queue).toEqual([finisher, older]);
      expect(lanes.whyUpNext(finisher)).toBe(
         'Waiting 2d without a full CR. Helps finish sync: its last open PR'
      );
   });

   it('never puts it above a PR that waited a day longer', () => {
      const older = dp({ number: 1, author: 'alice', ageDays: 3 });
      const finisher = dp({ number: 2, author: 'bob', ageDays: 2 });
      const lanes = buildReviewLanes(
         input({
            pulls: [older, finisher],
            standing: standing({}, { 'org/repo#2': { slug: 'sync', left: 2 } }),
         })
      );
      expect(lanes.queue).toEqual([older, finisher]);
      expect(lanes.whyProject(finisher, null)).toBe(
         'Helps finish sync: one of its last 2 open PRs'
      );
   });
});

describe('buildReviewLanes — requests run on hours, and QA is the author’s', () => {
   it('leads the queue with requests of you, oldest request first, ahead of a starving pull', () => {
      const old = dp({
         number: 1,
         author: 'alice',
         status: 'needs_cr',
         starved: true,
         ageDays: 30,
      });
      const late = dp({
         number: 2,
         author: 'bob',
         status: 'needs_cr',
         requestedReviewers: ['me'],
         askedAt: 2000,
      });
      const early = dp({
         number: 3,
         author: 'carol',
         status: 'needs_cr',
         requestedReviewers: ['me'],
         askedAt: 1000,
         repo: 'org/elsewhere',
      });
      const lanes = buildReviewLanes(input({ pulls: [old, late, early] }));
      expect(lanes.queue).toEqual([early, late, old]);
      expect(lanes).not.toHaveProperty('queueStarved');
   });

   it('does not hand a requested reviewer the QA: only outside testers and claims reach Needs QA', () => {
      const asked = dp({
         number: 1,
         author: 'alice',
         status: 'needs_qa',
         requestedReviewers: ['me'],
      });
      const outside = dp({ number: 2, author: 'zed', status: 'needs_qa' });
      const claimed = dp({
         number: 3,
         author: 'alice',
         status: 'needs_qa',
         requestedReviewers: ['me'],
         reviewRequests: [{ login: 'me', at: 1, self: true }],
      });
      const lanes = buildReviewLanes(input({ pulls: [asked, outside, claimed] }));
      expect(lanes.needsQa).toEqual(expect.arrayContaining([outside, claimed]));
      expect(lanes.needsQa).not.toContain(asked);
      expect(lanes.queue).not.toContain(asked);
   });

   it('keeps a team request that names nobody out of every queue, but offers it in Could use your input', () => {
      const p = dp({ author: 'alice', status: 'needs_cr', requestedTeams: ['ghost'] });
      const lanes = buildReviewLanes(input({ pulls: [p], codeRegions: ['repo'] }));
      expect(lanes.queue).toEqual([]);
      expect(lanes.needsQa).toEqual([]);
      expect(lanes.couldUseInput).toEqual([p]);
   });
});
