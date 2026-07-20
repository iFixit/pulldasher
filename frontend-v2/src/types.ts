/**
 * The wire protocol: what the server's Pull.toObject() sends over socket.io.
 * Mirrors frontend/src/types.ts (v1) — the server payload is shared between
 * both frontends, so changes here must stay compatible with v1.
 */

export type DateString = string;

export type PullState = 'open' | 'closed';

export type StatusState = 'error' | 'pending' | 'success' | 'failure';

export type SignatureType = 'CR' | 'QA' | 'dev_block' | 'deploy_block';

export interface RepoSpec {
   name: string;
   requiredStatuses?: string[];
   ignoredStatuses?: string[];
   hideByDefault?: boolean;
}

export interface Label {
   title: string;
   number: number;
   repo: string;
   user: string;
   created_at: DateString;
}

export interface Signature {
   data: {
      repo: string;
      number: number;
      user: { id: number; login: string };
      type: SignatureType;
      created_at: DateString;
      active: number;
      comment_id: number;
      /** which GitHub object the stamp came from, picking the permalink anchor
       * (#issuecomment- vs #pullrequestreview-). Absent on the old dummy
       * fixture; treat missing as a plain comment. */
      source_type?: 'comment' | 'review';
   };
}

export interface CommitStatus {
   data: {
      sha: string;
      target_url: string | null;
      description: string;
      state: StatusState;
      context: string;
      started_at: number | null;
      completed_at: number | null;
   };
}

export interface PullData {
   repo: string;
   number: number;
   state: PullState;
   title: string;
   body: string;
   draft: boolean;
   created_at: DateString;
   updated_at: DateString;
   closed_at: DateString | null;
   merged_at: DateString | null;
   mergeable: boolean | null;
   difficulty: number | null;
   additions: number | null;
   deletions: number | null;
   changed_files?: number | null;
   milestone: { title: string | null; due_on: string | null };
   head: { ref: string; sha: string; repo: { owner: { login: string } } };
   base: { ref: string };
   user: { login: string };
   /** GitHub assignees (logins). Added in the assignee/reviewer merge; servers
    * older than that field omit it, so treat a missing value as []. */
   assignees?: string[];
   /** logins GitHub has an open review request from. The authoritative "review
    * this" signal — stronger than our heuristic turn rotation, which defers to
    * it. Omitted by servers older than the field, so read as [] when absent. */
   requested_reviewers?: string[];
   // the wire also sends top-level cr_req/qa_req twins, but status.cr_req/
   // qa_req are the ones every consumer reads — typing one copy prevents
   // reading the wrong one
   status: {
      cr_req: number;
      qa_req: number;
      allCR: Signature[];
      allQA: Signature[];
      dev_block: Signature[];
      deploy_block: Signature[];
      commit_statuses: CommitStatus[];
      /** discussion aggregates; absent on servers older than the field */
      comment_count?: number;
      last_comment_at?: DateString | null;
      /** reviewers whose latest verdict has no signature of its own (CHANGES_
       * REQUESTED/COMMENTED/DISMISSED — an APPROVED review already shows up
       * as a CR signature); optional — older servers won't send it. */
      unstamped_reviewers?: {
         login: string;
         state: string;
         date: number;
         /** the GitHub review id, for a #pullrequestreview- permalink; absent
          * on servers older than this field. */
         review_id?: number;
         /** the review body, truncated server-side to 400 chars; absent when
          * the review carried no body. */
         body?: string;
      }[];
   };
   labels: Label[];
   participants: string[];
}

export interface InitializePayload {
   repos: RepoSpec[];
   pulls: PullData[];
}

export interface TokenResponse {
   socketToken: string;
   user: string;
   title: string;
}

/** GitHub team → members, for the Teams lens (served as static config). */
export interface Team {
   team: string;
   members: string[];
}
