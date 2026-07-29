import utils from '../lib/utils.js';
import _ from 'underscore';
import config from '../lib/config-loader.js';
import queue from '../lib/pull-queue.js';
import debug from '../lib/debug.js';
import DBPull from './db_pull.js';
import getLogin from '../lib/get-user-login.js';
import { isBot } from '../lib/review-model.js';

const log = debug('pulldasher:pull');

/**
 * Memory-only cache of review-request metadata: `"repo#number"` -> a Map of
 * `login` -> `{ at, self }`. GitHub's requested_reviewers (a plain login
 * list, carried on `data` like any other field) is the source of truth for
 * WHO is currently requested; this cache only ever adds the *when/how* for
 * logins we've been able to observe an origin for, via one of two writers:
 *
 *   - A full refresh (git-manager's parse(), which reads the issue's events
 *     stream) computes the complete, authoritative set for a pull and
 *     replaces this cache's entry for it wholesale (see fromGithubApi below).
 *   - A `review_requested` / `review_request_removed` webhook (see
 *     controllers/githubHooks.js) knows only its own one login; it updates
 *     that single entry via recordReviewRequested/recordReviewRequestRemoved.
 *
 * Reading (getReviewRequests, used by toObject) always reconciles against the
 * pull's *current* requested_reviewers at read time, so a login the cache
 * doesn't know about yet (e.g. requested before Pulldasher ever saw an event
 * for it, or before the next full refresh) still gets an entry, just
 * `{ at: null, self: false }` -- never a DB write, and never persisted past a
 * process restart.
 *
 * Nothing here ever drops the outer `repo#number` key on its own (only the
 * inner per-login entries shrink, via recordReviewRequestRemoved), so
 * pull-manager.js's hourly cull calls pruneReviewRequests to keep this map
 * from growing by one entry per pull for the life of the process.
 */
const reviewRequestsByPull = new Map();

function reviewRequestsKey(repo, number) {
   return `${repo}#${number}`;
}

function getReviewRequests(repo, number, requestedReviewerLogins) {
   const known = reviewRequestsByPull.get(reviewRequestsKey(repo, number));
   return (requestedReviewerLogins || []).map(login => {
      const entry = known && known.get(login);
      return entry ? { login, at: entry.at, self: entry.self } : { login, at: null, self: false };
   });
}

class Pull {
   constructor(data, signatures, comments, reviews, commitStatuses, labels) {
      this.data = data;
      this.signatures = signatures || [];
      this.comments = comments || [];
      this.reviews = reviews || [];
      this.commitStatuses = commitStatuses || [];
      this.labels = labels || [];

      // If github pull-data, parse the body for the cr and qa req... else
      // use the values stored in the db.
      if (typeof data.cr_req === 'undefined') {
         const bodyTags = Pull.parseBody(this.data.body);
         this.data.cr_req = bodyTags['cr_req'];
         this.data.qa_req = bodyTags['qa_req'];
         this.data.closes = bodyTags['closes'];
         this.data.connects = bodyTags['connects'];
      } else {
         this.data.cr_req = data.cr_req;
         this.data.qa_req = data.qa_req;
         this.data.closes = data.closes;
         this.data.connects = data.connects;
      }
      this.data.participants = this.collectParticipants();
      this.identifySignatures();
   }

   update() {
      log('Calling `updatePull` for pull #%s in repo %s', this.data.number, this.data.repo);
      const dbPull = new DBPull(this);
      const number = dbPull.data.number;
      const repo = dbPull.data.repo;

      return dbPull.save().then(() => {
         queue.markPullAsDirty(repo, number);
         log('updatePull: Pull #%s updated in repo %s', number, repo);
      });
   }

   /**
    * Sets sig.data.source_type for each comment, determining where it came from
    * by checking for the presence of the comment_id in the list of review ids
    * from the DB.
    *
    * TODO: add a column on signatures table for this value, instead of testing
    * for presence in our reviews list.
    */
   identifySignatures() {
      const reviewIds = new Set(this.reviews.map(review => review.data.review_id));
      this.signatures.forEach(sig => {
         sig.data.source_type = reviewIds.has(sig.data.comment_id) ? 'review' : 'comment';
      });
   }

   collectParticipants() {
      const participants = new Set();
      this.comments.forEach(comment => {
         participants.add(comment.data.user.login);
      });
      this.reviews.forEach(review => {
         participants.add(review.data.user.login);
      });
      return Array.from(participants);
   }

