import { PullData } from '../src/types';

export const NeedsCr: PullData = <PullData>{
  "repo": "iFixit/ifixit",
  "repoSpec": null,
  "number": 33495,
  "state": "open",
  "title": "IE11: Run in parallel with chrome tests instead of sequentially",
  "body": "pull request dummy body",
  "created_at": "2020-07-08T22:55:22.000Z",
  "updated_at": "2020-10-16T21:58:04.000Z",
  "closed_at": null,
  "merged_at": null,
  "difficulty": null,
  "milestone": {
    "title": null,
    "due_on": null
  },
  "head": {
    "ref": "ie11--run-in-parallel-with-chrome-tests",
    "sha": "ee18a55031b8b1e86dbe240552dfe86f344559d7",
    "repo": {
      "owner": {
        "login": "iFixit"
      }
    }
  },
  "base": {
    "ref": "master"
  },
  "user": {
    "login": "BaseInfinity"
  },
  "cr_req": 2,
  "qa_req": 1,
  "status": {
    "qa_req": 1,
    "cr_req": 2,
    "QA": [],
    "CR": [
      {
        "data": {
          "repo": "iFixit/ifixit",
          "number": 33495,
          "user": {
            "id": 26855,
            "login": "danielbeardsley"
          },
          "type": "CR",
          "created_at": "2020-07-08T23:47:35.000Z",
          "active": 1,
          "comment_id": 655814623
        }
      }
    ],
    "allQA": [],
    "allCR": [
      {
        "data": {
          "repo": "iFixit/ifixit",
          "number": 33495,
          "user": {
            "id": 26855,
            "login": "danielbeardsley"
          },
          "type": "CR",
          "created_at": "2020-07-08T23:47:35.000Z",
          "active": 1,
          "comment_id": 655814623
        }
      },
      {
        "data": {
          "repo": "iFixit/ifixit",
          "number": 33495,
          "user": {
            "id": 26855,
            "login": "danielbeardsley"
          },
          "type": "CR",
          "created_at": "2020-07-08T23:10:20.000Z",
          "active": 0,
          "comment_id": 655803840
        }
      }
    ],
    "dev_block": [
      {
        "data": {
          "repo": "iFixit/ifixit",
          "number": 33495,
          "user": {
            "id": 26855,
            "login": "danielbeardsley"
          },
          "type": "dev_block",
          "created_at": "2020-07-08T23:10:20.000Z",
          "active": 1,
          "comment_id": 655803840
        }
      }
    ],
    "deploy_block": [],
    "commit_statuses": [
      {
        "data": {
          "sha": "ee18a55031b8b1e86dbe240552dfe86f344559d7",
          "target_url": "https://wwww.example.com",
          "description": "Build success",
          "state": "success",
          "context": "jest"
        }
      },
      {
        "data": {
          "sha": "ee18a55031b8b1e86dbe240552dfe86f344559d7",
          "target_url": "https://wwww.example.com",
          "description": "Build success",
          "state": "success",
          "context": "phpunit"
        }
      },
      {
        "data": {
          "sha": "ee18a55031b8b1e86dbe240552dfe86f344559d7",
          "target_url": "https://wwww.example.com",
          "description": "Merge Failed",
          "state": "error",
          "context": "psalm"
        }
      }
    ],
    "ready": false
  },
  "labels": [
    {
      "title": "QAE",
      "number": 33495,
      "repo": "iFixit/ifixit",
      "user": "davidrans",
      "created_at": "2020-07-23T19:51:19.000Z"
    }
  ]
};
