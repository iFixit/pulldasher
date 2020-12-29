export enum PullState {
   open = "open",
   closed = "closed",
};

type DateString = string;

export enum StatusState {
   error = "error",
   pending = "pending",
   success = "success",
   failure = "failure",
}

export enum SignatureType {
   CR = "CR",
   QA = "QA",
   dev_block = "dev_block",
   deploy_block = "deploy_block",
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
      user: {
         id: number;
         login: string;
      };
      type: SignatureType;
      created_at: DateString | null;
      active: number;
      comment_id: number;
   }
};

export interface CommitStatus {
   data: {
      sha: string;
      target_url: string;
      description: string;
      state: StatusState;
      context: string;
   }
}

export interface Pull {
   repo: string;
   repoSpec: {
      requiredStatuses: string[]
   };
   number: number;
   state: PullState;
   title: string;
   body: string;
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
      QA: Signature[];
      CR: Signature[];
      allQA: Signature[];
      allCR: Signature[];
      dev_block: Signature[];
      deploy_block: Signature[];
      commit_statuses: CommitStatus[];
      ready: boolean;
   };
   labels: Label[];
}