   /**
    * Reviewers whose latest review verdict isn't otherwise visible on the
    * board. An APPROVED review already surfaces as an active CR signature
    * (Signature.parseReview synthesizes one), so this only needs to carry the
    * verdicts that vanish today: CHANGES_REQUESTED, COMMENTED, DISMISSED, etc.
    * One entry per distinct reviewer login (their most recent review by date),
    * excluding the pull author and anyone who already holds an active CR
    * signature (they're already counted there).
    */
   collectUnstampedReviewers() {
      const authorLogin = this.data.user && this.data.user.login;
      const activeCrLogins = new Set(this.getSignatures('CR').map(sig => sig.data.user.login));

      const latestByLogin = new Map();
      (this.reviews || []).forEach(review => {
         const login = review.data.user.login;
         if (!login || login === authorLogin) return;
         const existing = latestByLogin.get(login);
         if (!existing || review.data.submitted_at > existing.data.submitted_at) {
            latestByLogin.set(login, review);
         }
      });

      const unstamped = [];
      latestByLogin.forEach((review, login) => {
         if (activeCrLogins.has(login)) return;
         unstamped.push({
            login,
            state: review.data.state,
            date: Math.floor(review.data.submitted_at.getTime() / 1000),
            review_id: review.data.review_id,
            body: review.data.body ? review.data.body.slice(0, 400) : undefined,
         });
      });
      return unstamped;
   }

   toObject() {
      var data = _.extend({}, this.data);
      data.status = this.getStatus();
      data.labels = this.labels.map(label => label.data);
      data.review_requests = getReviewRequests(data.repo, data.number, data.requested_reviewers);
      return data;
   }

   /**
    * Get all signatures of a given tag.
    */
   getSignatures(tagName) {
      return this.getAllSignatures(tagName).filter(signature => {
         return signature.data.active === 1;
      });
   }

   getAllSignatures(tagName) {
      return this.signatures.filter(signature => {
         return signature.data.type === tagName;
      });
   }

   isOpen() {
      return this.data.state === 'open';
   }

   /**
    * Return an object:
    * {
    *    'qa_req'        : The *needed* number of QA signatures occuring after the last commit
    *                       in order for this pull to be ready for deploy.
    *    'cr_req'        : The *needed* number of CR signatures occuring after the last commit
    *                       in order for this pull to be ready for deploy.
    *    'dev_block'     : An array containing the last 'dev_block' signature if the pull is dev blocked,
    *                       or an empty array
    *    'deploy_block'  : An array containing the last 'deploy_block' signature if pull is deploy blocked,
    *                       or an empty array
    *    'commit_statuses' : An array of Status objects
    * }
    */
   getStatus() {
      var status = {
         qa_req: this.data.qa_req,
         cr_req: this.data.cr_req,
         allQA: this.getAllSignatures('QA'),
         allCR: this.getAllSignatures('CR'),
         dev_block: this.getSignatures('dev_block'),
         deploy_block: this.getSignatures('deploy_block'),
         commit_statuses: this.commitStatuses,
         // Discussion aggregates. The comment rows are already loaded for
         // participants/signature tagging but never shipped; the board only
         // needs these two facts (a "quiet since" signal), not the rows.
         comment_count: this.comments.length,
         // Bot comments (a `[bot]` login or config.json's `bots` list) must
         // never drive the human-review nudge or wake a snooze -- see
         // lib/review-model.js's isBot for the shared bot check.
         human_comment_count: this.comments.filter(comment => !isBot(comment.data.user.login))
            .length,
         last_comment_at: this.comments.length
            ? new Date(Math.max(...this.comments.map(c => c.data.created_at.getTime())))
            : null,
         // Additive, unstamped review verdicts (CHANGES_REQUESTED/COMMENTED/
         // DISMISSED) that today have no other visibility on the board. Older
         // frontends ignore unknown status fields, so this is safe to ship
         // unconditionally.
         unstamped_reviewers: this.collectUnstampedReviewers(),
      };

      return status;
   }

   /**
    * Parse body of Pull Request for special tags (e.g. cr_req, qa_req).
    */
   static parseBody(body) {
      var bodyTags = [];

      config.body_tags.forEach(tag => {
         var matches = body && body.match(tag.regex);

         if (matches) {
            bodyTags[tag.name] = matches[1];
         } else {
            bodyTags[tag.name] = tag.default;
         }
      });

      return bodyTags;
   }

   /**
    * `reviewRequests`, when passed, is the complete `{ login, at, self }[]`
    * git-manager's parse() derived from the issue's events stream (see
    * deriveReviewRequests) -- authoritative as of this refresh, so it
    * replaces whatever this pull's cache entry held.
    *
    * The webhook path (controllers/githubHooks.js) has no events and so
    * calls this with `reviewRequests` omitted: the cache is left untouched
    * here, and toObject()'s read-time reconcile (via getReviewRequests)
    * carries forward whatever's already cached for logins still in
    * requested_reviewers, defaulting any login it's never seen to
    * `{ at: null, self: false }` until the next full refresh.
    */
   static fromGithubApi(
      data,
      signatures,
      comments,
      reviews,
      commitStatuses,
      labels,
      reviewRequests
   ) {
      data = {
         repo: data.base.repo.full_name,
         number: data.number,
         state: data.state,
         title: data.title,
         body: data.body || '',
         draft: data.draft,
         created_at: utils.fromDateString(data.created_at),
         updated_at: utils.fromDateString(data.updated_at),
         closed_at: utils.fromDateString(data.closed_at),
         mergeable: data.mergeable,
         merged_at: utils.fromDateString(data.merged_at),
         milestone: {
            title: data.milestone && data.milestone.title,
            due_on: data.milestone && utils.fromDateString(data.milestone.due_on),
         },
         head: {
            ref: data.head.ref,
            sha: data.head.sha,
            repo: {
               owner: {
                  login: data.head.repo.owner.login,
               },
               name: data.head.repo.name,
            },
         },
         base: {
            ref: data.base.ref,
         },
         user: {
            login: getLogin(data.user),
         },
         assignees: (data.assignees || []).map(a => getLogin(a)),
         requested_reviewers: (data.requested_reviewers || []).map(r => getLogin(r)),
         additions: data.additions,
         deletions: data.deletions,
         changed_files: data.changed_files,
      };

      if (reviewRequests) {
         reviewRequestsByPull.set(
            reviewRequestsKey(data.repo, data.number),
            new Map(reviewRequests.map(r => [r.login, { at: r.at, self: r.self }]))
         );
      }

      return new Pull(data, signatures, comments, reviews, commitStatuses, labels);
   }

