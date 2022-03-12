import { PullData } from '../src/types';

export const head = {
   "ref": "some-branch-name",
   "sha": "ee18a55031b8b1e86dbe240552dfe86f344559d7",
   "repo": {
      "owner": {
         "login": "iFixit"
      }
   }
};

export function daysAgo(days:number): string {
   return (new Date(Date.now() - days * 86400 * 1000)).toString();
}

export function pullData(p: Partial<PullData>): PullData {
   return <PullData> {
      "repo": "iFixit/ifixit",
      "repoSpec": null,
      "number": 33495,
      "state": "open",
      "title": p.title || "Young pull with no CR / QA",
      "body": "pull request dummy body",
      "created_at": p.created_at || daysAgo(0),
      "updated_at": daysAgo(0),
      "closed_at": null,
      "merged_at": null,
      "difficulty": null,
      "milestone": {
         "title": null,
         "due_on": null
      },
      "head": head,
      "base": {
         "ref": "master"
      },
      "user": {
         "login": "BaseInfinity"
      },
      "cr_req": p.cr_req != null ? p.cr_req : 2,
      "qa_req": p.qa_req != null ? p.qa_req : 1,
      "status": {
         "cr_req": p.cr_req != null ? p.cr_req : 2,
         "qa_req": p.qa_req != null ? p.qa_req : 1,
         "QA": [],
         "CR": [],
         "allQA": [],
         "allCR": [],
         "dev_block": [],
         "deploy_block": [],
         "commit_statuses": [],
         "ready": false,
      },
      "labels": []
   };
}
