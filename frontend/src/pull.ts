import { extend } from "underscore";
import { PullData } from "./types";

export class Pull extends PullData {
   constructor(data: PullData) {
      super();
      extend(this, data);
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
