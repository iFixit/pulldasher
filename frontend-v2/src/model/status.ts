import type { CommitStatus, PullData, RepoSpec, Signature } from '../types';

/**
 * One pull, one status. Mutually exclusive by precedence — the fix for v1's
 * six overlapping column predicates (a pull could sit in CR and QA at once).
 * Precedence mirrors the what-to-review skill's derivation:
 *   draft > blocked > ci_red > needs_recr > needs_cr > needs_qa >
 *   ci_pending > ready
 *
 * ci_pending exists only at the ready gate: pending CI never hides a pull
 * from the review lanes (reviews don't need green), but a fully-signed-off
 * pull isn't "ready" until CI agrees. Merge conflicts and a dependent base
 * gate the same way: reviewable as usual, but never "ready".
 */
export type Status =
   | 'draft'
   | 'blocked'
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
   'blocked',
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
   /** users whose CR stamp counts on the current head */
   crBy: string[];
   qaBy: string[];
   crHave: number;
   qaHave: number;
   /** users whose CR a later push invalidated and who haven't re-stamped */
   recrBy: string[];
   /** epoch secs of the invalidating push (head CI start proxy); null if unknown */
   headPushedAt: number | null;
   ageDays: number;
   /** still waiting on its first CR after STARVE_DAYS */
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
   /** everyone holding an active dev/deploy block, oldest first */
   blockedBy: string[];
   /** login from the QAing label: someone is already testing this */
   qaingBy: string | null;
   externalBlock: boolean;
   cryo: boolean;
}

export type Weight = 'XS' | 'S' | 'M' | 'L' | 'XL';
const WEIGHT_RANK: Record<Weight, number> = { XS: 0, S: 1, M: 2, L: 3, XL: 4 };

export const STARVE_DAYS = 7;

const activeUsers = (sigs: Signature[]) =>
   unique(sigs.filter(s => s.data.active).map(s => s.data.user.login));

function unique<T>(xs: T[]): T[] {
   return [...new Set(xs)];
}

/**
 * CI verdict, computed client-side (the server ships raw statuses plus the
 * per-repo required/ignored lists and leaves the reduction to the frontend).
 * Required = repoSpec.requiredStatuses when configured, else every reported
 * status minus repoSpec.ignoredStatuses.
 */
export function ciVerdict(pull: PullData, spec?: RepoSpec): CiVerdict {
   const onHead = pull.status.commit_statuses.filter(s => s.data.sha === pull.head.sha);
   const statuses = onHead.length ? onHead : pull.status.commit_statuses;
   if (!statuses.length && !spec?.requiredStatuses?.length) return 'none';

   let required: CommitStatus[];
   if (spec?.requiredStatuses?.length) {
      required = statuses.filter(s => spec.requiredStatuses!.includes(s.data.context));
      // a configured-required status that hasn't reported yet counts as pending
      if (required.length < spec.requiredStatuses.length) {
         const reported = new Set(required.map(s => s.data.context));
         if (spec.requiredStatuses.some(c => !reported.has(c))) {
            if (required.some(s => isFailing(s))) return 'failing';
            return 'pending';
         }
      }
   } else {
      const ignored = new Set(spec?.ignoredStatuses ?? []);
      required = statuses.filter(s => !ignored.has(s.data.context));
   }
   if (!required.length) return 'none';
   if (required.some(isFailing)) return 'failing';
   if (required.some(s => s.data.state === 'pending')) return 'pending';
   return 'success';
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

export function derive(
   pull: PullData,
   spec: RepoSpec | undefined,
   now: number = Date.now() / 1000
): DerivedPull {
   const st = pull.status;
   const crBy = activeUsers(st.allCR);
   const qaBy = activeUsers(st.allQA);
   const crHave = crBy.length;
   const qaHave = qaBy.length;
   const ci = ciVerdict(pull, spec);

   const staleCr = unique(
      st.allCR
         .filter(s => !s.data.active)
         .map(s => s.data.user.login)
         .filter(u => !crBy.includes(u) && u !== pull.user.login)
   );

   // a lifted block deactivates its signature, same as a stale CR stamp
   const blockHolders = unique(
      [...st.dev_block, ...st.deploy_block].filter(s => s.data.active).map(s => s.data.user.login)
   );
   const crDone = crHave >= st.cr_req;
   const qaDone = qaHave >= st.qa_req;

   const conflict = pull.mergeable === false;
   const dependent = !['main', 'master'].includes(pull.base.ref);
   const label = (title: string) => pull.labels.find(l => l.title === title);

   let status: Status;
   if (pull.draft) status = 'draft';
   else if (blockHolders.length) status = 'blocked';
   else if (ci === 'failing') status = 'ci_red';
   else if (!crDone && staleCr.length) status = 'needs_recr';
   else if (!crDone) status = 'needs_cr';
   else if (!qaDone) status = 'needs_qa';
   else if (ci === 'pending') status = 'ci_pending';
   // signed off and green, but unmergeable as-is: that's a block, not ready
   else if (conflict || dependent) status = 'blocked';
   else status = 'ready';

   const created = Date.parse(pull.created_at) / 1000;
   const ageDays = Math.max(0, Math.floor((now - created) / 86400));
   const sizeKnown = pull.additions != null || pull.deletions != null;
   const size = (pull.additions ?? 0) + (pull.deletions ?? 0);
   const starved = status === 'needs_cr' && crHave === 0 && ageDays >= STARVE_DAYS;

   return {
      data: pull,
      status,
      ci,
      crBy,
      qaBy,
      crHave,
      qaHave,
      recrBy: staleCr,
      headPushedAt: headPushedAt(pull),
      ageDays,
      starved,
      starveScore: starved ? ageDays * Math.max(size, 1) : 0,
      weight: reviewWeight(pull),
      conflict,
      mergeUnknown: pull.mergeable == null,
      dependent,
      sizeKnown,
      blockedBy: blockHolders,
      qaingBy: label(LABELS.qaing)?.user ?? null,
      externalBlock: !!label(LABELS.externalBlock),
      cryo: !!label(LABELS.cryo),
   };
}

/**
 * Expected review effort from size and sprawl. A cheap prior, not a verdict:
 * the UI sorts by it and shows it as a chip; humans override by reading.
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
 * The author pushed or the pull changed in the last 30 minutes with nobody
 * else active since: probably still iterating. The UI demotes (dims and
 * sinks), never hides.
 */
export function isIterating(pull: PullData, now: number = Date.now() / 1000) {
   const updated = Date.parse(pull.updated_at) / 1000;
   return now - updated < 30 * 60;
}
