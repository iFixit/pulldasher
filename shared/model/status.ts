import { epoch } from '../format';
import type { CommitStatus, Label, PullData, RepoSpec, Signature } from '../types';
import { isSuffixBot } from './visibility';

/**
 * One pull, one status. Mutually exclusive by precedence — the fix for v1's
 * six overlapping column predicates (a pull could sit in CR and QA at once).
 *
 *   draft > dev_block > needs_recr > needs_cr > needs_qa >
 *   ci_red > deploy_block > ci_pending > unmergeable > ready
 *
 * The old single "blocked" bucket conflated three opposite situations, so it
 * split: dev_block means the author owes changes (it hides the pull from the
 * review lanes — feedback is pending); deploy_block means the work is done
 * but deliberately held from shipping (review proceeds as normal, so it only
 * outranks the ready gate); unmergeable means signed off and green but
 * conflicted or based on an unmerged parent (the author rebases).
 *
 * BOTH CI states exist only at the ready gate: a red or pending build never
 * hides a pull from the review lanes — reviews don't need green, CI
 * false-negatives are common, and whether to review a failing build is the
 * reviewer's call (the rail's CI pip shows the state either way; authors
 * shouldn't have to babysit re-runs to get review attention). A
 * fully-signed-off pull isn't "ready" until CI agrees: ci_red means the
 * author fixes the build, ci_pending means everyone waits a minute.
 */
export type Status =
   | 'draft'
   | 'dev_block'
   | 'deploy_block'
   | 'unmergeable'
   | 'ci_red'
   | 'needs_recr'
   | 'needs_cr'
   | 'needs_qa'
   | 'ci_pending'
   | 'ready';

export const STATUS_ORDER: Status[] = [
   'ready',
   'needs_recr',
   'needs_qa',
   'needs_cr',
   'ci_pending',
   'deploy_block',
   'unmergeable',
   'dev_block',
   'ci_red',
   'draft',
];

/** v1's label conventions, still in active use on the boards. */
export const LABELS = {
   qaing: 'QAing',
   externalBlock: 'external_block',
   cryo: 'Cryogenic Storage',
} as const;

export type CiVerdict = 'success' | 'pending' | 'failing' | 'none';

export interface DerivedPull {
   data: PullData;
   status: Status;
   ci: CiVerdict;
   /** contexts of the failing required checks, so "CI red" can say which */
   ciFailing: string[];
   /** users whose CR stamp counts on the current head */
   crBy: string[];
   qaBy: string[];
   crHave: number;
   qaHave: number;
   /** users whose CR a later push invalidated and whose re-stamp is still
    * needed — empty once other active stamps satisfy cr_req, so nobody gets
    * nagged to re-review a pull that's already fully signed off */
   recrBy: string[];
   /** users whose QA stamp a later push invalidated (symmetric with recrBy) */
   reqaBy: string[];
   /** epoch secs of the invalidating push (head CI start proxy); null if unknown */
   headPushedAt: number | null;
   ageDays: number;
   /** epoch secs the last required sign-off landed; null until fully signed off */
   signedOffAt: number | null;
   /** CR-incomplete past STARVE_DAYS on a pull waiting on someone else's
    * review (asked for, or from outside the dev team); a developer's own
    * unrequested pull never starves, its review is the author's job */
   starved: boolean;
   /** the self-review policy: a developer's pull with no review request (no
    * person, no team, no claim). Its CR and QA are the author's own to do,
    * and nobody else owes it anything */
   ownReview: boolean;
   /** logins asked to review it by the author's side: requested reviewers
    * (claims excluded) plus every member of a requested roster team; never
    * the author */
   askedOf: string[];
   /** epoch secs of the earliest open request in askedOf; null if none or
    * unknown. Requests are answered in hours, so this clock drives the nudge */
   askedAt: number | null;
   starveScore: number;
   weight: Weight;
   /** mergeable === false: shows as a flag everywhere, gates "ready" */
   conflict: boolean;
   /** mergeable === null: GitHub hasn't recomputed yet, don't assert either way */
   mergeUnknown: boolean;
   /** base isn't main/master: lands with its parent, gates "ready" */
   dependent: boolean;
   /** everyone holding an active dev block: the author owes them changes */
   devBlockedBy: string[];
   /** everyone holding an active deploy block: done, deliberately not shipped */
   deployBlockedBy: string[];
   /** login from the QAing label: someone is already testing this */
   qaingLogin: string | null;
   externalBlock: boolean;
   cryo: boolean;
   /** logins with an open (unstamped) CHANGES_REQUESTED verdict on the
    * current head — absent on older servers, so always []. */
   changesRequestedBy: string[];
   /** logins who reviewed (any verdict) or commented without ever landing a
    * CR/QA signature of their own (active or stale) — the "someone's engaged
    * but it left no stamp" signal, e.g. for "answer their review" / "in
    * discussion with" nudges. Bots excluded. */
   engagedNoStamp: string[];
}

