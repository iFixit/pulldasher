import { describe, expect, it } from 'vitest';
import type { DerivedPull, Weight } from './status';
import { dealFrom, dealRank, type DealRankOptions } from './deal';

/** A DerivedPull with only the fields the deal ranking (and the crSort it
 * delegates tie-breaking to) reads. */
function dp(o: {
   repo?: string;
   number?: number;
   author?: string;
   crReq?: number;
   crHave?: number;
   crBy?: string[];
   qaBy?: string[];
   ageDays?: number;
   starved?: boolean;
   starveScore?: number;
   weight?: Weight;
   sizeKnown?: boolean;
   additions?: number;
   deletions?: number;
   headPushedAt?: number | null;
}): DerivedPull {
   return {
      data: {
         repo: o.repo ?? 'org/repo',
         number: o.number ?? 1,
         user: { login: o.author ?? 'author' },
         status: { cr_req: o.crReq ?? 1, qa_req: 1 },
         updated_at: new Date(Date.now() - 3600_000).toISOString(),
         additions: o.additions ?? 10,
         deletions: o.deletions ?? 0,
      },
      crHave: o.crHave ?? 0,
      crBy: o.crBy ?? [],
      qaBy: o.qaBy ?? [],
      ageDays: o.ageDays ?? 1,
      starved: o.starved ?? false,
      starveScore: o.starveScore ?? 0,
      weight: o.weight ?? 'M',
      sizeKnown: o.sizeKnown ?? true,
      headPushedAt: o.headPushedAt ?? null,
   } as unknown as DerivedPull;
}

type TestOpts = DealRankOptions & {
   claims: Readonly<Record<string, { login: string; at: number }>>;
   passed: ReadonlySet<string>;
};
const baseOpts = (over: Partial<TestOpts> = {}): TestOpts => ({
   me: 'me',
   pulls: [] as DerivedPull[],
   claims: {},
   passed: new Set<string>(),
   ...over,
});

/** rank-then-deal, the exact pipeline Review's lane + button run. */
const deal = (queue: DerivedPull[], opts: TestOpts) => dealFrom(dealRank(queue, opts), opts);

describe('deal rank+from — exclusion', () => {
   it('returns null on an empty queue', () => {
      expect(deal([], baseOpts())).toBeNull();
   });

   it('excludes a claimed pull', () => {
      const claimed = dp({ number: 1 });
      const open = dp({ number: 2 });
      const opts = baseOpts({ claims: { 'org/repo#1': { login: 'alice', at: Date.now() } } });
      expect(deal([claimed, open], opts)).toBe(open);
   });

   it('excludes a pull the viewer already passed on this sitting', () => {
      const passed = dp({ number: 1 });
      const open = dp({ number: 2 });
      const opts = baseOpts({ passed: new Set(['org/repo#1']) });
      expect(deal([passed, open], opts)).toBe(open);
   });

   it('returns null when every candidate is claimed or passed', () => {
      const a = dp({ number: 1 });
      const b = dp({ number: 2 });
      const opts = baseOpts({
         claims: { 'org/repo#1': { login: 'alice', at: Date.now() } },
         passed: new Set(['org/repo#2']),
      });
      expect(deal([a, b], opts)).toBeNull();
   });
});

describe('deal rank+from — scoring bumps', () => {
   it('familiarity: a repo the viewer has stamped before outranks an identical pull in an unfamiliar repo', () => {
      const familiarRepoPull = dp({ repo: 'org/familiar', number: 1 });
      const unfamiliarRepoPull = dp({ repo: 'org/unfamiliar', number: 2 });
      // the viewer's own stamp elsewhere in org/familiar is the familiarity signal
      const myStampElsewhere = dp({ repo: 'org/familiar', number: 99, crBy: ['me'] });
      const opts = baseOpts({ pulls: [familiarRepoPull, unfamiliarRepoPull, myStampElsewhere] });
      expect(deal([familiarRepoPull, unfamiliarRepoPull], opts)).toBe(familiarRepoPull);
   });

   it("reciprocity: an author who has stamped one of my pulls outranks one who hasn't", () => {
      const reciprocalAuthorPull = dp({ author: 'alice', number: 1 });
      const strangerPull = dp({ author: 'bob', number: 2 });
      // alice stamped one of my own authored pulls elsewhere on the board
      const myPullAliceStamped = dp({ author: 'me', number: 99, crBy: ['alice'] });
      const opts = baseOpts({ pulls: [reciprocalAuthorPull, strangerPull, myPullAliceStamped] });
      expect(deal([reciprocalAuthorPull, strangerPull], opts)).toBe(reciprocalAuthorPull);
   });

   it('quick win: a known XS pull outranks an otherwise-identical unknown-size pull', () => {
      const xsPull = dp({ number: 1, weight: 'XS', sizeKnown: true });
      const unknownSizePull = dp({ number: 2, weight: 'M', sizeKnown: false });
      expect(deal([xsPull, unknownSizePull], baseOpts())).toBe(xsPull);
   });

   it('urgency: a starved pull with a high starveScore outranks a fresh one', () => {
      const starvedPull = dp({ number: 1, starved: true, starveScore: 500, ageDays: 20 });
      const freshPull = dp({ number: 2, ageDays: 1 });
      expect(deal([starvedPull, freshPull], baseOpts())).toBe(starvedPull);
   });
});

