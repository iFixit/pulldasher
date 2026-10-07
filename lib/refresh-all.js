import gitManager from './git-manager.js';
import dbManager from './db-manager.js';
import debug from './debug.js';
import { setTimeout as sleepFor } from 'node:timers/promises';
import { noopPacer } from './pacer.js';
import { findMissingOpenPulls, findStaleOpenPulls, processPullItem } from './refresh.js';

const log = debug('pulldasher:refresh-all');

// A pacer wait this long reads as a stuck press unless the boards say why.
const WAIT_NOTICE_MS = 30 * 1000;

/**
 * "Refresh all": one press brings the board to GitHub's state. It lists the
 * open and recently closed pulls of every repo the board shows, compares them
 * with the board, and refetches only the pulls that differ, one at a time.
 * Each refetch waits for `pacer`, and webhook refreshes run on their own
 * queue, so they never wait behind a press. One press runs at a time.
 *
 * `board()` returns the board's pulls (pull-manager), `repos` the configured
 * repos, `closedSince()` the oldest close the board shows. `ready` resolves
 * once the board has loaded and the startup refresh has re-read every open
 * pull. `onProgress` hears every change.
 */
export function createRefreshAll({
   board,
   repos,
   closedSince,
   pacer = noopPacer,
   ready = Promise.resolve(),
   onProgress = () => {},
   sleep = sleepFor,
}) {
   let progress = null;

   function report(next) {
      progress = next;
      onProgress(next);
   }

   async function run() {
      await ready;
      const since = closedSince();
      const listed = [];
      const listedRepos = [];
      let skipped = 0;
      // one repo at a time: see PULLS_TO_COMPARE_QUERY in git-manager
      for (const repo of coveredRepos(repos, board())) {
         try {
            listed.push(...(await gitManager.getPullsToCompare(repo, since)));
            listedRepos.push(repo);
         } catch (err) {
            skipped++;
            console.error(
               'Refresh all: failed to list the pulls in %s: %s',
               repo,
               (err && err.message) || err
            );
         }
      }
      const due = pullsToRefresh(board(), listed, listedRepos, since);
      log('%s of %s listed pulls differ from the board', due.length, listed.length);
      let done = 0;
      let failed = 0;
      report({ state: 'refreshing', done, total: due.length, failed, skipped });
      pacer.restart();
      for (const { repo, number, why } of due) {
         const waitMs = pacer.claim();
         if (waitMs >= WAIT_NOTICE_MS) {
            const until = Date.now() + waitMs;
            report({ state: 'waiting', until, done, total: due.length, failed, skipped });
         }
         await sleep(waitMs);
         log('refreshing %s#%s (%s)', repo, number, why);
         if (!(await refreshPull(repo, number))) {
            failed++;
         }
         done++;
         report({ state: 'refreshing', done, total: due.length, failed, skipped });
      }
      report({ state: 'done', done, total: due.length, failed, skipped });
   }

   return {
      progress: () => progress,

      /**
       * Start a press unless one is running. Resolves when it finishes, or
       * returns null when one was already running.
       */
      start() {
         if (progress && progress.state !== 'done') {
            return null;
         }
         report({ state: 'checking', done: 0, total: 0, failed: 0, skipped: 0 });
         return run().catch(err => {
            // a bug, not GitHub: count what it didn't get to as failed, so the
            // button frees up and the board says to look at the log
            console.error('Refresh all stopped: %s', (err && err.message) || err);
            const unfinished = Math.max(1, progress.total - progress.done);
            report({ ...progress, state: 'done', failed: progress.failed + unfinished });
         });
      },
   };
}

/** Fetch, parse and save one pull. Resolves to whether it saved. */
async function refreshPull(repo, number) {
   let saved = true;
   try {
      const response = await gitManager.getPull(repo, number);
      await new Promise(next =>
         processPullItem(response, next, {
            parse: gitManager.parse,
            updateAllPullData: dbManager.updateAllPullData,
            onFailure: () => (saved = false),
         })
      );
   } catch (err) {
      console.error(
         'Refresh all: failed to fetch pull %s in repo %s: %s',
         number,
         repo,
         (err && err.message) || err
      );
      saved = false;
   }
   return saved;
}

/**
 * The configured repos plus every repo with a pull on the board, once each.
 * Webhooks arrive for the whole org, so the board holds pulls from repos the
 * config doesn't list.
 */
export function coveredRepos(repos, boardPulls) {
   const byName = new Map();
   for (const name of repos.map(repo => repo.name).concat(boardPulls.map(pull => pull.data.repo))) {
      if (!byName.has(name.toLowerCase())) {
         byName.set(name.toLowerCase(), name);
      }
   }
   return [...byName.values()];
}

