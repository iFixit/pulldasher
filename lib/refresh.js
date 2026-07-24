import gitManager, { observeRateLimit } from './git-manager.js';
import dbManager from './db-manager.js';
import utils from './utils.js';
import NotifyQueue from 'notify-queue';
import debug from './debug.js';
import Promise from 'bluebird';
import { createPacer, noopPacer } from './pacer.js';

const refreshDebug = debug('pulldasher:refresh');

/**
 * Build a refresh API over its own pair of serial queues. The injected `pacer`
 * gates the *consumer* — the drain, where the API call actually spends quota
 * and reports the rate-limit headers — before each bulk work item. It defaults
 * to a no-op, so the server (webhook/socket refreshes and the startup open-pulls
 * refresh) runs unpaced. Only the CLI backfill bins pass a real pacer, and in
 * that process the consumer drains nothing but bulk, so parking it on a paced or
 * floor-paused slot starves nothing. Single-item webhook/socket refreshes push
 * straight through; the gate only fronts work items, never the batch-done
 * sentinel.
 */
export function createRefresh({ pacer = noopPacer } = {}) {
   // Queues for making all refreshes be synchronous, one at a time.
   const issueQueue = new NotifyQueue();
   const pullQueue = new NotifyQueue();

   issueQueue.pop(
      makeQueueConsumer(pacer, processIssueItem, {
         parseIssue: gitManager.parseIssue,
         updateAllIssueData: dbManager.updateAllIssueData,
      })
   );

   pullQueue.pop(
      makeQueueConsumer(pacer, processPullItem, {
         parse: gitManager.parse,
         updateAllPullData: dbManager.updateAllPullData,
      })
   );

   return {
      ///////   Issues   /////////

      issue: function refreshIssue(repo, number) {
         refreshDebug('refresh issue %s', number);
         return gitManager
            .getIssue(repo, number)
            .then(pushOnQueue(issueQueue))
            .catch(function (err) {
               // See refreshPull: getIssue's rejection lands here before
               // pushOnQueue ever runs. Log then rethrow for the same reasons.
               console.error(
                  'Failed to fetch issue %s in repo %s from the GitHub API: %s',
                  number,
                  repo,
                  (err && err.message) || err
               );
               throw err;
            });
      },

      allIssues: function refreshAllIssues(repos) {
         refreshDebug('refresh all issues');
         return utils
            .forEachRepo(repo => gitManager.getAllIssues(repo, pacer), {
               repos: repos,
            })
            .then(drainThrough(issueQueue));
      },

      openIssues: function refreshOpenIssues(repos) {
         refreshDebug('refresh all open issues');
         return utils
            .forEachRepo(repo => gitManager.getOpenIssues(repo, pacer), {
               repos: repos,
            })
            .then(drainThrough(issueQueue));
      },

      ///////   Pulls   /////////

      pull: function refreshPull(repo, number) {
         refreshDebug('refresh pull %s', number);
         return gitManager
            .getPull(repo, number)
            .then(pushOnQueue(pullQueue))
            .catch(function (err) {
               // getPull's rejection (a dead/expired bot token, a 5xx, ...) lands
               // here before pushOnQueue ever runs -- log it so a single-item
               // refresh (webhook/socket) doesn't fail as a silent, invisible
               // unhandled rejection. Rethrown so callers with more context
               // (which action triggered this refresh) can log that too, and so
               // CLI bins that .done() this promise still crash loud on failure.
               console.error(
                  'Failed to fetch pull %s in repo %s from the GitHub API: %s',
                  number,
                  repo,
                  (err && err.message) || err
               );
               throw err;
            });
      },

      allPulls: function refreshAllPulls(repos) {
         refreshDebug('refresh all pull');
         return utils
            .forEachRepo(repo => gitManager.getAllPulls(repo, pacer), {
               repos: repos,
            })
            .then(drainThrough(pullQueue));
      },

      openPulls: function refreshOpenPulls(repos) {
         refreshDebug('refresh all open pulls');
         return utils
            .forEachRepo(repo => gitManager.getOpenPulls(repo, pacer), {
               repos: repos,
            })
            .then(drainThrough(pullQueue));
      },
   };
}

// The default instance is unpaced (no-op pacer): the server imports this for
// its startup open-pulls refresh and webhook/socket refreshes. The CLI backfill
// bins build their own paced instance via createPacedRefresh.
export default createRefresh();

/**
 * Build the refresh API a CLI backfill bin runs against. One per-process pacer
 * is installed as a rate-limit observer on the GitHub client (so every
 * response's quota headers feed it) and threaded into the queue consumers, so
 * the whole bulk drain — the per-item fan-out, where the spend actually lands —
 * and the list pagination pace against the shared token's quota, reserving
 * headroom for the live server's webhook/socket refreshes (a separate process,
 * same token).
 */
export function createPacedRefresh() {
   const pacer = createPacer();
   observeRateLimit(pacer);
   return createRefresh({ pacer });
}

/**
 * Build a queue pop consumer. The queue holds two kinds of entries: work items
 * `{ response, onFailure }` and a bare function batch-done sentinel (pushed
 * after a batch). A sentinel just runs and advances — never gated. For a work
 * item, await the pacer's slot *first* — the drain is where the API call spends
 * quota — then hand the unwrapped response, plus the item's own onFailure
 * collector, to the process function. onFailure rides on the item (not the
 * fixed deps) so it stays scoped to the run that enqueued it: a bulk run
 * collects its own failures, webhook/socket refreshes push null and don't
 * accumulate.
 */