describe('deal rank+from — deprioritize', () => {
   it('hands out a demoted pull only once every non-demoted one is gone', () => {
      // the bot is far older (would win on urgency) but must sink below a fresh
      // human pull; passing the human then leaves only the bot to deal
      const bot = dp({
         number: 1,
         author: 'dependabot',
         ageDays: 30,
         starved: true,
         starveScore: 900,
      });
      const human = dp({ number: 2, author: 'alice', ageDays: 1 });
      const opts = baseOpts({ deprioritize: p => p.data.user.login === 'dependabot' });
      expect(deal([bot, human], opts)).toBe(human);
      expect(deal([bot, human], { ...opts, passed: new Set(['org/repo#2']) })).toBe(bot);
   });

   it('still orders demoted pulls among themselves', () => {
      const olderBot = dp({
         number: 1,
         author: 'bot',
         ageDays: 20,
         starved: true,
         starveScore: 800,
      });
      const newerBot = dp({ number: 2, author: 'bot', ageDays: 2 });
      const opts = baseOpts({ deprioritize: () => true });
      expect(deal([olderBot, newerBot], opts)).toBe(olderBot);
   });
});

describe('deal rank+from — determinism', () => {
   it('picks the same pull every time for the same inputs', () => {
      const queue = [dp({ number: 1 }), dp({ number: 2 }), dp({ number: 3 })];
      const opts = baseOpts();
      const first = deal(queue, opts);
      for (let i = 0; i < 5; i++) expect(deal(queue, opts)).toBe(first);
   });

   it('breaks a genuine score tie by crSort order, not queue order', () => {
      // identical in every scoring dimension; only their crSort-relevant
      // fields (age, size) can break the tie — reversing the input order
      // must not change the pick
      const a = dp({ number: 1, ageDays: 5 });
      const b = dp({ number: 2, ageDays: 2 });
      const opts = baseOpts();
      const forward = deal([a, b], opts);
      const reversed = deal([b, a], opts);
      expect(forward).toBe(reversed);
   });
});

describe('dealRank — the lane order', () => {
   it('renders starved work first, fresh work next, demoted bots last', () => {
      const starved = dp({ number: 1, starved: true, starveScore: 500, ageDays: 20 });
      const fresh = dp({ number: 2, ageDays: 1 });
      const bot = dp({
         number: 3,
         author: 'dependabot',
         ageDays: 40,
         starved: true,
         starveScore: 900,
      });
      const opts = baseOpts({ deprioritize: p => p.data.user.login === 'dependabot' });
      expect(dealRank([fresh, bot, starved], opts).map(p => p.data.number)).toEqual([1, 2, 3]);
   });

   it('normalizes the fresh-pull urgency ramp against the configured warnDays', () => {
      // same pulls, different threshold: with a 20-day threshold a 10-day-old
      // M is only halfway to starving (urgency 0.5) and the XS quick win
      // (+1) takes the top; with a 2-day threshold the same pull is 5x past
      // it (urgency 5.0) and outranks the quick win — the setting must move
      // the ramp, not stay pinned to the model default
      const aging = dp({ number: 1, ageDays: 10 });
      const quick = dp({ number: 2, weight: 'XS', ageDays: 0 });
      expect(dealRank([aging, quick], baseOpts({ warnDays: 20 }))[0].data.number).toBe(2);
      expect(dealRank([aging, quick], baseOpts({ warnDays: 2 }))[0].data.number).toBe(1);
   });
});