export const WEIGHT_ORDER = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type Weight = typeof WEIGHT_ORDER[number];
const WEIGHT_RANK: Record<Weight, number> = WEIGHT_ORDER.reduce(
   (acc, w, i) => ({ ...acc, [w]: i }),
   {} as Record<Weight, number>
);
const WEIGHTS: ReadonlySet<string> = new Set(WEIGHT_ORDER);

/** Statuses where a pull is still short of the CR gate — either no re-stamp
 * has covered a stale one (needs_recr) or the count is simply short
 * (needs_cr). Shared so every "is this pull CR-incomplete?" check (starve
 * math, the rotation, the review lanes, the stats lens) agrees on the same
 * two statuses. */
export const CR_INCOMPLETE: Status[] = ['needs_cr', 'needs_recr'];

/**
 * Parse a raw `{ label title -> weight }` config object into a validated Map,
 * dropping any entry whose value isn't a real weight bucket so a typo in config
 * can't inject a bogus weight (the model would sort it as unknown). Shared by
 * the board (reading the socket initialize payload) and the backend /api/v1
 * (reading config.js), so both turn config into weight labels identically.
 */
export function parseWeightLabels(raw: unknown): Map<string, Weight> {
   const out = new Map<string, Weight>();
   if (!raw || typeof raw !== 'object') return out;
   for (const [title, w] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof w === 'string' && WEIGHTS.has(w)) out.set(title, w as Weight);
   }
   return out;
}

/**
 * Tuned to the shop's real cadence (3 months of history: median first
 * review under 2 hours, p75 under a day, p90 ~4 days). A pull unreviewed
 * at 4 days is already past p90 — waiting a week to call it starved meant
 * intervening after the author lost the context.
 */
export const STARVE_DAYS = 4;
/** the age slot turns red here: past p97 of real first-review latency */
export const ROT_DAYS = 10;

const activeUsers = (sigs: Signature[]) =>
   unique(sigs.filter(s => s.data.active).map(s => s.data.user.login));

/** users with only invalidated stamps (no active one), the author included:
 * under self-review an author's own stale stamp is a re-stamp they owe */
const staleUsers = (sigs: Signature[]) => {
   const active = activeUsers(sigs);
   return unique(
      sigs
         .filter(s => !s.data.active)
         .map(s => s.data.user.login)
         .filter(u => !active.includes(u))
   );
};

export function unique<T>(xs: T[]): T[] {
   return [...new Set(xs)];
}

/**
 * The statuses a repo's verdict depends on (the server ships raw statuses
 * plus per-repo required/ignored lists and leaves the reduction to us).
 * Required = repoSpec.requiredStatuses when configured, else every reported
 * status minus repoSpec.ignoredStatuses.
 */
function requiredStatuses(pull: PullData, spec?: RepoSpec): CommitStatus[] {
   const onHead = pull.status.commit_statuses.filter(s => s.data.sha === pull.head.sha);
   const statuses = onHead.length ? onHead : pull.status.commit_statuses;
   if (spec?.requiredStatuses?.length) {
      return statuses.filter(s => spec.requiredStatuses!.includes(s.data.context));
   }
   const ignored = new Set(spec?.ignoredStatuses ?? []);
   return statuses.filter(s => !ignored.has(s.data.context));
}

