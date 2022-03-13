import { getUser } from "./page-context";
import { extend } from "underscore";
import { PullData, Signature, CommitStatus, SignatureGroup } from "./types";

export class Pull extends PullData {
   cr_signatures: SignatureGroup;
   qa_signatures: SignatureGroup;

   constructor(data: PullData) {
      super();
      extend(this, data);

      this.cr_signatures = computeSignatures(data.status.allCR);
      this.qa_signatures = computeSignatures(data.status.allQA);
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
      return this.status.CR.length >= this.status.cr_req;
   }

   isQaDone(): boolean {
      return this.status.QA.length >= this.status.qa_req;
   }

   isCiBlocked(): boolean {
      return !this.getDevBlock() && !this.hasPassedCI();
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

   isReady(): boolean {
      return this.hasMetDeployRequirements()
         && !this.getDevBlock()
         && !this.getDeployBlock();
   }

   isDeployBlocked(): boolean {
      return this.hasMetDeployRequirements()
         && !this.getDevBlock()
         && !!this.getDeployBlock();
   }

   hasMetDeployRequirements(): boolean {
      return this.isQaDone()
         && this.isCrDone()
         && this.hasPassedCI();
   }

   getDeployBlock(): Signature | null {
      return this.status.deploy_block[0];
   }

   buildStatuses(): CommitStatus[] {
      return this.status.commit_statuses || [];
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
      return this.url() + '#issuecomment-' + sig.data.comment_id;
   }
}

function computeSignatures(signatures: Signature[]): SignatureGroup {
   const groups: SignatureGroup = {
      current: [],
      old: [],
      user: null
   };
   const users: Record<number, boolean> = {};

   signatures.forEach(function(signature) {
      if (users[signature.data.user.id]) {
         return;
      }

      if (signature.data.active) {
         groups.current.push(signature);
      } else {
         groups.old.push(signature);
      }

      users[signature.data.user.id] = true;
   });

   return groups;
}

function isSuccessfulStatus(status: CommitStatus) {
   return status.data.state === 'success';
}
