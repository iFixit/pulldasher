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

   // Returns a string that is stable and unique to this pull
   getKey(): string {
      return this.repo + "#" + this.number;
   }

   isCrDone(): boolean {
      return this.status.CR.length >= this.status.cr_req;
   }

   isQaDone(): boolean {
      return this.status.QA.length >= this.status.qa_req;
   }

   isCiBlocked(): boolean {
      return !this.isDevBlocked() && !this.hasPassedCI();
   }

   isDevBlocked(): boolean {
      return this.status.dev_block.length > 0;
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
         && !this.isDevBlocked()
         && !this.hasDeployBlock();
   }

   isDeployBlocked(): boolean {
      return this.hasMetDeployRequirements()
         && !this.isDevBlocked()
         && this.hasDeployBlock();
   }

   hasMetDeployRequirements(): boolean {
      return this.isQaDone()
         && this.isCrDone()
         && this.hasPassedCI();
   }

   hasDeployBlock(): boolean {
      return this.status.deploy_block.length > 0;
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