/** CI verdict, computed client-side. */
export function ciVerdict(pull: PullData, spec?: RepoSpec): CiVerdict {
   const onHead = pull.status.commit_statuses.filter(s => s.data.sha === pull.head.sha);
   const statuses = onHead.length ? onHead : pull.status.commit_statuses;
   if (!statuses.length && !spec?.requiredStatuses?.length) return 'none';

   const required = requiredStatuses(pull, spec);
   if (spec?.requiredStatuses?.length && required.length < spec.requiredStatuses.length) {
      // a configured-required status that hasn't reported yet counts as pending
      if (required.some(isFailing)) return 'failing';
      return 'pending';
   }
   if (!required.length) return 'none';
   if (required.some(isFailing)) return 'failing';
   if (required.some(s => s.data.state === 'pending')) return 'pending';
   return 'success';
}

/** Which required checks are red — so the UI can say "CI red: playwright". */
export function ciFailing(pull: PullData, spec?: RepoSpec): string[] {
   return unique(
      requiredStatuses(pull, spec)
         .filter(isFailing)
         .map(s => s.data.context)
   );
}

const isFailing = (s: CommitStatus) => s.data.state === 'failure' || s.data.state === 'error';

/**
 * Every CI check on the current head, one row per context (a later report for
 * the same context supersedes an earlier one), for the at-a-glance CI list the
 * rail chip and its popover show. Unlike ciVerdict/ciFailing this ignores the
 * repo's required/ignored config — the breakdown shows what actually ran, links
 * and all, the way v1's CI panel did. Falls back to all statuses when none are
 * tagged to the head sha (older payloads).
 */
export function headStatuses(pull: PullData): CommitStatus[] {
   const onHead = pull.status.commit_statuses.filter(s => s.data.sha === pull.head.sha);
   const statuses = onHead.length ? onHead : pull.status.commit_statuses;
   const at = (s: CommitStatus) => s.data.completed_at ?? s.data.started_at ?? 0;
   const latest = new Map<string, CommitStatus>();
   for (const s of statuses) {
      const prev = latest.get(s.data.context);
      if (!prev || at(s) >= at(prev)) latest.set(s.data.context, s);
   }
   return [...latest.values()];
}

/** When did the author push the current head? Head-CI-start is the proxy. */
export function headPushedAt(pull: PullData): number | null {
   const starts = pull.status.commit_statuses
      .filter(s => s.data.sha === pull.head.sha)
      .map(s => s.data.started_at)
      .filter((t): t is number => t != null);
   return starts.length ? Math.min(...starts) : null;
}

export const crDone = (p: { crHave: number; data: PullData }) => p.crHave >= p.data.status.cr_req;
export const qaDone = (p: { qaHave: number; data: PullData }) => p.qaHave >= p.data.status.qa_req;

/** Who counts as a developer, and the roster teams a GitHub team request
 * resolves through. Built once from config projects.developerTeams. */
export interface ReviewPolicy {
   /** developer logins (lowercased); empty means everyone is a developer */
   developers: ReadonlySet<string>;
   /** roster team name, lowercased and slugged like GitHub's ("Store
    * Front" -> "store-front"), to its logins */
   teams: ReadonlyMap<string, string[]>;
   /** config `bots` beyond the `[bot]` suffix: never developers, so their
    * PRs still need someone else's review */
   bots: ReadonlySet<string>;
}

const slug = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

export function reviewPolicy(
   developerTeams?: Record<string, string[]> | null,
   bots: readonly string[] = []
): ReviewPolicy {
   const teams = new Map<string, string[]>();
   const developers = new Set<string>();
   for (const [name, logins] of Object.entries(developerTeams ?? {})) {
      if (!Array.isArray(logins)) continue;
      teams.set(slug(name), logins);
      logins.forEach(l => developers.add(l.toLowerCase()));
   }
   return { developers, teams, bots: new Set(bots.map(b => b.toLowerCase())) };
}