export function makeQueueConsumer(pacer, processItem, deps) {
   return async function (item, next) {
      if (typeof item === 'function') {
         item();
         return next();
      }
      await pacer.gate();
      processItem(item.response, next, { ...deps, onFailure: item.onFailure });
   };
}

/**
 * Returns a function that will:
 *    push its first argument to the specified Queue
 *    and return a promise that is fulfilled when the item is fully processed.
 *
 * Single-item refreshes (webhooks, socket) have no end-of-run report, so no
 * failure collector is attached — and they aren't quota-paced, so live traffic
 * is never delayed.
 */
function pushOnQueue(queue) {
   return function (githubResponse) {
      return new Promise(function (resolve) {
         queue.push({ response: githubResponse, onFailure: null });
         queue.push(resolve);
      });
   };
}

/**
 * Returns a function that will:
 *    push all the entries in the array (first argument) to the specified
 *    Queue and return a promise that is fulfilled when the items are fully
 *    processed.
 *
 * Each item carries the run's `onFailure` collector (null for single-item
 * webhook/socket refreshes), so a failed parse is recorded for that run's
 * end-of-run report. Enqueueing is unpaced — quota pacing happens at the
 * consumer (see createRefresh), so the queue can fill freely while the drain
 * spaces the actual API spend.
 */
function pushAllOnQueue(queue, onFailure) {
   return function (githubResponses) {
      return new Promise(function (resolve) {
         githubResponses.forEach(function (githubResponse) {
            queue.push({ response: githubResponse, onFailure: onFailure });
         });
         queue.push(resolve);
      });
   };
}

/**
 * For the bulk bin scripts: at the end of a run, re-report everything that
 * failed — repos that couldn't be fetched, plus individual issues/pulls that
 * couldn't be refreshed — and flag a non-zero exit, so a partial backfill isn't
 * mistaken for a complete one. The per-failure lines were already logged inline
 * mid-run; repeating them at the end (one per line, greppable) keeps them from
 * getting buried under thousands of debug lines.
 */
export function reportFailures({ failedRepos, failedItems }) {
   failedItems = failedItems || [];
   failedRepos.forEach(function (repo) {
      console.error('Skipped repo (could not fetch): %s', repo);
   });
   failedItems.forEach(function (item) {
      console.error('Failed to refresh %s #%s', item.repo, item.number);
   });
   if (failedRepos.length || failedItems.length) {
      console.error(
         'Backfill incomplete: %s repo(s) skipped, %s item(s) failed (listed above).',
         failedRepos.length,
         failedItems.length
      );
      process.exitCode = 1;
   }
}

/**
 * Bridges a forEachRepo result onto a queue: pushes the fetched items, waits
 * for them to drain, then resolves to `{ failedRepos, failedItems }` so the
 * bulk bin scripts can report (and exit non-zero on) both repos that couldn't
 * be fetched and items that couldn't be refreshed. `failedItems` is local to
 * this drain, so the live server's webhook refreshes never accumulate here.
 */
function drainThrough(queue) {
   return function ({ items, failedRepos }) {
      const failedItems = [];
      const onFailure = function (repo, number) {
         failedItems.push({ repo: repo, number: number });
      };
      return pushAllOnQueue(
         queue,
         onFailure
      )(items).then(function () {
         return { failedRepos: failedRepos, failedItems: failedItems };
      });
   };
}

/**
 * Refresh one issue. Collaborators (including the run's `onFailure` collector)
 * are injected so the failure path is testable. A transient parse/update error
 * is logged, recorded via `onFailure` (when present), and swallowed — we still
 * call next() so one bad issue can't abort the sweep (or, at runtime, crash the
 * server on a webhook refresh).
 */
export function processIssueItem(response, next, { parseIssue, updateAllIssueData, onFailure }) {
   refreshDebug('refreshing issue %s', response.number);
   return parseIssue(response)
      .then(updateAllIssueData)
      .then(function () {
         refreshDebug('done refreshing issue %s in repo %s', response.number, response.repo);
         next();
      })
      .catch(function (err) {
         console.error(
            'Failed to refresh issue %s in repo %s: %s',
            response.number,
            response.repo,
            (err && err.message) || err
         );
         if (onFailure) {
            onFailure(response.repo, response.number);
         }
         next();
      });
}

/**
 * Refresh one pull. See processIssueItem.
 */
export function processPullItem(response, next, { parse, updateAllPullData, onFailure }) {
   const repo = response.base && response.base.repo && response.base.repo.full_name;
   refreshDebug('refreshing pull %s in repo %s', response.number, repo);
   return parse(response)
      .then(updateAllPullData)
      .then(function () {
         refreshDebug('done refreshing pull %s', response.number);
         next();
      })
      .catch(function (err) {
         console.error(
            'Failed to refresh pull %s in repo %s: %s',
            response.number,
            repo,
            (err && err.message) || err
         );
         if (onFailure) {
            onFailure(repo, response.number);
         }
         next();
      });
}
