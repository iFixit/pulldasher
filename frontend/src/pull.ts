import { extend } from "underscore";
import { PullData, Signature } from "./types";

interface SignatureGroup {
   // Contains all signatures that are active
   current: Signature[],
   // Contains all signatures that are inactive from users without signatures in current
   old: Signature[],
   // Contains the most recent signature from the current user
   user: Signature | null
};

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
}

function computeSignatures(signatures: Signature[]): SignatureGroup {
   var groups: SignatureGroup = {
      current: [],
      old: [],
      user: null
   };
   var users: Record<number, boolean> = {};

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
};