const EVERYONE_DEVELOPS: ReviewPolicy = reviewPolicy();

/** a bot never reviews its own PRs, whatever the roster says */
export const isDeveloper = (policy: ReviewPolicy, login: string) =>
   !isSuffixBot(login) &&
   !policy.bots.has(login.toLowerCase()) &&
   (!policy.developers.size || policy.developers.has(login.toLowerCase()));

export function derive(
   pull: PullData,
   spec: RepoSpec | undefined,
   now: number = Date.now() / 1000,
   /** the age at which a CR-incomplete pull counts as starved (the user's
    * "age turns amber" setting; defaults to the model's own threshold). */
   warnDays: number = STARVE_DAYS,
   /** label title → weight bucket, from config.json's `weightLabels`. A
    * matching label is the authoritative review-effort signal and overrides
    * the diff-size heuristic; empty map keeps the heuristic. */
   weightLabels: ReadonlyMap<string, Weight> = new Map(),
   /** who's a developer and what a team request means (reviewPolicy) */
   policy: ReviewPolicy = EVERYONE_DEVELOPS
): DerivedPull {
   const st = pull.status;
   const crBy = activeUsers(st.allCR);
   const qaBy = activeUsers(st.allQA);
   const crHave = crBy.length;
   const qaHave = qaBy.length;
   const ci = ciVerdict(pull, spec);

   const author = pull.user.login;
   // the author's own stamp goes stale on a push like anyone's, and under
   // self-review it's the author who owes the re-stamp
   const staleCr = staleUsers(st.allCR);
   const staleQa = staleUsers(st.allQA);

   // who the author's side asked and hasn't answered: people (not claims,
   // which are a reviewer volunteering) and every member of a requested
   // roster team, minus anyone whose CR already counts. A CR comment doesn't
   // clear GitHub's request, so without that a stamped reviewer would stay
   // "asked" (and the author would be told to nudge them).
   const claims = new Set((pull.review_requests ?? []).filter(r => r.self).map(r => r.login));
   const requestedTeams = pull.requested_teams ?? [];
   // a team the roster doesn't name (say @iFixit/coders, the whole dev
   // team) asks every developer on the roster
   const everyone = [...policy.teams.values()].flat();
   const teamOf = new Map<string, string>();
   for (const t of requestedTeams)
      for (const l of policy.teams.get(t.toLowerCase()) ?? everyone)
         if (!teamOf.has(l)) teamOf.set(l, t.toLowerCase());
   const askedOf = unique([
      ...(pull.requested_reviewers ?? []).filter(l => !claims.has(l)),
      ...teamOf.keys(),
   ]).filter(l => l.toLowerCase() !== author.toLowerCase() && !crBy.includes(l));
   // a person's own request time, else their team's
   const teamAt = new Map(
      (pull.team_requests ?? []).map(t => [t.slug.toLowerCase(), t.at] as const)
   );
   const askedTimes = askedOf.map(
      l =>
         (pull.review_requests ?? []).find(r => !r.self && r.login === l)?.at ??
         teamAt.get(teamOf.get(l) ?? '') ??
         null
   );
   const askedAt = Math.min(...askedTimes.filter((t): t is number => t != null));
   const ownReview =
      isDeveloper(policy, author) &&
      !(pull.requested_reviewers ?? []).length &&
      !requestedTeams.length;

   // a lifted block deactivates its signature, same as a stale CR stamp
   const devBlockedBy = activeUsers(st.dev_block);
   const deployBlockedBy = activeUsers(st.deploy_block);
   const crMet = crDone({ crHave, data: pull });
   const qaMet = qaDone({ qaHave, data: pull });

   // Unstamped review verdicts (CHANGES_REQUESTED/COMMENTED/DISMISSED — an
   // APPROVED review already lands as a CR signature server-side) plus
   // comment-only participants: the "engaged but no stamp to show for it"
   // pool rowNote draws "answer their review" / "in discussion with" from.
   // changesRequestedBy (below) and engagedNoStamp both filter with
   // isSuffixBot, not isBotLogin, by the shared model layer's deliberate
   // convention (visibility.ts:30-36): this module has no reason to depend on
   // config.json's `bots` list. That's not a live gap — the config-listed
   // bots (ifixit-systems, Copilot) aren't reviewers, so they never appear in
   // unstamped_reviewers to begin with.
   const unstampedReviewers = st.unstamped_reviewers ?? [];
   const changesRequestedBy = unique(
      unstampedReviewers
         .filter(r => r.state === 'CHANGES_REQUESTED' && !isSuffixBot(r.login))
         .map(r => r.login)
   );
   const everStamped = new Set([
      ...st.allCR.map(s => s.data.user.login),
      ...st.allQA.map(s => s.data.user.login),
   ]);
   const engagedNoStamp = unique(
      [...unstampedReviewers.map(r => r.login), ...(pull.participants ?? [])].filter(
         login => login !== pull.user.login && !everStamped.has(login) && !isSuffixBot(login)
      )
   );

   const conflict = pull.mergeable === false;
   const dependent = !['main', 'master'].includes(pull.base.ref);
   const label = (title: string) => pull.labels.find(l => l.title === title);
   // computed early: parked (Cryogenic Storage) pulls age on purpose, so
   // starvation — and everything downstream of it (starve nags, starve
   // scores, the turn rotation) — must never see them as rotting
   const isParked = !!label(LABELS.cryo);

   // on a self-reviewed pull only the author owes a re-stamp: anyone else's
   // stamp there was a favor nobody asked for, so a push doesn't put them
   // on the hook
   const owedCr = ownReview ? staleCr.filter(u => u === author) : staleCr;
   const owedQa = ownReview ? staleQa.filter(u => u === author) : staleQa;

   let status: Status;
   if (pull.draft) status = 'draft';
   else if (devBlockedBy.length) status = 'dev_block';
   else if (!crMet && owedCr.length) status = 'needs_recr';
   else if (!crMet) status = 'needs_cr';
   else if (!qaMet) status = 'needs_qa';
   // CI gates readiness only (see the Status doc): a red or pending build
   // never pulls a PR out of the review lanes — the `ci` field carries the
   // state to the rail's pip whatever the status says
   else if (ci === 'failing') status = 'ci_red';
   else if (deployBlockedBy.length) status = 'deploy_block';
   else if (ci === 'pending') status = 'ci_pending';
   // signed off and green, but unmergeable as-is: the author rebases
   else if (conflict || dependent) status = 'unmergeable';
   else status = 'ready';

   const created = epoch(pull.created_at);
   const ageDays = Math.max(0, Math.floor((now - created) / 86400));
   // an org weight label is authoritative (deterministic, per-file-weighted,
   // versioned with the labeller) and overrides the diff-size guess. It also
   // counts as a known size for the sort, even when adds/dels are off the wire.
   const labeledWeight = weightFromLabels(pull.labels, weightLabels);
   const size = (pull.additions ?? 0) + (pull.deletions ?? 0);
   // Rot is rot whether the pull has zero stamps, one of two, or a stale one
   // waiting on a re-stamp — the old `crHave === 0` cliff hid half-reviewed
   // pulls from the aging lane forever.
   const starved =
      !isParked && !ownReview && CR_INCOMPLETE.includes(status) && !crMet && ageDays >= warnDays;

   const signedOffAt =
      crMet && qaMet
         ? Math.max(
              0,
              ...[...st.allCR, ...st.allQA]
                 .filter(s => s.data.active)
                 .map(s => epoch(s.data.created_at))
           ) || null
         : null;

   return {
      data: pull,
      status,
      ci,
      ciFailing: ci === 'failing' ? ciFailing(pull, spec) : [],
      crBy,
      qaBy,
      crHave,
      qaHave,
      // a stale stamp only owes a re-stamp while the requirement is unmet —
      // once others satisfy it, nothing is asked of the stale signer
      recrBy: crMet ? [] : owedCr,
      reqaBy: qaMet ? [] : owedQa,
      headPushedAt: headPushedAt(pull),
      ageDays,
      signedOffAt,
      starved,
      starveScore: starved ? ageDays * Math.max(size, 1) : 0,
      weight: labeledWeight ?? reviewWeight(pull),
      conflict,
      mergeUnknown: pull.mergeable == null,
      dependent,
      devBlockedBy,
      deployBlockedBy,
      qaingLogin: label(LABELS.qaing)?.user ?? null,
      externalBlock: !!label(LABELS.externalBlock),
      cryo: isParked,
      changesRequestedBy,
      engagedNoStamp,
      ownReview,
      askedOf,
      askedAt: Number.isFinite(askedAt) ? askedAt : null,
   };
}

