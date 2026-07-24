import pullManager from '../lib/pull-manager.js';
import { deriveAll } from '../lib/review-model.js';
import { STATUS_ORDER } from '../shared/dist/index.js';

// STATUS_ORDER is the board's canonical bucket order; index it so the default
// response is grouped the same way the board groups, oldest-first within a
// bucket. This is a stable default sort, NOT the reviewer-priority ranking
// (crSort/deal) -- that stays client-side, applied to this list by consumers.
const statusRank = new Map(STATUS_ORDER.map((s, i) => [s, i]));

/**
 * One DerivedPull -> the API record. Metadata and the server-computed
 * classification only: no diff (a consumer fetches that from GitHub with the
 * same token), and every timestamp is an ISO string straight off the wire.
 */
function toRecord(d) {
   const p = d.data;
   return {
      id: `${p.repo}#${p.number}`,
      repo: p.repo,
      number: p.number,
      title: p.title,
      url: `https://github.com/${p.repo}/pull/${p.number}`,
      author: p.user.login,
      draft: p.draft,
      status: d.status,
      ci: d.ci,
      ci_failing: d.ciFailing,
      weight: d.weight,
      age_days: d.ageDays,
      starved: d.starved,
      signoffs: {
         cr: { req: p.status.cr_req, have: d.crHave, by: d.crBy, recr_by: d.recrBy },
         qa: { req: p.status.qa_req, have: d.qaHave, by: d.qaBy },
      },
      dev_blocked_by: d.devBlockedBy,
      deploy_blocked_by: d.deployBlockedBy,
      head_sha: p.head.sha,
      base: p.base.ref,
      created_at: p.created_at,
      updated_at: p.updated_at,
   };
}

export default {
   /**
    * GET /api/v1/pulls -- every open PR on the board, classified server-side
    * with the same derive the board runs. Bearer-authed (lib/api-auth). This
    * is what lets the what-to-review / batch-review skills make one call
    * instead of a direct DB query plus a bash re-implementation of buckets.
    */
   getPulls: function (req, res) {
      const now = Date.now() / 1000;
      const open = pullManager.getPulls().filter(pull => pull.isOpen());
      const records = deriveAll(open, now)
         .map(toRecord)
         .sort(
            (a, b) =>
               (statusRank.get(a.status) ?? 99) - (statusRank.get(b.status) ?? 99) ||
               b.age_days - a.age_days
         );
      res.json({ server_time: Math.floor(now), count: records.length, pulls: records });
   },

   /** GET /api/v1/me -- the authenticated caller's login, so a skill can
    * confirm its token works and resolve the default reviewer. */
   getMe: function (req, res) {
      res.json({ login: req.apiUser.login });
   },
};
