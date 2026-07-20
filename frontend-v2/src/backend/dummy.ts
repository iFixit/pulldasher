import type { InitializePayload, PullData } from '../types';

/**
 * Dummy mode: run the whole UI without a backend.
 *   npm run dev:dummy
 * Reuses v1's fixture (frontend/dummy-pulls.json) so both frontends stay
 * honest against the same wire shape.
 */
export function isDummy(): boolean {
   return import.meta.env.VITE_DUMMY === '1';
}

export function dummyUser(): string {
   return import.meta.env.VITE_DUMMY_USER || 'danielbeardsley';
}

export async function loadDummy(): Promise<InitializePayload> {
   const raw = (await import('../../../frontend/dummy-pulls.json'))
      .default as unknown as PullData[];
   // The fixture is a decade of frozen pulls; re-date them so age-derived
   // signals (heat, starvation, freshness) exercise realistically.
   const pulls = withSyntheticStacks(raw).map((p, i) => redate(p, i));
   return {
      repos: [{ name: 'iFixit/ifixit' }],
      // The fixture carries almost no closed/merged pulls and no diff sizes, so
      // the Stats lens (merge-time-by-size, leaderboards over shipped work) has
      // nothing to show. Synthesize a fortnight of merged PRs across the size
      // range so those panels demo. Dummy-only — real data carries this for real.
      pulls: [...pulls, ...synthMerged(pulls)],
   };
}

// The fixture's signature timestamps are as frozen as its pulls; spread them
// across the given window so stamp-timeline stats (review pulse, first-CR
// latency) exercise realistically instead of reading a decade-old wall.
function redateSigs(
   status: PullData['status'],
   startMs: number,
   endMs: number
): PullData['status'] {
   const span = Math.max(endMs - startMs, 3_600_000);
   const shift = <S extends { data: { created_at: string } }>(sigs: S[], salt: number): S[] =>
      sigs.map((s, j) => ({
         ...s,
         data: {
            ...s.data,
            created_at: new Date(
               startMs + ((j + 1) * span) / (sigs.length + 1) + salt
            ).toISOString(),
         },
      }));
   return { ...status, allCR: shift(status.allCR, 0), allQA: shift(status.allQA, 600_000) };
}

// The imperative-nudge system (model/actions.ts rowNote) reads `participants`
// and `status.unstamped_reviewers` to say "answer their review" / "in
// discussion with" — both postdate this fixture, so a few fixed pulls carry
// them here (deterministic indexes, no randomness) to keep those nudges
// QA-able in dummy mode. review_id/body let the state popover's feedback
// section trigger too.
const CHANGES_REQUESTED_INDEX = 2;
const COMMENTED_INDEX = 8;
const EXTRA_PARTICIPANT_INDEXES = new Set([2, 5, 6, 8]);

function unstampedReviewerFor(
   i: number,
   atEpochSecs: number
): PullData['status']['unstamped_reviewers'] {
   if (i === CHANGES_REQUESTED_INDEX) {
      return [
         {
            login: 'grumpy-reviewer',
            state: 'CHANGES_REQUESTED',
            date: atEpochSecs,
            review_id: 800000001,
            body: 'This needs another pass on the error handling before I can sign off — see the inline comments.',
         },
      ];
   }
   if (i === COMMENTED_INDEX) {
      return [
         {
            login: 'curious-commenter',
            state: 'COMMENTED',
            date: atEpochSecs,
            review_id: 800000002,
            body: 'Nice cleanup overall — one question about the retry logic, otherwise this looks good to me.',
         },
      ];
   }
   return undefined;
}

/**
 * A dev-blocked dummy pull's block signature needs a comment_id so the state
 * popover can build a GitHub permalink for it (signatureUrl). The fixture's
 * dev_block signatures already carry one, but this keeps the demo honest if
 * that ever stops being true.
 */
function withDevBlockCommentId(status: PullData['status']): PullData['status'] {
   if (!status.dev_block.some(s => !s.data.comment_id)) return status;
   return {
      ...status,
      dev_block: status.dev_block.map((s, j) => ({
         ...s,
         data: { ...s.data, comment_id: s.data.comment_id || 900_000_000 + j },
      })),
   };
}

