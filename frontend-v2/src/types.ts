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
   cr_req: number;
   qa_req: number;
   status: {
      cr_req: number;
      qa_req: number;
      allCR: Signature[];
      allQA: Signature[];
      dev_block: Signature[];
      deploy_block: Signature[];
      commit_statuses: CommitStatus[];
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
