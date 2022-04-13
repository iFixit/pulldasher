export enum PullState {
   open = "open",
   closed = "closed",
}

export type DateString = string;

export enum StatusState {
   error = "error",
   pending = "pending",
   success = "success",
   failure = "failure",
}

export enum CommentSource {
   comment = "comment",
   review = "review",
}

export enum SignatureType {
   CR = "CR",
   QA = "QA",
   dev_block = "dev_block",
   deploy_block = "deploy_block",
}

export interface SignatureUser {
   id: number;
   login: string;
}

export interface RepoSpec {
   requiredStatuses: string[];
   name: string;
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
      user: SignatureUser;
      type: SignatureType;
      created_at: DateString | null;
      active: number;
      comment_id: number;
      source_type: CommentSource;
   }
}

export interface SignatureGroup {
   // Contains all signatures that are active
   current: Signature[],
   // Contains all signatures that are inactive from users without signatures in current
   old: Signature[],
}

export interface CommitStatus {
   data: {
      sha: string;
      target_url: string | null;
      description: string;
      state: StatusState;
      context: string;
   }
}

export class PullData {
   repo: string;
   repoSpec: RepoSpec | null;
   number: number;
   state: PullState;
   title: string;
   body: string;
   received_at: Date | null;
   created_at: DateString;
   updated_at: DateString;
   closed_at: DateString | null;
   merged_at: DateString | null;
   difficulty: number | null;
   milestone: {
      title: string | null;
      due_on: string | null;
   };
   head: {
      ref: string;
      sha: string;
      repo: {
         owner: {
            login: string;
         }
      }
   };
   base: {
      ref: string;
   };
   user: {
      login: string;
   };
   cr_req: number;
   qa_req: number;
   status: {
      qa_req: number;
      cr_req: number;
      allQA: Signature[];
      allCR: Signature[];
      dev_block: Signature[];
      deploy_block: Signature[];
      commit_statuses: CommitStatus[];
   };
   labels: Label[];
}