/**
 * The org's stamped weight label mapped to its bucket, or null if the PR
 * carries none we recognize. The mapping is config (config.json's
 * `weightLabels`), so the label strings live in one place and a maintainer's
 * manual override of the auto label is honored the same as the auto one — the
 * board never re-derives weight for a PR that has an authoritative label.
 */
export function weightFromLabels(
   labels: Label[],
   weightLabels: ReadonlyMap<string, Weight>
): Weight | null {
   if (weightLabels.size === 0) return null;
   for (const l of labels) {
      const w = weightLabels.get(l.title);
      if (w) return w;
   }
   return null;
}

/**
 * Expected review effort from size and sprawl. A cheap prior, not a verdict:
 * the UI sorts by it and shows it as a chip; humans override by reading. Used
 * only when no authoritative weight label is present (see weightFromLabels).
 */
export function reviewWeight(pull: PullData): Weight {
   const size = (pull.additions ?? 0) + (pull.deletions ?? 0);
   const files = pull.changed_files ?? 0;
   let i = size < 50 ? 0 : size < 150 ? 1 : size < 600 ? 2 : size < 1500 ? 3 : 4;
   if (files > 15 && i < 4) i++;
   return WEIGHT_ORDER[i];
}

export const weightRank = (w: Weight) => WEIGHT_RANK[w];

