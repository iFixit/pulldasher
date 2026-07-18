import type { CommitStatus, Label, PullData, RepoSpec, Signature } from '../types';

/**
 * One pull, one status. Mutually exclusive by precedence — the fix for v1's
 * six overlapping column predicates (a pull could sit in CR and QA at once).
 *
 *   draft > dev_block > ci_red > needs_recr > needs_cr > needs_qa >
 *   deploy_block > ci_pending > unmergeable > ready
 *
 * The old single "blocked" bucket conflated three opposite situations, so it
 * split: dev_block means the author owes changes (it hides the pull from the
 * review lanes — feedback is pending); deploy_block means the work is done
 * but deliberately held from shipping (review proceeds as normal, so it only
 * outranks the ready gate); unmergeable means signed off and green but
 * conflicted or based on an unmerged parent (the author rebases).
 *
 * ci_pending exists only at the ready gate: pending CI never hides a pull
 * from the review lanes (reviews don't need green), but a fully-signed-off
 * pull isn't "ready" until CI agrees.
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
   /** users whose CR a later push invalidated and who haven't re-stamped */
   recrBy: string[];
   /** users whose QA stamp a later push invalidated (symmetric with recrBy) */
   reqaBy: string[];
   /** epoch secs of the invalidating push (head CI start proxy); null if unknown */
   headPushedAt: number | null;
   ageDays: number;
   /** days since updated_at — the activity clock, vs ageDays' open clock */
   idleDays: number;
   /** epoch secs the last required sign-off landed; null until fully signed off */
   signedOffAt: number | null;
   /** CR-incomplete past STARVE_DAYS — including half-reviewed and stale-CR rot */
   starved: boolean;
   starveScore: number;
   weight: Weight;
   /** mergeable === false: shows as a flag everywhere, gates "ready" */
   conflict: boolean;
   /** mergeable === null: GitHub hasn't recomputed yet, don't assert either way */
   mergeUnknown: boolean;
   /** base isn't main/master: lands with its parent, gates "ready" */
   dependent: boolean;
   /** additions/deletions absent from the wire: weight and size sorts are guesses */
   sizeKnown: boolean;
   /** everyone holding an active dev block: the author owes them changes */
   devBlockedBy: string[];
   /** everyone holding an active deploy block: done, deliberately not shipped */
   deployBlockedBy: string[];
   /** login from the QAing label: someone is already testing this */
   qaingBy: string | null;
   externalBlock: boolean;
   cryo: boolean;
}

export type Weight = 'XS' | 'S' | 'M' | 'L' | 'XL';
const WEIGHT_RANK: Record<Weight, number> = { XS: 0, S: 1, M: 2, L: 3, XL: 4 };

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

/** users with only invalidated stamps (no active one), excluding the author */
const staleUsers = (sigs: Signature[], author: string) => {
   const active = activeUsers(sigs);
   return unique(
      sigs
         .filter(s => !s.data.active)
         .map(s => s.data.user.login)
         .filter(u => !active.includes(u) && u !== author)
   );
};

function unique<T>(xs: T[]): T[] {
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
   weightLabels: ReadonlyMap<string, Weight> = new Map()
): DerivedPull {
   const st = pull.status;
   const crBy = activeUsers(st.allCR);
   const qaBy = activeUsers(st.allQA);
   const crHave = crBy.length;
   const qaHave = qaBy.length;
   const ci = ciVerdict(pull, spec);

   const staleCr = staleUsers(st.allCR, pull.user.login);
   const staleQa = staleUsers(st.allQA, pull.user.login);

   // a lifted block deactivates its signature, same as a stale CR stamp
   const devBlockedBy = activeUsers(st.dev_block);
   const deployBlockedBy = activeUsers(st.deploy_block);
   const crMet = crHave >= st.cr_req;
   const qaMet = qaHave >= st.qa_req;

   const conflict = pull.mergeable === false;
   const dependent = !['main', 'master'].includes(pull.base.ref);
   const label = (title: string) => pull.labels.find(l => l.title === title);

   let status: Status;
   if (pull.draft) status = 'draft';
   else if (devBlockedBy.length) status = 'dev_block';
   else if (ci === 'failing') status = 'ci_red';
   else if (!crMet && staleCr.length) status = 'needs_recr';
   else if (!crMet) status = 'needs_cr';
   else if (!qaMet) status = 'needs_qa';
   else if (deployBlockedBy.length) status = 'deploy_block';
   else if (ci === 'pending') status = 'ci_pending';
   // signed off and green, but unmergeable as-is: the author rebases
   else if (conflict || dependent) status = 'unmergeable';
   else status = 'ready';

   const created = Date.parse(pull.created_at) / 1000;
   const updated = Date.parse(pull.updated_at) / 1000;
   const ageDays = Math.max(0, Math.floor((now - created) / 86400));
   const idleDays = Math.max(0, Math.floor((now - updated) / 86400));
   // an org weight label is authoritative (deterministic, per-file-weighted,
   // versioned with the labeller) and overrides the diff-size guess. It also
   // counts as a known size for the sort, even when adds/dels are off the wire.
   const labeledWeight = weightFromLabels(pull.labels, weightLabels);
   const sizeKnown = labeledWeight != null || pull.additions != null || pull.deletions != null;
   const size = (pull.additions ?? 0) + (pull.deletions ?? 0);
   // Rot is rot whether the pull has zero stamps, one of two, or a stale one
   // waiting on a re-stamp — the old `crHave === 0` cliff hid half-reviewed
   // pulls from the aging lane forever.
   const starved = ['needs_cr', 'needs_recr'].includes(status) && !crMet && ageDays >= warnDays;

   const signedOffAt =
      crMet && qaMet
         ? Math.max(
              0,
              ...[...st.allCR, ...st.allQA]
                 .filter(s => s.data.active)
                 .map(s => Date.parse(s.data.created_at) / 1000)
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
      recrBy: staleCr,
      reqaBy: staleQa,
      headPushedAt: headPushedAt(pull),
      ageDays,
      idleDays,
      signedOffAt,
      starved,
      starveScore: starved ? ageDays * Math.max(size, 1) : 0,
      weight: labeledWeight ?? reviewWeight(pull),
      conflict,
      mergeUnknown: pull.mergeable == null,
      dependent,
      sizeKnown,
      devBlockedBy,
      deployBlockedBy,
      qaingBy: label(LABELS.qaing)?.user ?? null,
      externalBlock: !!label(LABELS.externalBlock),
      cryo: !!label(LABELS.cryo),
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
   return (['XS', 'S', 'M', 'L', 'XL'] as const)[i];
}

export const weightRank = (w: Weight) => WEIGHT_RANK[w];

/**
 * The author pushed in the last 30 minutes: probably still iterating. The
 * UI demotes (dims and sinks), never hides. Keyed to the PUSH clock, not
 * updated_at — 62% of this shop's PRs merge same-day, and updated_at moves
 * on every comment, so the old check sank pulls exactly while reviewers
 * were engaging with them. Falls back to updated_at when no CI has
 * reported a push time.
 */
export function isIterating(pull: PullData, now: number = Date.now() / 1000) {
   const pushed = headPushedAt(pull) ?? Date.parse(pull.updated_at) / 1000;
   return now - pushed < 30 * 60;
}