// Participants beyond the CR/QA stampers already on the pull, so
// engagedNoStamp (a review with no stamp, or a comment-only bystander) has
// something to derive.
function participantsFor(pull: PullData, i: number): string[] {
   if (!EXTRA_PARTICIPANT_INDEXES.has(i)) return pull.participants ?? [];
   const stampers = [...pull.status.allCR, ...pull.status.allQA].map(s => s.data.user.login);
   const extra =
      i === CHANGES_REQUESTED_INDEX
         ? ['grumpy-reviewer']
         : i === COMMENTED_INDEX
           ? ['curious-commenter']
           : ['silent-lurker'];
   return [...new Set([...(pull.participants ?? []), ...stampers, ...extra])];
}

// Fixed raw-fixture indices rewritten into two stacked-PR demos for
// model/stack.ts's groupIntoTree (deterministic, same spirit as the rest of
// this file's index-keyed synthesis): a 3-deep chain (#35168 -> #35177 ->
// #35194) and one parent with two children (#35207 -> #35236, #35249). Left
// untouched: indices 5-7, where the fixture already carries the ambiguous-
// parent case unassisted — #35103 and #351011 share a head ref, and #35059
// (index 5) already bases off it, so groupIntoTree's flat fallback is
// QA-able without any synthesis here.
const CHAIN_INDEXES = [10, 11, 12] as const; // parent, child, grandchild
const FORK_INDEXES = [13, 14, 15] as const; // parent, child, child

function withSyntheticStacks(pulls: PullData[]): PullData[] {
   const out = [...pulls];
   const rebase = (i: number, baseRef: string) => {
      out[i] = { ...out[i], base: { ...out[i].base, ref: baseRef } };
   };
   const [chainParent, chainChild, chainGrandchild] = CHAIN_INDEXES;
   rebase(chainChild, out[chainParent].head.ref);
   rebase(chainGrandchild, out[chainChild].head.ref);
   const [forkParent, forkChild1, forkChild2] = FORK_INDEXES;
   rebase(forkChild1, out[forkParent].head.ref);
   rebase(forkChild2, out[forkParent].head.ref);
   return out;
}

function redate(pull: PullData, i: number): PullData {
   const now = Date.now();
   const ageDays = (i * 7919) % 45; // deterministic spread, 0-45 days
   const created = new Date(now - ageDays * 86400_000);
   const updated = new Date(now - ((i * 104729) % (72 * 3600_000)));
   // synthesize a diff size when the fixture omits one, so the weight meter
   // and size-derived stats aren't all flat XS in dummy mode
   const additions = pull.additions ?? 17 + ((i * 4099) % 1600);
   const deletions = pull.deletions ?? (i * 1237) % 400;
   const status = withDevBlockCommentId(redateSigs(pull.status, created.getTime(), now));
   const unstamped_reviewers = unstampedReviewerFor(i, Math.floor(created.getTime() / 1000) + 3600);
   return {
      ...pull,
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
      status: unstamped_reviewers ? { ...status, unstamped_reviewers } : status,
      participants: participantsFor(pull, i),
      additions,
      deletions,
   };
}

// Clone a slice of the board into merged PRs, closed within the last 14 days,
// with merge time that rises with size (plus jitter) so the trend is visible.
function synthMerged(pulls: PullData[]): PullData[] {
   const now = Date.now();
   return pulls.slice(0, 16).map((p, i) => {
      const size = (p.additions ?? 0) + (p.deletions ?? 0);
      const mergeHours = 1.5 + size / 45 + ((i * 53) % 34);
      const closedDaysAgo = (i * 3) % 14;
      const merged = now - closedDaysAgo * 86400_000;
      const created = merged - mergeHours * 3_600_000;
      return {
         ...p,
         number: 90000 + i,
         state: 'closed',
         draft: false,
         created_at: new Date(created).toISOString(),
         updated_at: new Date(merged).toISOString(),
         closed_at: new Date(merged).toISOString(),
         merged_at: new Date(merged).toISOString(),
         status: redateSigs(p.status, created, merged),
      };
   });
}
