import { describe, expect, it } from 'vitest';
import type { DerivedPull, Weight } from './status';
import { dealOne } from './deal';

/** A DerivedPull with only the fields dealOne (and the crSort it delegates
 * tie-breaking to) reads. */
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

const baseOpts = (over: Partial<Parameters<typeof dealOne>[1]> = {}) => ({
   me: 'me',
   pulls: [] as DerivedPull[],
   claims: {},
   passed: new Set<string>(),
   ...over,
});

describe('dealOne — exclusion', () => {
   it('returns null on an empty queue', () => {
      expect(dealOne([], baseOpts())).toBeNull();
   });

   it('excludes a claimed pull', () => {
      const claimed = dp({ number: 1 });
      const open = dp({ number: 2 });
      const opts = baseOpts({ claims: { 'org/repo#1': { login: 'alice', at: Date.now() } } });
      expect(dealOne([claimed, open], opts)).toBe(open);
   });

   it('excludes a pull the viewer already passed on this sitting', () => {
      const passed = dp({ number: 1 });
      const open = dp({ number: 2 });
      const opts = baseOpts({ passed: new Set(['org/repo#1']) });
      expect(dealOne([passed, open], opts)).toBe(open);
   });

   it('returns null when every candidate is claimed or passed', () => {
      const a = dp({ number: 1 });
      const b = dp({ number: 2 });
      const opts = baseOpts({
         claims: { 'org/repo#1': { login: 'alice', at: Date.now() } },
         passed: new Set(['org/repo#2']),
      });
      expect(dealOne([a, b], opts)).toBeNull();
   });
});

describe('dealOne — scoring bumps', () => {
   it('familiarity: a repo the viewer has stamped before outranks an identical pull in an unfamiliar repo', () => {
      const familiarRepoPull = dp({ repo: 'org/familiar', number: 1 });
      const unfamiliarRepoPull = dp({ repo: 'org/unfamiliar', number: 2 });
      // the viewer's own stamp elsewhere in org/familiar is the familiarity signal
      const myStampElsewhere = dp({ repo: 'org/familiar', number: 99, crBy: ['me'] });
      const opts = baseOpts({ pulls: [familiarRepoPull, unfamiliarRepoPull, myStampElsewhere] });
      expect(dealOne([familiarRepoPull, unfamiliarRepoPull], opts)).toBe(familiarRepoPull);
   });

   it("reciprocity: an author who has stamped one of my pulls outranks one who hasn't", () => {
      const reciprocalAuthorPull = dp({ author: 'alice', number: 1 });
      const strangerPull = dp({ author: 'bob', number: 2 });
      // alice stamped one of my own authored pulls elsewhere on the board
      const myPullAliceStamped = dp({ author: 'me', number: 99, crBy: ['alice'] });
      const opts = baseOpts({ pulls: [reciprocalAuthorPull, strangerPull, myPullAliceStamped] });
      expect(dealOne([reciprocalAuthorPull, strangerPull], opts)).toBe(reciprocalAuthorPull);
   });

   it('quick win: a known XS pull outranks an otherwise-identical unknown-size pull', () => {
      const xsPull = dp({ number: 1, weight: 'XS', sizeKnown: true });
      const unknownSizePull = dp({ number: 2, weight: 'M', sizeKnown: false });
      expect(dealOne([xsPull, unknownSizePull], baseOpts())).toBe(xsPull);
   });

   it('urgency: a starved pull with a high starveScore outranks a fresh one', () => {
      const starvedPull = dp({ number: 1, starved: true, starveScore: 500, ageDays: 20 });
      const freshPull = dp({ number: 2, ageDays: 1 });
      expect(dealOne([starvedPull, freshPull], baseOpts())).toBe(starvedPull);
   });
});

describe('dealOne — deprioritize', () => {
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
      expect(dealOne([bot, human], opts)).toBe(human);
      expect(dealOne([bot, human], { ...opts, passed: new Set(['org/repo#2']) })).toBe(bot);
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
      expect(dealOne([olderBot, newerBot], opts)).toBe(olderBot);
   });
});

describe('dealOne — determinism', () => {
   it('picks the same pull every time for the same inputs', () => {
      const queue = [dp({ number: 1 }), dp({ number: 2 }), dp({ number: 3 })];
      const opts = baseOpts();
      const first = dealOne(queue, opts);
      for (let i = 0; i < 5; i++) expect(dealOne(queue, opts)).toBe(first);
   });

   it('breaks a genuine score tie by crSort order, not queue order', () => {
      // identical in every scoring dimension; only their crSort-relevant
      // fields (age, size) can break the tie — reversing the input order
      // must not change the pick
      const a = dp({ number: 1, ageDays: 5 });
      const b = dp({ number: 2, ageDays: 2 });
      const opts = baseOpts();
      const forward = dealOne([a, b], opts);
      const reversed = dealOne([b, a], opts);
      expect(forward).toBe(reversed);
   });
});
