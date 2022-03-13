import {
   PullData,
   Signature,
   SignatureType,
   StatusState,
   CommitStatus,
} from '../src/types';

const repo = "iFixit/ifixit";

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

export function sig(type : SignatureType, active: boolean, user?: string): Signature {
   return <Signature>{
      "data": {
         "repo": repo,
         "number": 100, // Meant to be a pull number, but it's never used
         "user": {
            "id": id(),
            "login": user || username()
         },
         "type": type,
         "created_at": "2020-09-04T20:08:21.000Z",
         "active": active ? 1 : 0,
         "comment_id": id(),
      }
   };
}

export function status(state?: keyof typeof StatusState, url?: string | null): CommitStatus {
   return {
      "data": {
         "sha": "64bf41772407e98112f173eeb75b7118096203d1",
         "target_url": url === undefined ? "https://www.example.com" : url,
         "description": "Build success",
         "state": <StatusState>state || StatusState.success,
         "context": statusContext(),
      }
   };
}

export function pullData(p: DeepPartial<PullData>): PullData {
   return <PullData> {
      "repo": repo,
      "repoSpec": null,
      "number": pullNumber(),
      "state": "open",
      "title": p.title || "Young pull with no CR / QA",
      "body": "pull request dummy body",
      "created_at": p.created_at || daysAgo(0),
      "updated_at": daysAgo(0),
      "closed_at": null,
      "merged_at": null,
      "difficulty": null,
      "milestone": p.milestone || {
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
         "QA": p.status?.QA || [],
         "CR": p.status?.CR || [],
         "allQA": p.status?.allQA || [],
         "allCR": p.status?.allCR || [],
         "dev_block": p.status?.dev_block || [],
         "deploy_block": p.status?.deploy_block || [],
         "commit_statuses": p.status?.commit_statuses || [],
         "ready": false,
      },
      "labels": []
   };
}

function id(): number {
   return Math.floor(Math.random()*1000000);
}

function pullNumber(): number {
   return Math.floor(Math.random()*10000 + 10000);
}

function username(): string {
   return "username-" + Math.floor(Math.random()*1000);
}

function statusContext(): string {
   return "context-" + Math.floor(Math.random()*1000);
}

type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
