import type { InitializePayload, PullData } from '../../../shared/types';

/**
 * Dummy mode: run the whole UI without a backend.
 *   npm run dev:dummy
 * The fixture is a frozen snapshot of the wire shape (it moved here when the
 * legacy v1 frontend was retired), lazy-imported so it never lands in the
 * production bundle.
 */
export function isDummy(): boolean {
   return import.meta.env.VITE_DUMMY === '1';
}

export function dummyUser(): string {
   return import.meta.env.VITE_DUMMY_USER || 'danielbeardsley';
}

export async function loadDummy(): Promise<InitializePayload> {
   const raw = (await import('./dummy-pulls.json')).default as unknown as PullData[];
   // The fixture is a decade of frozen pulls; re-date them so age-derived
   // signals (heat, starvation, freshness) exercise realistically.
   // the frozen fixture predates diff stats on the wire; the real server now
   // guarantees them on every open pull, so the demo board synthesizes a
   // deterministic spread that exercises every weight class (and the
   // >15-files bump) instead of reading all-XS
   const SIZE_SPREAD = [12, 38, 90, 140, 320, 560, 900, 1400, 2600];
   const withSizes = (p: PullData, i: number): PullData =>
      p.additions != null
         ? p
         : {
              ...p,
              additions: Math.round(SIZE_SPREAD[i % SIZE_SPREAD.length] * 0.7),
              deletions: Math.round(SIZE_SPREAD[i % SIZE_SPREAD.length] * 0.3),
              changed_files: 1 + (i % 22),
           };
   // the fixture's bodies are one flat placeholder line; rotate realistic
   // markdown so the title's description preview demos what it renders
   // (headings, checklists, code, links)
   const BODIES = [
      'closes #4821\n\n## Summary\nMoves the cart badge count out of the page render and onto the shared header stream, so cached pages stop showing a stale count.\n\n## QA\n- [x] badge updates after adding to cart\n- [ ] logged-out view shows no badge\n- [ ] works on the checkout pages',
      'The old query scanned `pull_signatures` per row; this batches it:\n\n```sql\nSELECT number, MAX(date) FROM pull_signatures GROUP BY number\n```\n\nCuts the dashboard load from ~4s to ~300ms on prod data. See [the profile](https://example.com/profile) for before/after.',
      '## Why\nSupport keeps getting "my order vanished" tickets — the order list dropped rows with a null `shipped_at`.\n\n> Root cause: the join predicate treated NULL as false.\n\nOne-line fix plus a regression test.',
   ];
   const withBody = (p: PullData, i: number): PullData =>
      p.body === 'pull request dummy body' ? { ...p, body: BODIES[i % BODIES.length] } : p;
   const pulls = withSyntheticStacks(raw).map((p, i) => withBody(withSizes(redate(p, i), i), i));
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

// `requested_reviewers`/`assignees` postdate this fixture, so some pulls carry a
// review request aimed at the dummy viewer (so the "Requested of you" lane and
// the row's "review requested" chip demo) and a couple of assignees. Keyed off
// the pull's own author, not a raw index, since a request only surfaces on
// someone else's PR — every third non-viewer pull gets one, deterministically.
const wantsReviewRequest = (pull: PullData, i: number): boolean =>
   pull.user.login !== dummyUser() && i % 3 === 1;
const ASSIGNEE_INDEXES = new Set([6, 12]);

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
   // The chain belongs to the dummy viewer: a dependent pull's status differs
   // from its parent's, so on Review the members scatter across lanes and
   // only ever demo the flat-with-stub case. My work is the one surface that
   // holds a whole chain in one list (your own PRs, and WordGroupRows pulls
   // children into their root's bucket), so a viewer-authored chain is the
   // standing FULL demo of nesting: indent + elbow, three deep. The fork
   // stays authored by others, which keeps the split-stack stub demo alive
   // on Review at the same time.
   for (const i of CHAIN_INDEXES) {
      out[i] = { ...out[i], user: { ...out[i].user, login: dummyUser() } };
   }
   // ...and every chain member gets a merge conflict and a clean signature
   // slate. The children are already 'unmergeable' by virtue of being
   // dependent, but per-member noise (the grandchild's fixture carries a
   // stale CR, the root would otherwise be a plain wait) scatters the three
   // across the move/wait lanes, and a chain only nests when its members
   // share one list. Uniform state = one bucket = the standing 3-deep demo
   // of indent + elbow on My work and Review both.
   for (const i of CHAIN_INDEXES) {
      out[i] = {
         ...out[i],
         mergeable: false,
         status: { ...out[i].status, allCR: [], allQA: [] },
      };
   }
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
      requested_reviewers: wantsReviewRequest(pull, i)
         ? [dummyUser()]
         : (pull.requested_reviewers ?? []),
      assignees: ASSIGNEE_INDEXES.has(i) ? [dummyUser()] : (pull.assignees ?? []),
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
