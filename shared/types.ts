/**
 * The wire protocol: what the server's Pull.toObject() sends over socket.io.
 * Mirrors frontend/src/types.ts (v1) — the server payload is shared between
 * both frontends, so changes here must stay compatible with v1.
 */

export type DateString = string;

export type PullState = 'open' | 'closed';

export type StatusState = 'error' | 'pending' | 'success' | 'failure';

export type SignatureType = 'CR' | 'QA' | 'dev_block' | 'deploy_block';

export interface RepoSpec {
   name: string;
   requiredStatuses?: string[];
   ignoredStatuses?: string[];
   /* the wire also carries a v1-era `hideByDefault` flag; the client
      ignores it — repo hiding is per-user (see model/visibility.ts) */
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
      user: { id: number; login: string };
      type: SignatureType;
      created_at: DateString;
      active: number;
      comment_id: number;
      /** which GitHub object the stamp came from, picking the permalink anchor
       * (#issuecomment- vs #pullrequestreview-). Absent on the old dummy
       * fixture; treat missing as a plain comment. */
      source_type?: 'comment' | 'review';
   };
}

export interface CommitStatus {
   data: {
      sha: string;
      target_url: string | null;
      description: string;
      state: StatusState;
      context: string;
      started_at: number | null;
      completed_at: number | null;
   };
}

export interface PullData {
   repo: string;
   number: number;
   state: PullState;
   title: string;
   body: string;
   draft: boolean;
   created_at: DateString;
   updated_at: DateString;
   closed_at: DateString | null;
   merged_at: DateString | null;
   mergeable: boolean | null;
   difficulty: number | null;
   additions: number | null;
   deletions: number | null;
   changed_files?: number | null;
   /** issue numbers parsed from the description's closes/connects body tags
    * (server-side, models/pull.js parseBody); string digits on the wire */
   closes?: string | number | null;
   connects?: string | number | null;
   milestone: { title: string | null; due_on: string | null };
   head: { ref: string; sha: string; repo: { owner: { login: string } } };
   base: { ref: string };
   user: { login: string };
   /** GitHub assignees (logins). Added in the assignee/reviewer merge; servers
    * older than that field omit it, so treat a missing value as []. */
   assignees?: string[];
   /** logins GitHub has an open review request from. The authoritative "review
    * this" signal — stronger than our heuristic turn rotation, which defers to
    * it. Omitted by servers older than the field, so read as [] when absent. */
   requested_reviewers?: string[];
   /** the requested_reviewers entries, with per-request metadata: `at` is when
    * the request was made (epoch seconds, null when the server can't say —
    * e.g. it restarted before the webhook backfilled it), and `self` is true
    * when the reviewer requested themselves (a pulldasher claim or a
    * GitHub-UI self-request) rather than being asked by someone else. A CLAIM
    * is any entry with self === true. Best-effort and additive: older servers
    * omit the field entirely, so read as [] when absent — requested_reviewers
    * stays the authoritative list of who's requested either way.
    * `answered` marks a request GitHub has since cleared because the reviewer
    * reviewed (never one the author withdrew); such a login is NOT in
    * requested_reviewers. It keeps a push from reading as self-review. */
   review_requests?: Array<{ login: string; at: number | null; self: boolean; answered?: boolean }>;
   /** GitHub team slugs the PR asks a review from (the pull's
    * requested_teams). Under the self-review policy a request means everyone
    * listed; derive() turns a slug into people through the roster teams
    * (config projects.developerTeams), matched by name. Absent on older
    * servers: read as []. */
   requested_teams?: string[];
   /** when each requested team was asked (epoch secs, null if unknown), from
    * the review_requested webhook; a team's members inherit its time, so a
    * team request gets the same hours clock as a personal one. Absent on
    * older servers: read as []. */
   team_requests?: Array<{ slug: string; at: number | null }>;
   /** areas the diff touches that usually deserve team input (ci, migrations,
    * alerting, agent-docs, deploy, dependencies), computed server-side from
    * the changed file paths. Absent until the server has looked: read as []. */
   input_hints?: string[];
   // the wire also sends top-level cr_req/qa_req twins, but status.cr_req/
   // qa_req are the ones every consumer reads — typing one copy prevents
   // reading the wrong one
   status: {
      cr_req: number;
      qa_req: number;
      allCR: Signature[];
      allQA: Signature[];
      dev_block: Signature[];
      deploy_block: Signature[];
      commit_statuses: CommitStatus[];
      /** discussion aggregates; absent on servers older than the field */
      comment_count?: number;
      /** comment_count with bot-authored comments (a `[bot]` login or
       * config.json's `bots` list) excluded, so bot chatter can't drive the
       * human-review nudge or wake a snooze. Optional and additive: older
       * servers omit it, so a consumer falls back to comment_count. */
      human_comment_count?: number;
      last_comment_at?: DateString | null;
      /** the newest real work on the PR: opened, pushed, a person's comment,
       * stamp or review, or merged (models/pull.js activityAt). Unlike
       * updated_at, a label edit doesn't move it. Absent on older servers. */
      activity_at?: DateString | null;
      /** reviewers whose latest verdict has no signature of its own (CHANGES_
       * REQUESTED/COMMENTED/DISMISSED — an APPROVED review already shows up
       * as a CR signature); optional — older servers won't send it. */
      unstamped_reviewers?: {
         login: string;
         state: string;
         date: number;
         /** the GitHub review id, for a #pullrequestreview- permalink; absent
          * on servers older than this field. */
         review_id?: number;
         /** the review body, truncated server-side to 400 chars; absent when
          * the review carried no body. */
         body?: string;
      }[];
   };
   labels: Label[];
   participants: string[];
}

export interface InitializePayload {
   repos: RepoSpec[];
   pulls: PullData[];
   /** deployment config the server owns (config.js), delivered here instead of
    * a separate static config.json fetch: bot logins beyond the `[bot]` suffix,
    * and the label-title -> weight map. Optional/additive so an older server
    * that omits them just means suffix-only bots and heuristic-only weights. */
   bots?: string[];
   weightLabels?: Record<string, string>;
   /** the label prefix that files a PR into a project (`project:`), present
    * only when the server is set up for projects; the Projects tab shows only
    * then. See shared/model/projects.ts. */
   projectLabelPrefix?: string;
   /** config projects.developerTeams: team name -> logins. Anyone listed is
    * a developer, who reviews their own PRs unless they ask for review;
    * everyone else's PRs still need someone else's. Absent: everyone counts
    * as a developer. */
   developerTeams?: Record<string, string[]>;
   /** names the frontend build the server is serving (absent without a build);
    * a different one on a later initialize means the board was redeployed */
   build?: string;
}

/** "Refresh all" on the server, sent to every board: it checks GitHub, then
 * refetches the pulls the board has wrong, one press at a time. */
export interface RefreshAllProgress {
   /** waiting: the pacer is holding the next refetch until `until` */
   state: 'checking' | 'refreshing' | 'waiting' | 'done';
   /** pulls refetched so far, of the `total` that differed from GitHub */
   done: number;
   total: number;
   /** pulls that couldn't be refetched, and repos GitHub didn't list */
   failed: number;
   skipped: number;
   /** epoch ms the press resumes, while waiting */
   until?: number;
}

export interface TokenResponse {
   socketToken: string;
   user: string;
   title: string;
}
