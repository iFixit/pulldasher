import { sortBy } from "lodash-es";
import { getUser } from "./page-context";
import { PullData, Signature, CommitStatus, StatusState, CommentSource, SignatureGroup } from "./types";

export class Pull extends PullData {
   cr_signatures: SignatureGroup;
   qa_signatures: SignatureGroup;

   constructor(data: PullData) {
      super();
      Object.assign(this, data);

      this.cr_signatures = computeSignatures(data.status.allCR);
      this.qa_signatures = computeSignatures(data.status.allQA);
   }

   isOpen(): boolean {
      return this.state == 'open';
   }

   getUrl(): string {
      return 'https://github.com/' + this.repo + '/pull/' + this.number;
   }

   getRepoName(): string {
      return this.repo.replace(/.*\//g, '');
   }

   // Returns a string that is stable and unique to this pull
   getKey(): string {
      return this.repo + "#" + this.number;
   }

   isMine(): boolean {
      return this.user.login == getUser();
   }

   isCrDone(): boolean {
      return this.cr_signatures.current.length >= this.status.cr_req;
   }

   isQaDone(): boolean {
      return this.qa_signatures.current.length >= this.status.qa_req;
   }

   isCiBlocked(): boolean {
      return !this.getDevBlock() && !this.hasPassedCI();
   }

   hasOutdatedSig(user: string) {
      return this.cr_signatures.old.some((sig) => sig.data.user.login == user) ||
             this.qa_signatures.old.some((sig) => sig.data.user.login == user);
   }

   hasCurrentSig(user: string) {
      return this.cr_signatures.current.some((sig) => sig.data.user.login == user) ||
             this.qa_signatures.current.some((sig) => sig.data.user.login == user);
   }

   getDevBlock(): Signature | null {
      return this.status.dev_block[0];
   }

   /**
    * Returns true if the CI requirement has been met
    */
   hasPassedCI(): boolean {
      const statuses = this.buildStatuses();
      return this.getRequiredBuildStatuses().every((context) => {
         const status = statuses.find(status => status.data.context == context);
         return status && isSuccessfulStatus(status);
      });
   }

   /**
    * Returns true if there are required CI statues OR if there are *any* CI
    * statuses
    */
   isCiRequired(): boolean {
      return this.getRequiredBuildStatuses().length > 0 ||
         this.buildStatuses().length > 0;
   }

   isReady(): boolean {
      return this.hasMetDeployRequirements()
         && !this.getDevBlock()
         && !this.getDeployBlock();
   }

   isDeployBlocked(): boolean {
      return this.hasMetDeployRequirements()
         && !this.getDevBlock()
         && (!!this.getDeployBlock() || !this.isCiRequired());
   }

   hasMetDeployRequirements(): boolean {
      return this.isQaDone()
         && this.isCrDone()
         && this.hasPassedCI();
   }

   getDeployBlock(): Signature | null {
      return this.status.deploy_block[0];
   }

   getLabel(title: string) {
      return this.labels.find((label) => label.title == title);
   }

   buildStatuses(): CommitStatus[] {
      return this.status.commit_statuses;
   }

   hasBuildStatus(context: string): boolean {
      return this.status.commit_statuses.some((status) => status.data.context === context);
   }

   buildStatusesWithRequired(): CommitStatus[] {
      const statuses = this.buildStatuses();
      (this.repoSpec?.requiredStatuses || []).forEach((requiredContext) => {
         if (!this.hasBuildStatus(requiredContext)) {
            statuses.push({
               data: {
                  sha: "unknown", // unused and doesn't matter
                  target_url: null,
                  description: "Missing (not started)",
                  state: StatusState.pending,
                  context: requiredContext,
               }
            });
         }
      });
      return sortBy(statuses, [status => status.data.context.toLowerCase()]);
   }

   getRequiredBuildStatuses(): string[] {
      return this.repoSpec?.requiredStatuses
         // If there are no required statuses, then all existing statuses
         // are required to be passing
         ?? this.buildStatuses().map((status) => status.data.context);
   }

   url() {
      return 'https://github.com/' + this.repo + '/pull/' + this.number;
   }

   linkToSignature(sig: Signature): string {
      const isReview = sig.data.source_type === CommentSource.review;
      const linkIdPrefix = isReview ? "pullrequestreview" : "issuecomment";
      return this.url() + `#${linkIdPrefix}-${sig.data.comment_id}`;
   }
}

function computeSignatures(signatures: Signature[]): SignatureGroup {
   const groups: SignatureGroup = {
      current: [],
      old: [],
   };
   const users: Record<string, boolean> = {};

   signatures
   .sort(activeSignaturesFirst)
   .forEach(function(signature) {
      if (users[signature.data.user.login]) {
         return;
      }

      if (signature.data.active) {
         groups.current.push(signature);
      } else {
         groups.old.push(signature);
      }

      users[signature.data.user.login] = true;
   });

   return groups;
}

function activeSignaturesFirst(a: Signature, b: Signature): number {
   return b.data.active - a.data.active;
}

function isSuccessfulStatus(status: CommitStatus) {
   return status.data.state === 'success';
}