/**
 * The session Weight filter's bucket for a pull: its weight letter,
 * lowercase. The old 'unknown' bucket is gone — the server now guarantees
 * diff stats on every open pull (a list item that arrives without them gets
 * the full pull fetched and grafted on), so every pull has a real class.
 * Shared by the scoped-pull filter pass in app.tsx and WeightFilter's live
 * per-option counts, so the two can't disagree about which bucket a pull
 * lands in.
 */
export function weightFilterKey(p: Pick<DerivedPull, 'weight'>): string {
   return p.weight.toLowerCase();
}

/** Does this pull match any of the given Weight-filter selections? An empty
 * selection means no filter is applied. */
export function matchesWeightFilter(
   p: Pick<DerivedPull, 'weight'>,
   sel: readonly string[]
): boolean {
   return sel.length === 0 || sel.includes(weightFilterKey(p));
}

/** Epoch secs of the last push, from the derived pull's cached headPushedAt,
 * falling back to updated_at when no CI has reported a push time. */
export const lastPushEpoch = (p: Pick<DerivedPull, 'headPushedAt' | 'data'>): number =>
   p.headPushedAt ?? epoch(p.data.updated_at);

/**
 * The author pushed in the last 30 minutes: probably still iterating. The
 * UI demotes (dims and sinks), never hides. Keyed to the PUSH clock, not
 * updated_at — 62% of this shop's PRs merge same-day, and updated_at moves
 * on every comment, so the old check sank pulls exactly while reviewers
 * were engaging with them. Takes the derived pull so callers (including the
 * crSort comparator) reuse the cached push time instead of rescanning
 * commit statuses.
 */
export function isIterating(
   p: Pick<DerivedPull, 'headPushedAt' | 'data'>,
   now: number = Date.now() / 1000
) {
   return now - lastPushEpoch(p) < 30 * 60;
}