   /**
    * Record a single `review_requested` webhook precisely: `login` was
    * requested at `at` (epoch seconds), `self` per the wire contract. Merges
    * into whatever's already cached for this pull rather than replacing it --
    * unlike the full-refresh path, a webhook only ever knows about its own
    * one login.
    */
   static recordReviewRequested(repo, number, login, { at, self }) {
      const key = reviewRequestsKey(repo, number);
      const known = reviewRequestsByPull.get(key) || new Map();
      known.set(login, { at, self });
      reviewRequestsByPull.set(key, known);
   }

   /**
    * Record a single `review_request_removed` webhook: drop `login`'s cached
    * metadata for this pull. toObject() only ever emits entries for logins
    * still in requested_reviewers anyway, so this is mostly cache hygiene --
    * it keeps a since-re-requested login from momentarily showing stale
    * at/self from its prior request.
    */
   static recordReviewRequestRemoved(repo, number, login) {
      const known = reviewRequestsByPull.get(reviewRequestsKey(repo, number));
      if (known) {
         known.delete(login);
      }
   }

   /**
    * The `"repo#number"` key reviewRequestsByPull is keyed by, exposed so a
    * caller (pull-manager.js's cull, below) can compute the same keys for its
    * own surviving pulls without duplicating the format.
    */
   static reviewRequestsKey(repo, number) {
      return reviewRequestsKey(repo, number);
   }

   /**
    * Drop reviewRequestsByPull's outer per-pull entry for any key not in
    * `liveKeys` (a Set of `"repo#number"`, from Pull.reviewRequestsKey).
    * recordReviewRequestRemoved only ever prunes an entry's INNER per-login
    * map; nothing dropped the outer key once a pull closed and aged out of
    * pull-manager's in-memory `pulls` array, so the cache grew by one entry
    * per pull, forever. Called from pull-manager.js's hourly cull right after
    * it filters its own list, so the two stay in lockstep.
    */
   static pruneReviewRequests(liveKeys) {
      for (const key of reviewRequestsByPull.keys()) {
         if (!liveKeys.has(key)) {
            reviewRequestsByPull.delete(key);
         }
      }
   }

   /**
    * Takes an object representing a DB row, and returns an instance of this
    * Pull object.
    */
   static getFromDB(data, signatures, comments, reviews, commitStatuses, labels) {
      var pullData = {
         repo: data.repo,
         number: data.number,
         state: data.state,
         title: data.title,
         body: data.body,
         draft: data.draft === 1,
         created_at: utils.fromUnixTime(data.date),
         updated_at: utils.fromUnixTime(data.date_updated),
         closed_at: utils.fromUnixTime(data.date_closed),
         // mysql2 hands back tinyint(1) as a raw 0/1/null, but the wire
         // contract (and the shared derive, client and server) treats
         // mergeable as a real boolean|null. Without this normalization a
         // conflicted PR read from the DB after a restart carries 0, and
         // derive()'s strict `mergeable === false` never matches until a
         // GitHub refresh re-derives the pull -- so it mis-buckets as
         // mergeable. Normalize at the DB boundary, same as `draft` above.
         mergeable: data.mergeable == null ? null : data.mergeable === 1,
         merged_at: utils.fromUnixTime(data.date_merged),
         additions: data.additions,
         deletions: data.deletions,
         // was dropped on the DB round-trip: DBPull writes it, but a restart
         // read it back as undefined, losing the >15-files weight bump
         changed_files: data.changed_files,
         milestone: {
            title: data.milestone_title,
            due_on: utils.fromUnixTime(data.milestone_due_on),
         },
         head: {
            ref: data.head_branch,
            sha: data.head_sha,
            repo: {
               owner: {
                  login: data.repo.split('/')[0],
               },
            },
         },
         base: {
            ref: data.base_branch,
         },
         user: {
            login: data.owner,
         },
         // mysql2 auto-parses the JSON column, so this is already an array (or null).
         assignees: data.assignees ?? [],
         requested_reviewers: data.requested_reviewers ?? [],
         cr_req: data.cr_req,
         qa_req: data.qa_req,
      };

      return new Pull(pullData, signatures, comments, reviews, commitStatuses, labels);
   }
}

export default Pull;