/**
 * The pulls where the board and GitHub disagree, each once, with the first
 * reason found. `listed` is getPullsToCompare's output for `listedRepos`, the
 * repos that answered; `closedSince` is the oldest close the board shows.
 */
export function pullsToRefresh(boardPulls, listed, listedRepos, closedSince) {
   const key = (repo, number) => repo.toLowerCase() + '#' + number;
   const onBoard = new Map(boardPulls.map(pull => [key(pull.data.repo, pull.data.number), pull]));
   const boardOpen = boardPulls
      .filter(pull => pull.isOpen())
      .map(pull => ({ repo: pull.data.repo, number: pull.data.number }));
   // shaped like pulls.list items, which the reconcile helpers read
   const listedOpen = listed
      .filter(pull => pull.state === 'open')
      .map(pull => ({ number: pull.number, base: { repo: { full_name: pull.repo } } }));
   const due = new Map();
   const add = (repo, number, why) => {
      if (!due.has(key(repo, number))) {
         due.set(key(repo, number), { repo, number, why });
      }
   };

   // open on GitHub but not on the board: a lost `opened` or `reopened`
   for (const pull of findMissingOpenPulls(boardOpen, listedOpen)) {
      add(pull.base.repo.full_name, pull.number, 'missing');
   }
   // open on the board but not on GitHub: a lost `closed`
   for (const pull of findStaleOpenPulls(boardOpen, listedOpen, listedRepos)) {
      add(pull.repo, pull.number, 'closed');
   }
   for (const pull of listed) {
      const shown = onBoard.get(key(pull.repo, pull.number));
      if (pull.state === 'closed') {
         // closed recently enough to be on the board, and missing from it:
         // opened and closed while webhooks weren't arriving
         if (!shown && Date.parse(pull.closedAt) >= closedSince.getTime()) {
            add(pull.repo, pull.number, 'missing');
         }
      } else if (shown && shown.isOpen()) {
         const why = difference(shown, pull);
         if (why) {
            add(pull.repo, pull.number, why);
         }
      }
   }
   return [...due.values()];
}

/**
 * The first way the board's copy of an open pull differs from GitHub's
 * listing of it, or null when they agree.
 */
export function difference(pull, listed) {
   if (pull.data.head.sha !== listed.headSha) {
      return 'head';
   }
   if (Boolean(pull.data.draft) !== listed.draft) {
      return 'draft';
   }
   const labels = pull.labels.map(label => label.data.title);
   if (labels.length !== listed.labels.length || !labels.every(l => listed.labels.includes(l))) {
      return 'labels';
   }
   // Counts catch a lost comment or review even after newer ones arrived,
   // which a timestamp can't. The DB keeps deleted comments, so only more on
   // GitHub counts as a difference.
   if (listed.comments > pull.comments.filter(c => c.data.comment_type === 'issue').length) {
      return 'comments';
   }
   if (listed.reviews > pull.reviews.length) {
      return 'reviews';
   }
   if (Date.parse(listed.updatedAt) > newestKnown(pull)) {
      return 'updated';
   }
   if (listed.headCommittedAt && lapsedStampStands(pull, Date.parse(listed.headCommittedAt))) {
      return 'stamp';
   }
   // a check's result never moves updated_at, so a lost one shows only as a
   // check the board still holds as running
   if (pull.commitStatuses.some(status => status.data.state === 'pending')) {
      return 'ci';
   }
   return null;
}

/**
 * The newest time the board knows for a pull. GitHub's updated_at moves with
 * every comment and review, but those webhooks don't touch the pull's row, so
 * comparing with the row alone would refetch every pull whose newest activity
 * is a comment.
 */
function newestKnown(pull) {
   const times = [pull.data.updated_at]
      .concat(pull.comments.map(comment => comment.data.created_at))
      .concat(pull.reviews.map(review => review.data.submitted_at))
      .map(time => (time ? new Date(time).getTime() : NaN))
      .filter(Number.isFinite);
   return times.length ? Math.max(...times) : 0;
}

/**
 * A CR or QA stamp the board shows standing though it predates the head
 * commit, which a refresh would lapse: a lost push, hidden because a later
 * webhook already wrote the new head. GitHub approvals are exempt, as in
 * git-manager's parse.
 */
function lapsedStampStands(pull, headCommittedAt) {
   const approvals = new Set(
      pull.reviews
         .filter(review => String(review.data.state).toUpperCase() === 'APPROVED')
         .map(review => review.data.review_id)
   );
   return pull.signatures.some(
      sig =>
         (sig.data.type === 'CR' || sig.data.type === 'QA') &&
         sig.data.active === 1 &&
         !approvals.has(sig.data.comment_id) &&
         sig.data.created_at < headCommittedAt
   );
}
